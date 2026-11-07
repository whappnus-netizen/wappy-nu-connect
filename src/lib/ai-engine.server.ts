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
  reactionEmoji: string | null;
  paymentProof?: {
    confidence: number; amount: number | null; originalCurrency: string | null; reference: string | null;
    paymentMethod: "bank_transfer" | "multicaixa_express" | "unitel_money" | "africell_money" | "cash" | "other";
    payerName: string | null; beneficiaryName: string | null; transactionDate: string | null;
    itemName: string | null; summary: string;
  } | null;
};

export async function generateViaWhappNusAI(input: GenerateInput): Promise<GenerateResult> {
  const configuredUrl = process.env["WHAPPNUS_AI_ENGINE_URL"];
  const secret = process.env["WHAPPNUS_AI_ENGINE_SECRET"];
  if (!configuredUrl) throw new Error("WHAPPNUS_AI_ENGINE_URL não está configurada no servidor.");
  if (!secret) throw new Error("WHAPPNUS_AI_ENGINE_SECRET não está configurada no servidor.");

  // Aceita tanto https://host como host para evitar o erro nativo
  // "Failed to parse URL" quando a variável foi guardada sem o esquema.
  const url = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}`;
  let engineUrl: URL;
  try {
    engineUrl = new URL(url);
  } catch {
    throw new Error("WHAPPNUS_AI_ENGINE_URL inválida.");
  }
  engineUrl.pathname = engineUrl.pathname.replace(/\/$/, "");
  const response = await fetch(engineUrl.toString().replace(/\/$/, "") + "/v1/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + secret,
    },
    body: JSON.stringify(input),
    // O webhook de entrada corre numa função HTTP com limite de execução.
    // Se o motor demorar demasiado, interrompemos a espera para o pipeline enviar
    // a resposta de recuperação ao cliente em vez de perder a resposta por 502/504.
    signal: AbortSignal.timeout(17_000),
  });

  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch {}

  if (!response.ok) {
    const code = typeof data["error"] === "string" ? data["error"] : "AI_ENGINE_ERROR";
    throw new Error(code);
  }

  if (typeof data["text"] !== "string" || !(data["text"] as string).trim()) {
    throw new Error("AI Engine não devolveu uma resposta válida.");
  }

  return {
    text: (data["text"] as string).trim(),
    provider: String(data["provider"] ?? "unknown"),
    model: String(data["model"] ?? "unknown"),
    intent: String(data["intent"] ?? "general"),
    confidence: Number(data["confidence"] ?? 0),
    latencyMs: Number(data["latencyMs"] ?? 0),
    usedKnowledge: Number(data["usedKnowledge"] ?? 0),
    agentId: typeof data["agentId"] === "string" ? (data["agentId"] as string) : null,
    reactionEmoji: typeof data["reactionEmoji"] === "string" ? (data["reactionEmoji"] as string) : null,
    paymentProof: data["paymentProof"] && typeof data["paymentProof"] === "object"
      ? data["paymentProof"] as NonNullable<GenerateResult["paymentProof"]>
      : null,
  };
}

export type PaymentProofAnalysis = {
  isPaymentProof: boolean; confidence: number; amount: number | null; originalCurrency: string | null;
  reference: string | null; paymentMethod: "bank_transfer" | "multicaixa_express" | "unitel_money" | "africell_money" | "cash" | "other";
  payerName: string | null; beneficiaryName: string | null; transactionDate: string | null;
  itemName: string | null; summary: string;
};

export async function analyzePaymentProofViaWhappNusAI(input: {
  organizationId: string; whatsappNumberId: string; conversationId: string; contactId?: string | null;
  mediaPath: string; mediaMimeType: string; messageType: "image" | "document"; messageText?: string | null;
}): Promise<PaymentProofAnalysis> {
  const configuredUrl = process.env["WHAPPNUS_AI_ENGINE_URL"];
  const secret = process.env["WHAPPNUS_AI_ENGINE_SECRET"];
  if (!configuredUrl || !secret) throw new Error("Motor de IA não configurado para analisar comprovativos.");
  const url = /^https?:\/\//i.test(configuredUrl) ? configuredUrl : "https://" + configuredUrl;
  const engineUrl = new URL(url);
  engineUrl.pathname = engineUrl.pathname.replace(/\/$/, "");
  const response = await fetch(engineUrl.toString().replace(/\/$/, "") + "/v1/payment-proof/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + secret },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch {}
  if (!response.ok || data["ok"] !== true) throw new Error("Não foi possível analisar automaticamente o comprovativo.");
  return {
    isPaymentProof: data["isPaymentProof"] === true,
    confidence: Number(data["confidence"] ?? 0),
    amount: typeof data["amount"] === "number" ? data["amount"] : null,
    originalCurrency: typeof data["originalCurrency"] === "string" ? data["originalCurrency"] : null,
    reference: typeof data["reference"] === "string" ? data["reference"] : null,
    paymentMethod: (["bank_transfer","multicaixa_express","unitel_money","africell_money","cash","other"].includes(String(data["paymentMethod"]))
      ? data["paymentMethod"] : "other") as PaymentProofAnalysis["paymentMethod"],
    payerName: typeof data["payerName"] === "string" ? data["payerName"] : null,
    beneficiaryName: typeof data["beneficiaryName"] === "string" ? data["beneficiaryName"] : null,
    transactionDate: typeof data["transactionDate"] === "string" ? data["transactionDate"] : null,
    itemName: typeof data["itemName"] === "string" ? data["itemName"] : null,
    summary: typeof data["summary"] === "string" ? data["summary"] : "Anexo recebido; aguarda revisão humana.",
  };
}
