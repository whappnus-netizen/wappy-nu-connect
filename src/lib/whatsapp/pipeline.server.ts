/**
 * Wappy Nus — pipeline único de mensagens (SERVER-ONLY).
 *
 * Fluxo interno igual para TODOS os provedores (Cloud API e QR):
 *
 *   provider -> normalizeIncomingMessage -> conversation service ->
 *   message service -> AI service -> outgoing message -> provider
 *
 * O resto da aplicação (inbox, dashboard, CRM) nunca precisa saber a origem.
 */
import { serviceClient } from "../whatsapp.server";
import type { NormalizedIncoming, SessionRef } from "./provider.server";
import { providerByName } from "./registry.server";

export type WhatsAppEventType =
  | "qr_generated"
  | "qr_scanned"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "message_received"
  | "message_sent"
  | "message_failed"
  | "ai_skipped"
  | "error";

/** Log técnico. Nunca grava conteúdo de mensagens nem credenciais. */
export async function logWhatsAppEvent(
  organizationId: string,
  event: WhatsAppEventType,
  input: {
    whatsappNumberId?: string | null;
    sessionId?: string | null;
    provider?: string | null;
    detail?: Record<string, unknown> | null;
  } = {},
): Promise<void> {
  try {
    const admin = serviceClient();
    await admin.from("whatsapp_events").insert({
      organization_id: organizationId,
      whatsapp_number_id: input.whatsappNumberId ?? null,
      session_id: input.sessionId ?? null,
      provider: input.provider ?? null,
      event_type: event,
      detail: input.detail ?? null,
    });
  } catch (e) {
    console.error("[wappy-nus] falha a registar evento", event, (e as Error).message);
  }
}

type NumberRow = {
  id: string;
  organization_id: string;
  provider: string | null;
  phone_number_id: string | null;
  phone_e164: string;
};

/** Carrega o número (e por consequência a organização) de forma segura. */
async function loadNumber(whatsappNumberId: string): Promise<NumberRow> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("whatsapp_numbers")
    .select("id, organization_id, provider, phone_number_id, phone_e164")
    .eq("id", whatsappNumberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Número WhatsApp não encontrado.");
  return data as NumberRow;
}

export type IngestOutcome = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  conversationId?: string;
  contactId?: string;
  aiReplied: boolean;
  aiSkippedReason?: string;
};

/**
 * Grava a mensagem recebida (idempotente por wa_message_id) e, se a IA
 * automática estiver activa nessa conversa, gera e envia a resposta.
 */
export async function processIncomingMessage(
  whatsappNumberId: string,
  incoming: NormalizedIncoming,
): Promise<IngestOutcome> {
  const admin = serviceClient();
  const number = await loadNumber(whatsappNumberId);

  // 14. Nunca processar mensagens próprias (evita loops entre automações).
  if (incoming.fromMe) {
    return { ok: false, duplicate: false, reason: "own_message", aiReplied: false };
  }

  const { data, error } = await admin.rpc("ingest_provider_message", {
    _whatsapp_number_id: number.id,
    _from_wa_id: incoming.fromWaId,
    _profile_name: incoming.profileName,
    _wa_message_id: incoming.waMessageId,
    _message_type: incoming.messageType,
    _body: incoming.body,
    _media_id: incoming.mediaId,
    _sent_at: incoming.sentAt,
  });
  if (error) throw new Error(`Ingestão: ${error.message}`);

  const res = (data ?? {}) as {
    ok?: boolean;
    duplicate?: boolean;
    reason?: string;
    conversation_id?: string;
    contact_id?: string;
    ai_enabled?: boolean;
    assigned_to?: string | null;
    auto_reply?: boolean;
  };

  if (!res.ok) {
    return { ok: false, duplicate: Boolean(res.duplicate), reason: res.reason, aiReplied: false };
  }

  await logWhatsAppEvent(number.organization_id, "message_received", {
    whatsappNumberId: number.id,
    provider: incoming.provider,
    detail: { type: incoming.messageType, duplicate: Boolean(res.duplicate) },
  });

  // 14. Mensagem já processada antes → não repetir nada.
  if (res.duplicate) {
    return {
      ok: true,
      duplicate: true,
      conversationId: res.conversation_id,
      contactId: res.contact_id,
      aiReplied: false,
      aiSkippedReason: "duplicate",
    };
  }

  const base = {
    ok: true,
    duplicate: false,
    conversationId: res.conversation_id,
    contactId: res.contact_id,
  };

  // 12 + 13. IA automática só quando ligada na organização E na conversa,
  // e nunca quando um atendente humano assumiu a conversa.
  const skip = !res.auto_reply
    ? "auto_reply_off"
    : !res.ai_enabled
      ? "conversation_ai_off"
      : res.assigned_to
        ? "human_agent"
        : null;

  if (skip || !res.conversation_id) {
    if (skip) {
      await logWhatsAppEvent(number.organization_id, "ai_skipped", {
        whatsappNumberId: number.id,
        provider: incoming.provider,
        detail: { reason: skip },
      });
    }
    return { ...base, aiReplied: false, aiSkippedReason: skip ?? "no_conversation" };
  }

  // 14. Limite de frequência: no máximo 6 respostas automáticas por minuto
  // na mesma conversa (protege contra loops entre automações).
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", res.conversation_id)
    .eq("direction", "outbound")
    .eq("is_ai", true)
    .gte("created_at", since);
  if ((count ?? 0) >= 6) {
    await logWhatsAppEvent(number.organization_id, "ai_skipped", {
      whatsappNumberId: number.id,
      provider: incoming.provider,
      detail: { reason: "rate_limited" },
    });
    return { ...base, aiReplied: false, aiSkippedReason: "rate_limited" };
  }

  try {
    const { generateOrgAiReply } = await import("../ai.server");
    const history = await conversationHistory(res.conversation_id, number.organization_id);
    const { reply } = await generateOrgAiReply(
      number.organization_id,
      incoming.body ?? `[${incoming.messageType}]`,
      history,
    );
    await sendOutgoingMessage({
      organizationId: number.organization_id,
      whatsappNumberId: number.id,
      conversationId: res.conversation_id,
      body: reply,
      isAi: true,
    });
    return { ...base, aiReplied: true };
  } catch (e) {
    await logWhatsAppEvent(number.organization_id, "message_failed", {
      whatsappNumberId: number.id,
      provider: incoming.provider,
      detail: { stage: "ai_reply", error: (e as Error).message.slice(0, 300) },
    });
    return { ...base, aiReplied: false, aiSkippedReason: (e as Error).message };
  }
}

/** Histórico relevante da conversa, só daquela organização. */
export async function conversationHistory(
  conversationId: string,
  organizationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const admin = serviceClient();
  const { data } = await admin
    .from("messages")
    .select("direction, body, created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(13);

  return (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      role: (m as { direction: string }).direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: ((m as { body: string | null }).body ?? "").trim(),
    }))
    .filter((m) => m.content.length > 0)
    .slice(0, -1);
}

/**
 * Envia uma mensagem pelo provedor do próprio número da conversa e grava-a.
 * Serve para respostas da IA e para respostas manuais de atendentes.
 */
export async function sendOutgoingMessage(input: {
  organizationId: string;
  whatsappNumberId: string;
  conversationId: string;
  body: string;
  isAi?: boolean;
  sentBy?: string | null;
}): Promise<{ waMessageId: string | null; provider: string }> {
  const admin = serviceClient();
  const number = await loadNumber(input.whatsappNumberId);
  if (number.organization_id !== input.organizationId) {
    throw new Error("Número não pertence a esta organização.");
  }

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, contacts(phone_e164)")
    .eq("id", input.conversationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (convErr) throw new Error(convErr.message);
  const to = (conv as unknown as { contacts: { phone_e164: string } | null } | null)?.contacts?.phone_e164;
  if (!to) throw new Error("Conversa sem contacto com telefone.");

  const providerName = number.provider === "qr" ? "qr" : "meta_cloud";
  const provider = providerByName(providerName);
  const ref: SessionRef = { organizationId: input.organizationId, whatsappNumberId: number.id };

  let metaCreds: { phoneNumberId: string; token: string } | undefined;
  if (providerName === "meta_cloud") {
    if (!number.phone_number_id) throw new Error("Número sem Phone Number ID da Meta.");
    const { metaTokenForNumber } = await import("../whatsapp.server");
    metaCreds = { phoneNumberId: number.phone_number_id, token: await metaTokenForNumber(number.id) };
  }

  try {
    const sent = await provider.sendMessage({ ...ref, to, body: input.body, meta: metaCreds });
    await admin.from("messages").insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      direction: "outbound",
      message_type: "text",
      body: input.body,
      status: "sent",
      wa_message_id: sent.waMessageId,
      sent_by: input.sentBy ?? null,
      is_ai: Boolean(input.isAi),
    });
    await admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", input.conversationId);

    await logWhatsAppEvent(input.organizationId, "message_sent", {
      whatsappNumberId: number.id,
      provider: providerName,
      detail: { ai: Boolean(input.isAi) },
    });
    return { waMessageId: sent.waMessageId, provider: providerName };
  } catch (e) {
    await logWhatsAppEvent(input.organizationId, "message_failed", {
      whatsappNumberId: number.id,
      provider: providerName,
      detail: { error: (e as Error).message.slice(0, 300) },
    });
    throw e;
  }
}
