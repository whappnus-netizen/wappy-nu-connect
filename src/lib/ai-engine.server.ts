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
  };
}
