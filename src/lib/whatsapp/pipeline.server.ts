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
import { generateViaWhappNusAI } from "../ai-engine.server";
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
  reason?: string | undefined;
  conversationId?: string | undefined;
  contactId?: string | undefined;
  aiReplied: boolean;
  aiSkippedReason?: string | undefined;
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

  // Automações activas são avaliadas antes da IA para evitar respostas duplicadas.
  // A ordem é intencional: palavra-chave específica, fora de horário, boas-vindas.
  const inboundText = (incoming.body ?? "").trim().toLocaleLowerCase();
  if (res.conversation_id && !res.assigned_to) {
    const { data: rules, error: rulesError } = await admin
      .from("automation_rules")
      .select("id, name, trigger_type, config")
      .eq("organization_id", number.organization_id)
      .in("trigger_type", ["keyword_match", "outside_business_hours", "conversation_created"])
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(100);

    if (rulesError) {
      await logWhatsAppEvent(number.organization_id, "error", {
        whatsappNumberId: number.id,
        provider: incoming.provider,
        detail: { stage: "automation_lookup", error: rulesError.message.slice(0, 200) },
      });
    } else {
      type AutomationRow = { id: string; name: string; trigger_type: string; config: Record<string, unknown> | null };
      const activeRules = (rules ?? []) as AutomationRow[];
      const getReply = (rule: AutomationRow) => typeof rule.config?.["reply"] === "string" ? rule.config.reply.trim() : "";
      const keywordRule = activeRules.find((rule) => {
        if (rule.trigger_type !== "keyword_match") return false;
        const keyword = typeof rule.config?.["keyword"] === "string" ? rule.config.keyword.trim().toLocaleLowerCase() : "";
        return keyword.length >= 2 && getReply(rule).length > 0 && inboundText.includes(keyword);
      });

      let selectedRule: AutomationRow | undefined = keywordRule;
      let selectedReason = "keyword_automation";

      // Conta as mensagens recebidas para identificar a primeira mensagem da conversa.
      const { count: inboundCount, error: inboundCountError } = await admin
        .from("messages").select("id", { count: "exact", head: true })
        .eq("organization_id", number.organization_id)
        .eq("conversation_id", res.conversation_id)
        .eq("direction", "inbound");
      if (inboundCountError) {
        await logWhatsAppEvent(number.organization_id, "error", {
          whatsappNumberId: number.id,
          provider: incoming.provider,
          detail: { stage: "automation_inbound_count", error: inboundCountError.message.slice(0, 200) },
        });
      }
      const isFirstInbound = !inboundCountError && inboundCount === 1;

      // Fora de horário usa o fuso horário persistido na organização.
      if (!selectedRule) {
        const outsideRules = activeRules.filter((rule) => rule.trigger_type === "outside_business_hours" && getReply(rule).length > 0);
        if (outsideRules.length > 0) {
          const { data: org } = await admin.from("organizations").select("timezone").eq("id", number.organization_id).maybeSingle();
          const timezone = typeof org?.timezone === "string" && org.timezone ? org.timezone : "Africa/Luanda";
          const messageDate = incoming.sentAt ? new Date(incoming.sentAt) : new Date();
          const safeDate = Number.isNaN(messageDate.getTime()) ? new Date() : messageDate;

          const getLocalClock = (date: Date, zone: string) => {
            const parts = new Intl.DateTimeFormat("en-US", {
              timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
            }).formatToParts(date);
            const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
            const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            return {
              day: weekdayMap[values["weekday"] ?? ""] ?? 0,
              minutes: Number(values["hour"] ?? "0") * 60 + Number(values["minute"] ?? "0"),
            };
          };

          for (const rule of outsideRules) {
            const startText = typeof rule.config?.["startTime"] === "string" ? rule.config.startTime : "09:00";
            const endText = typeof rule.config?.["endTime"] === "string" ? rule.config.endTime : "18:00";
            const startParts = startText.split(":").map(Number);
            const endParts = endText.split(":").map(Number);
            if (startParts.length !== 2 || endParts.length !== 2 || startParts.some(Number.isNaN) || endParts.some(Number.isNaN)) continue;
            const startHour = startParts[0], startMinute = startParts[1];
            const endHour = endParts[0], endMinute = endParts[1];
            if (startHour === undefined || startMinute === undefined || endHour === undefined || endMinute === undefined) continue;
            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            if (startMinutes === endMinutes) continue;
            const configuredDays = Array.isArray(rule.config?.["days"])
              ? rule.config.days.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
              : [1, 2, 3, 4, 5];
            let localClock: { day: number; minutes: number };
            try { localClock = getLocalClock(safeDate, timezone); }
            catch { localClock = getLocalClock(safeDate, "Africa/Luanda"); }
            const withinHours = startMinutes < endMinutes
              ? configuredDays.includes(localClock.day) && localClock.minutes >= startMinutes && localClock.minutes < endMinutes
              : configuredDays.includes(localClock.day) && localClock.minutes >= startMinutes
                || configuredDays.includes((localClock.day + 6) % 7) && localClock.minutes < endMinutes;
            if (withinHours) continue;

            const reply = getReply(rule);
            const cooldownSince = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
            const { data: priorReply, error: priorReplyError } = await admin
              .from("messages").select("id").eq("organization_id", number.organization_id)
              .eq("conversation_id", res.conversation_id).eq("direction", "outbound")
              .eq("body", reply).gte("created_at", cooldownSince).limit(1).maybeSingle();
            if (priorReplyError) {
              await logWhatsAppEvent(number.organization_id, "error", {
                whatsappNumberId: number.id,
                provider: incoming.provider,
                detail: { stage: "automation_cooldown", error: priorReplyError.message.slice(0, 200) },
              });
              selectedReason = "outside_hours_check_failed";
              break;
            }
            if (priorReply) {
              return { ...base, aiReplied: false, aiSkippedReason: "outside_hours_already_replied" };
            }
            selectedRule = rule;
            selectedReason = "outside_hours_automation";
            break;
          }
        }
      }

      // Boas-vindas só na primeira mensagem recebida da conversa.
      if (!selectedRule && isFirstInbound) {
        selectedRule = activeRules.find((rule) => rule.trigger_type === "conversation_created" && getReply(rule).length > 0);
        if (selectedRule) selectedReason = "welcome_automation";
      }

      if (selectedRule) {
        const reply = getReply(selectedRule);
        try {
          await sendOutgoingMessage({
            organizationId: number.organization_id,
            whatsappNumberId: number.id,
            conversationId: res.conversation_id,
            body: reply,
            isAi: false,
          });
          await logWhatsAppEvent(number.organization_id, "message_sent", {
            whatsappNumberId: number.id,
            provider: incoming.provider,
            detail: { automationRuleId: selectedRule.id, automation: true, triggerType: selectedRule.trigger_type },
          });
          return { ...base, aiReplied: false, aiSkippedReason: selectedReason };
        } catch (e) {
          await logWhatsAppEvent(number.organization_id, "message_failed", {
            whatsappNumberId: number.id,
            provider: incoming.provider,
            detail: { stage: selectedReason, ruleId: selectedRule.id, error: (e as Error).message.slice(0, 200) },
          });
          // Não chamar a IA depois de uma falha ambígua de envio: evita duplicação.
          return { ...base, aiReplied: false, aiSkippedReason: "automation_send_failed" };
        }
      }
    }
  }

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
    const ai = await generateViaWhappNusAI({
      organizationId: number.organization_id,
      whatsappNumberId: number.id,
      conversationId: res.conversation_id,
      contactId: res.contact_id ?? null,
      messageId: incoming.waMessageId,
      fromWaId: incoming.fromWaId,
      profileName: incoming.profileName,
      text: incoming.body ?? `[${incoming.messageType}]`,
    });
    await sendOutgoingMessage({
      organizationId: number.organization_id,
      whatsappNumberId: number.id,
      conversationId: res.conversation_id,
      body: ai.text,
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
