import { serviceClient } from "./whatsapp.server";

type GenerateInput = {
  organizationId: string;
  whatsappNumberId: string;
  conversationId?: string | null;
  contactId?: string | null;
  messageId?: string | null;
  fromWaId?: string | null;
  profileName?: string | null;
  text: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  agentId?: string | null;
  testMode?: boolean;
  mediaPath?: string | null;
  mediaMimeType?: string | null;
  messageType?: "text" | "image" | "audio" | "video" | "document" | "system";
};

type GenerateResult = {
  text: string;
  provider: string;
  model: string;
  intent: string;
  confidence: number;
  latencyMs: number;
  usedKnowledge: number;
  agentId: string | null;
  reactionEmoji?: string | null;
  paymentProof?: PaymentProofAnalysis | null;
};

export type PaymentProofAnalysis = {
  isPaymentProof: boolean;
  confidence: number;
  amount: number | null;
  originalCurrency: string | null;
  reference: string | null;
  paymentMethod: "bank_transfer" | "multicaixa_express" | "unitel_money" | "africell_money" | "cash" | "other";
  payerName: string | null;
  beneficiaryName: string | null;
  transactionDate: string | null;
  itemName: string | null;
  summary: string;
};

function nativeAiConfig(): { endpoint: string; paymentProofEndpoint: string; secret: string } {
  const configured = process.env["WHAPPNUS_NATIVE_AI_URL"];
  const secret = process.env["WHAPPNUS_NATIVE_AI_SECRET"];
  if (!configured) throw new Error("WHAPPNUS_NATIVE_AI_URL_NOT_CONFIGURED");
  if (!secret) throw new Error("WHAPPNUS_NATIVE_AI_SECRET_NOT_CONFIGURED");
  let base: URL;
  try { base = new URL(/^https?:\/\//i.test(configured) ? configured : "https://" + configured); }
  catch { throw new Error("WHAPPNUS_NATIVE_AI_URL_INVALID"); }
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    throw new Error("WHAPPNUS_NATIVE_AI_HTTPS_REQUIRED");
  }
  base.pathname = base.pathname.replace(/\/$/, "");
  base.search = "";
  base.hash = "";
  const root = base.toString().replace(/\/$/, "");
  return {
    endpoint: root + "/v1/generate-direct",
    paymentProofEndpoint: root + "/v1/payment-proof/analyze",
    secret,
  };
}

function isRetryableGenerationError(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error &&
      typeof (error as { retryable?: unknown }).retryable === "boolean") {
    return (error as { retryable: boolean }).retryable;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /AbortError|TimeoutError|timed out|timeout|fetch failed|ECONN|socket|network|HTTP (408|425|429|5[0-9][0-9])/i.test(message);
}

async function enqueueGenerationForRetry(input: GenerateInput): Promise<void> {
  if (input.testMode || !input.conversationId || !input.messageId) {
    throw new Error("AI_GENERATION_RETRY_CANNOT_BE_QUEUED");
  }
  const admin = serviceClient();
  const { data: conversation, error: conversationError } = await admin.from("conversations")
    .select("id")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .eq("whatsapp_number_id", input.whatsappNumberId)
    .maybeSingle();
  if (conversationError || !conversation?.id) throw new Error("AI_QUEUE_CONVERSATION_LOOKUP_FAILED");

  const idempotencyKey = "whatsapp:" + input.organizationId + ":" + input.whatsappNumberId + ":" + input.messageId;
  const { error: insertError } = await admin.from("ai_generation_jobs").upsert({
    idempotency_key: idempotencyKey,
    organization_id: input.organizationId,
    whatsapp_number_id: input.whatsappNumberId,
    conversation_id: input.conversationId,
    message_id: input.messageId,
    request_payload: input,
    status: "queued",
    available_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (insertError) throw new Error("AI_QUEUE_ENQUEUE_FAILED: " + insertError.message);
  const { data: job, error: lookupError } = await admin.from("ai_generation_jobs")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (lookupError || !job?.id) throw new Error("AI_QUEUE_LOOKUP_FAILED");
  if (job.status === "failed") throw new Error("AI_GENERATION_JOB_PREVIOUSLY_FAILED");
}

export async function generateViaWhappNusAI(input: GenerateInput): Promise<GenerateResult> {
  const nativeAi = nativeAiConfig();
  let response: Response;
  try {
    response = await fetch(nativeAi.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + nativeAi.secret,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(22_000),
    });
  } catch (error) {
    if (isRetryableGenerationError(error)) {
      await enqueueGenerationForRetry(input);
      throw new Error("generation_pending_retry");
    }
    throw error;
  }

  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok || data["ok"] === false) {
    const code = typeof data["error"] === "string"
      ? data["error"]
      : typeof data["code"] === "string"
        ? data["code"]
        : "NATIVE_AI_GENERATION_FAILED";
    const failure = new Error(code + " (HTTP " + response.status + ")") as Error & { retryable?: boolean };
    if (typeof data["retryable"] === "boolean") failure.retryable = data["retryable"];
    if (isRetryableGenerationError(failure)) {
      await enqueueGenerationForRetry(input);
      throw new Error("generation_pending_retry");
    }
    throw failure;
  }

  const answer = typeof data["text"] === "string" ? data["text"].trim() : "";
  if (!answer) throw new Error("NATIVE_AI_EMPTY_COMPLETION");
  return {
    text: answer,
    provider: typeof data["provider"] === "string" ? data["provider"] : "whappnus-ai-orchestrator",
    model: typeof data["model"] === "string" ? data["model"] : "configured-model",
    intent: typeof data["intent"] === "string" ? data["intent"] : "customer_support",
    confidence: typeof data["confidence"] === "number" ? data["confidence"] : 0,
    latencyMs: typeof data["latencyMs"] === "number" ? data["latencyMs"] : 0,
    usedKnowledge: typeof data["usedKnowledge"] === "number" ? data["usedKnowledge"] : 0,
    agentId: typeof data["agentId"] === "string" ? data["agentId"] : null,
    reactionEmoji: typeof data["reactionEmoji"] === "string" ? data["reactionEmoji"] : null,
  };
}

export async function analyzePaymentProofViaWhappNusAI(input: {
  organizationId: string;
  whatsappNumberId: string;
  conversationId: string;
  contactId?: string | null;
  mediaPath: string;
  mediaMimeType: string;
  messageType: "image" | "document";
  messageText?: string | null;
}): Promise<PaymentProofAnalysis> {
  const nativeAi = nativeAiConfig();
  const response = await fetch(nativeAi.paymentProofEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + nativeAi.secret,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(22_000),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok || data["ok"] === false) {
    const code = typeof data["error"] === "string" ? data["error"] : "PAYMENT_PROOF_ANALYSIS_FAILED";
    throw new Error(code + " (HTTP " + response.status + ")");
  }
  return {
    isPaymentProof: data["isPaymentProof"] === true,
    confidence: Math.max(0, Math.min(1, Number(data["confidence"]) || 0)),
    amount: typeof data["amount"] === "number" ? data["amount"] : null,
    originalCurrency: typeof data["originalCurrency"] === "string" ? data["originalCurrency"] : null,
    reference: typeof data["reference"] === "string" ? data["reference"] : null,
    paymentMethod: ["bank_transfer", "multicaixa_express", "unitel_money", "africell_money", "cash", "other"].includes(String(data["paymentMethod"]))
      ? data["paymentMethod"] as PaymentProofAnalysis["paymentMethod"]
      : "other",
    payerName: typeof data["payerName"] === "string" ? data["payerName"] : null,
    beneficiaryName: typeof data["beneficiaryName"] === "string" ? data["beneficiaryName"] : null,
    transactionDate: typeof data["transactionDate"] === "string" ? data["transactionDate"] : null,
    itemName: typeof data["itemName"] === "string" ? data["itemName"] : null,
    summary: typeof data["summary"] === "string" ? data["summary"] : "Anexo analisado; aguarda confirmação humana.",
  };
}
