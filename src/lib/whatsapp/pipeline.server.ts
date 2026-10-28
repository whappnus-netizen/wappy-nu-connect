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
import type { NormalizedIncoming, OutgoingMedia, SessionRef } from "./provider.server";
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

/** Aguarda o intervalo configurado antes de solicitar o recibo real de leitura. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function waitForHumanReadDelay(seconds: number): Promise<void> {
  const delayMs = Math.round(Math.max(0, Math.min(10, seconds)) * 1000);
  return delayMs === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, delayMs));
}

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
  status: string;
  ai_enabled: boolean;
};

/** Carrega o número (e por consequência a organização) de forma segura. */
async function loadNumber(whatsappNumberId: string): Promise<NumberRow> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("whatsapp_numbers")
    .select("id, organization_id, provider, phone_number_id, phone_e164, status, ai_enabled")
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
async function persistMetaAttachment(number: NumberRow, incoming: NormalizedIncoming): Promise<void> {
  if (incoming.provider !== "meta_cloud" || !incoming.mediaId ||
      !["image", "audio", "video", "document"].includes(incoming.messageType)) return;
  try {
    const { metaTokenForNumber } = await import("../whatsapp.server");
    const token = await metaTokenForNumber(number.id);
    const metadataResponse = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(incoming.mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000),
    });
    const metadata = await metadataResponse.json() as Record<string, unknown>;
    if (!metadataResponse.ok || typeof metadata["url"] !== "string") throw new Error("A Meta não disponibilizou o URL do anexo.");
    const mediaUrl = new URL(metadata["url"]);
    const host = mediaUrl.hostname.toLowerCase();
    const trustedHost = host === "lookaside.fbsbx.com" || host.endsWith(".fbsbx.com") ||
      host.endsWith(".fbcdn.net") || host.endsWith(".whatsapp.net") || host === "graph.facebook.com";
    if (mediaUrl.protocol !== "https:" || !trustedHost) throw new Error("URL de mídia Meta não autorizada.");
    const mimeType = String(metadata["mime_type"] ?? incoming.mediaMimeType ?? "");
    const extensionByMime: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
      "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
      "audio/amr": "amr", "audio/wav": "wav", "application/pdf": "pdf",
      "video/mp4": "mp4", "video/3gpp": "3gp",
    };
    if (!extensionByMime[mimeType]) throw new Error("Tipo MIME do anexo não suportado: " + mimeType);
    const fileResponse = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!fileResponse.ok) throw new Error("Falha ao descarregar mídia Meta (HTTP " + fileResponse.status + ").");
    const bytes = await fileResponse.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error("Anexo vazio ou superior a 20 MB.");
    const safeId = incoming.waMessageId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath = `${number.organization_id}/${number.id}/${safeId}.${extensionByMime[mimeType]}`;
    const { error: uploadError } = await serviceClient().storage.from("whatsapp-incoming-media")
      .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    incoming.mediaId = storagePath;
    incoming.mediaMimeType = mimeType;
  } catch (error) {
    console.error("[wappnus] falha ao processar mídia Meta:", (error as Error).message);
    incoming.mediaId = null;
    incoming.body = "[O cliente enviou um anexo, mas não foi possível processá-lo. Não descrevas o conteúdo; pede ao cliente para reenviar ou descrever o que enviou.]";
    await logWhatsAppEvent(number.organization_id, "message_failed", {
      whatsappNumberId: number.id, provider: "meta_cloud",
      detail: { stage: "media_download", messageType: incoming.messageType, error: (error as Error).message.slice(0, 200) },
    });
  }
}

type MessageBehaviorSettings = { readDelaySeconds: number; responseDelaySeconds: number };

/** Lê as definições do agente atribuído; agentes antigos continuam compatíveis. */
async function getMessageBehaviorSettings(
  organizationId: string,
  whatsappNumberId: string,
): Promise<MessageBehaviorSettings> {
  const defaults: MessageBehaviorSettings = { readDelaySeconds: 1.5, responseDelaySeconds: 2 };
  const admin = serviceClient();
  try {
    const { data: assignment, error: assignmentError } = await admin
      .from("ai_agent_whatsapp_numbers")
      .select("agent_id")
      .eq("organization_id", organizationId)
      .eq("whatsapp_number_id", whatsappNumberId)
      .maybeSingle();
    if (assignmentError) throw assignmentError;

    let query = admin.from("ai_agents").select("config")
      .eq("organization_id", organizationId);
    if (assignment?.agent_id) {
      query = query.eq("id", assignment.agent_id);
    } else {
      query = query.eq("is_active", true).order("created_at", { ascending: true }).limit(1);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    const config = data?.config && typeof data.config === "object"
      ? data.config as Record<string, unknown>
      : {};

    const readValue = Number(config["readDelaySeconds"]);
    const responseValue = Number(config["responseDelaySeconds"]);
    const legacyMin = Number(config["responseDelayMinSeconds"]);
    const legacyMax = Number(config["responseDelayMaxSeconds"]);
    const legacyResponse = Number.isFinite(legacyMin) && Number.isFinite(legacyMax)
      ? (legacyMin + legacyMax) / 2
      : defaults.responseDelaySeconds;

    const readDelaySeconds = Number.isFinite(readValue)
      ? Math.round(Math.min(10, Math.max(0, readValue)) * 2) / 2
      : defaults.readDelaySeconds;
    const responseDelaySeconds = Number.isFinite(responseValue)
      ? Math.round(Math.min(15, Math.max(0, responseValue)) * 2) / 2
      : Math.round(Math.min(15, Math.max(0, legacyResponse)) * 2) / 2;
    return { readDelaySeconds, responseDelaySeconds };
  } catch (error) {
    console.warn("[whappnus] não foi possível ler os tempos de comportamento; a usar os padrões:", (error as Error).message);
    return defaults;
  }
}

function waitForResponseDelay(seconds: number): Promise<void> {
  const delayMs = Math.round(Math.max(0, Math.min(15, seconds)) * 1000);
  return delayMs === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, delayMs));
}

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

  await persistMetaAttachment(number, incoming);

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

  // A mensagem já está persistida e deduplicada. Falhas no recibo nunca bloqueiam a IA.
  const behavior = await getMessageBehaviorSettings(number.organization_id, number.id);
  const replyProvider = providerByName(number.provider === "qr" ? "qr" : "meta_cloud");
  let inboundMeta: { phoneNumberId: string; token: string } | undefined;
  if (number.provider !== "qr" && number.phone_number_id) {
    try {
      const { metaTokenForNumber } = await import("../whatsapp.server");
      inboundMeta = { phoneNumberId: number.phone_number_id, token: await metaTokenForNumber(number.id) };
    } catch (error) {
      console.warn("[whappnus] não foi possível preparar recibos de leitura:", (error as Error).message);
    }
  }
  await waitForHumanReadDelay(behavior.readDelaySeconds);
  try {
    await withTimeout(
      Promise.resolve(replyProvider.markIncomingRead?.({
        organizationId: number.organization_id,
        whatsappNumberId: number.id,
        to: incoming.fromWaId,
        waMessageId: incoming.waMessageId,
        ...(inboundMeta ? { meta: inboundMeta } : {}),
      }) ?? undefined),
      5000,
      "read_receipt_timeout",
    );
  } catch (error) {
    await logWhatsAppEvent(number.organization_id, "error", {
      whatsappNumberId: number.id, provider: incoming.provider,
      detail: { stage: "read_receipt", error: (error as Error).message.slice(0, 200) },
    });
  }

  if (!res.conversation_id) {
    return { ok: true, duplicate: false, contactId: res.contact_id, aiReplied: false, aiSkippedReason: "no_conversation" };
  }
  const base = {
    ok: true,
    duplicate: false,
    conversationId: res.conversation_id,
    contactId: res.contact_id,
  };

  const { data: conversationStateData, error: conversationStateError } = await admin
    .from("conversations").select("status, assigned_to, ai_enabled")
    .eq("id", res.conversation_id).eq("organization_id", number.organization_id).maybeSingle();
  if (conversationStateError || !conversationStateData) {
    await logWhatsAppEvent(number.organization_id, "error", {
      whatsappNumberId: number.id,
      provider: incoming.provider,
      detail: { stage: "conversation_state", error: conversationStateError?.message?.slice(0, 200) ?? "Conversation state not found" },
    });
    return { ...base, aiReplied: false, aiSkippedReason: "conversation_state_unavailable" };
  }
  const conversationState = conversationStateData as { status: string; assigned_to: string | null; ai_enabled: boolean };
  let currentStatus = conversationState.status;
  let currentAssignedTo = conversationState.assigned_to;
  const currentAiEnabled = Boolean(conversationState.ai_enabled);

  // Automações activas são avaliadas antes da IA para evitar respostas duplicadas.
  // A ordem é intencional: palavra-chave específica, fora de horário, boas-vindas.
  const inboundText = (incoming.body ?? "").trim().toLocaleLowerCase();
  if (currentStatus === "open" && (!currentAssignedTo || currentAiEnabled)) {
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
      type StoredStep = { kind?: string; text?: string; caption?: string; storagePath?: string; mimeType?: string; fileName?: string; durationMs?: number };
      type AutomationRow = { id: string; name: string; trigger_type: string; config: Record<string, unknown> | null };
      const activeRules = (rules ?? []) as AutomationRow[];
      const getReply = (rule: AutomationRow) => {
        const value = rule.config?.["reply"];
        return typeof value === "string" ? value.trim() : "";
      };
      const getSteps = (rule: AutomationRow): StoredStep[] => {
        const steps = rule.config?.["steps"];
        return Array.isArray(steps) ? steps as StoredStep[] : [];
      }
      const hasActions = (rule: AutomationRow) =>
        getReply(rule).length > 0 || getSteps(rule).some((step) =>
          step.kind === "text" ? Boolean(step.text?.trim()) :
          ["image", "audio", "video", "document"].includes(step.kind ?? "") && Boolean(step.storagePath && step.mimeType)
        );
      const keywordRule = activeRules
        .filter((rule) => rule.trigger_type === "keyword_match" && hasActions(rule))
        .sort((a, b) => {
          const aValue = a.config?.["keyword"];
          const bValue = b.config?.["keyword"];
          const aKeyword = typeof aValue === "string" ? aValue.trim() : "";
          const bKeyword = typeof bValue === "string" ? bValue.trim() : "";
          return bKeyword.length - aKeyword.length;
        })
        .find((rule) => {
          const value = rule.config?.["keyword"];
          const keyword = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
          return keyword.length >= 2 && inboundText.includes(keyword);
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
        const outsideRules = activeRules.filter((rule) => rule.trigger_type === "outside_business_hours" && hasActions(rule));
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
            const rawStart = rule.config?.["startTime"];
            const rawEnd = rule.config?.["endTime"];
            const startText = typeof rawStart === "string" ? rawStart : "09:00";
            const endText = typeof rawEnd === "string" ? rawEnd : "18:00";
            const startParts = startText.split(":").map(Number);
            const endParts = endText.split(":").map(Number);
            if (startParts.length !== 2 || endParts.length !== 2 || startParts.some(Number.isNaN) || endParts.some(Number.isNaN)) continue;
            const startHour = startParts[0], startMinute = startParts[1];
            const endHour = endParts[0], endMinute = endParts[1];
            if (startHour === undefined || startMinute === undefined || endHour === undefined || endMinute === undefined) continue;
            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            if (startMinutes === endMinutes) continue;
            const rawDays = rule.config?.["days"];
            const configuredDays = Array.isArray(rawDays)
              ? rawDays.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
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
            const cooldownMediaPath = getSteps(rule).find((step) =>
              (step.kind === "image" || step.kind === "audio") && Boolean(step.storagePath)
            )?.storagePath;
            const cooldownSince = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
            let priorReplyQuery = admin.from("messages").select("id")
              .eq("organization_id", number.organization_id)
              .eq("conversation_id", res.conversation_id)
              .eq("direction", "outbound")
              .gte("created_at", cooldownSince)
              .limit(1);
            if (cooldownMediaPath) priorReplyQuery = priorReplyQuery.eq("media_url", cooldownMediaPath);
            else if (reply) priorReplyQuery = priorReplyQuery.eq("body", reply);
            else continue;
            const { data: priorReply, error: priorReplyError } = await priorReplyQuery.maybeSingle();
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

      // Distribuição automática: atribui a nova conversa ao membro elegível com menor carga.
      // A atribuição mantém a conversa aberta e a IA activa; assumir atendimento desliga a IA.
      if (isFirstInbound && !currentAssignedTo) {
        const assignmentRule = activeRules.find((rule) =>
          rule.trigger_type === "conversation_created" && rule.config?.["actionType"] === "assign_agent"
        );
        if (assignmentRule) {
          const { data: memberRows, error: membersError } = await admin
            .from("memberships").select("user_id, role, created_at")
            .eq("organization_id", number.organization_id)
            .in("role", ["AGENT", "SUPERVISOR", "ADMIN", "OWNER"])
            .order("created_at", { ascending: true });
          if (membersError) {
            await logWhatsAppEvent(number.organization_id, "error", {
              whatsappNumberId: number.id,
              provider: incoming.provider,
              detail: { stage: "automation_assignment_members", error: membersError.message.slice(0, 200) },
            });
          } else {
            type TeamCandidate = { user_id: string; role: string; created_at: string | null };
            const members = (memberRows ?? []) as TeamCandidate[];
            const preferredRole = members.some((member) => member.role === "AGENT") ? "AGENT"
              : members.some((member) => member.role === "SUPERVISOR") ? "SUPERVISOR"
                : members.some((member) => member.role === "ADMIN") ? "ADMIN" : "OWNER";
            const candidates = members.filter((member) => member.role === preferredRole && Boolean(member.user_id));
            if (candidates.length === 0) {
              await logWhatsAppEvent(number.organization_id, "error", {
                whatsappNumberId: number.id,
                provider: incoming.provider,
                detail: { stage: "automation_assignment_members", error: "No eligible team member found" },
              });
            } else {
              const { data: assignedRows, error: loadError } = await admin
                .from("conversations").select("assigned_to")
                .eq("organization_id", number.organization_id)
                .in("status", ["open", "in_progress"]);
              if (loadError) {
                await logWhatsAppEvent(number.organization_id, "error", {
                  whatsappNumberId: number.id,
                  provider: incoming.provider,
                  detail: { stage: "automation_assignment_load", error: loadError.message.slice(0, 200) },
                });
              } else {
                const load = new Map<string, number>();
                for (const row of (assignedRows ?? []) as Array<{ assigned_to: string | null }>) {
                  if (row.assigned_to) load.set(row.assigned_to, (load.get(row.assigned_to) ?? 0) + 1);
                }
                candidates.sort((a, b) => (load.get(a.user_id) ?? 0) - (load.get(b.user_id) ?? 0));
                const chosen = candidates[0];
                if (chosen) {
                  const { data: assignedConversation, error: assignError } = await admin.from("conversations")
                    .update({ assigned_to: chosen.user_id, status: "open", updated_at: new Date().toISOString() })
                    .eq("id", res.conversation_id).eq("organization_id", number.organization_id)
                    .eq("status", "open").is("assigned_to", null).select("assigned_to").maybeSingle();
                  const assignedUserId = (assignedConversation as { assigned_to: string | null } | null)?.assigned_to;
                  if (assignError || !assignedUserId) {
                    await logWhatsAppEvent(number.organization_id, "error", {
                      whatsappNumberId: number.id,
                      provider: incoming.provider,
                      detail: { stage: "automation_assignment_update", error: assignError?.message?.slice(0, 200) ?? "Conversation was already assigned or its status changed" },
                    });
                  } else {
                    currentAssignedTo = assignedUserId;
                    currentStatus = "open";
                  }
                }
              }
            }
          }
        }
      }

      // Criação automática de oportunidade CRM na primeira mensagem, sem duplicar oportunidades abertas.
      if (isFirstInbound) {
        const crmRule = activeRules.find((rule) =>
          rule.trigger_type === "conversation_created" && rule.config?.["actionType"] === "create_deal"
        );
        if (crmRule) {
          if (!res.contact_id) {
            await logWhatsAppEvent(number.organization_id, "error", {
              whatsappNumberId: number.id,
              provider: incoming.provider,
              detail: { stage: "automation_crm_lead", error: "Conversation has no contact_id" },
            });
          } else {
            const { data: existingDeal, error: existingDealError } = await admin
              .from("deals").select("id")
              .eq("organization_id", number.organization_id)
              .eq("contact_id", res.contact_id).eq("status", "open")
              .limit(1).maybeSingle();
            if (existingDealError) {
              await logWhatsAppEvent(number.organization_id, "error", {
                whatsappNumberId: number.id,
                provider: incoming.provider,
                detail: { stage: "automation_crm_lookup", error: existingDealError.message.slice(0, 200) },
              });
            } else if (!existingDeal) {
              const [{ data: firstStage, error: stageError }, { data: contact, error: contactError }, { data: organization, error: organizationError }] = await Promise.all([
                admin.from("pipeline_stages").select("id").eq("organization_id", number.organization_id).order("position", { ascending: true }).limit(1).maybeSingle(),
                admin.from("contacts").select("full_name, profile_name").eq("organization_id", number.organization_id).eq("id", res.contact_id).maybeSingle(),
                admin.from("organizations").select("currency").eq("id", number.organization_id).maybeSingle(),
              ]);
              if (stageError || !firstStage) {
                await logWhatsAppEvent(number.organization_id, "error", {
                  whatsappNumberId: number.id,
                  provider: incoming.provider,
                  detail: { stage: "automation_crm_stage", error: stageError?.message?.slice(0, 200) ?? "No CRM stage configured" },
                });
              } else if (contactError) {
                await logWhatsAppEvent(number.organization_id, "error", {
                  whatsappNumberId: number.id,
                  provider: incoming.provider,
                  detail: { stage: "automation_crm_contact", error: contactError.message.slice(0, 200) },
                });
              } else if (organizationError) {
                await logWhatsAppEvent(number.organization_id, "error", {
                  whatsappNumberId: number.id,
                  provider: incoming.provider,
                  detail: { stage: "automation_crm_currency", error: organizationError.message.slice(0, 200) },
                });
              } else {
                const contactName = contact?.full_name?.trim() || contact?.profile_name?.trim();
                const title = contactName ? `Oportunidade — ${contactName}` : "Oportunidade WhatsApp";
                const { error: createDealError } = await admin.from("deals").insert({
                  organization_id: number.organization_id,
                  contact_id: res.contact_id,
                  stage_id: firstStage.id,
                  owner_id: currentAssignedTo,
                  title,
                  currency: organization?.currency || "AOA",
                  status: "open",
                });
                if (createDealError) {
                  await logWhatsAppEvent(number.organization_id, "error", {
                    whatsappNumberId: number.id,
                    provider: incoming.provider,
                    detail: { stage: "automation_crm_insert", error: createDealError.message.slice(0, 200) },
                  });
                }
              }
            }
          }
        }
      }

      // Boas-vindas só na primeira mensagem recebida da conversa.
      if (!selectedRule && isFirstInbound) {
        selectedRule = activeRules.find((rule) => rule.trigger_type === "conversation_created" && hasActions(rule));
        if (selectedRule) selectedReason = "welcome_automation";
      }

      if (selectedRule) {
        const reply = getReply(selectedRule);
        const configuredSteps = getSteps(selectedRule);
        const executionSteps: StoredStep[] = configuredSteps.length
          ? configuredSteps
          : (reply ? [{ kind: "text", text: reply }] : []);
        try {
          for (const step of executionSteps) {
            if (step.kind === "text") {
              const body = (step.text ?? "").trim();
              if (!body) continue;
              await sendOutgoingMessage({
                organizationId: number.organization_id,
                whatsappNumberId: number.id,
                conversationId: res.conversation_id,
                body,
                isAi: false,
              });
            } else if (["image", "audio", "video", "document"].includes(step.kind ?? "") && step.storagePath && step.mimeType) {
              await sendOutgoingMessage({
                organizationId: number.organization_id,
                whatsappNumberId: number.id,
                conversationId: res.conversation_id,
                body: step.caption ?? "",
                media: {
                  kind: step.kind as "image" | "audio" | "video" | "document",
                  storagePath: step.storagePath,
                  mimeType: step.mimeType,
                  ...(step.caption !== undefined ? { caption: step.caption } : {}),
                  ...(step.fileName !== undefined ? { fileName: step.fileName } : {}),
                  ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
                },
                isAi: false,
              });
            }
          }
          await logWhatsAppEvent(number.organization_id, "message_sent", {
            whatsappNumberId: number.id,
            provider: incoming.provider,
            detail: { automationRuleId: selectedRule.id, automation: true, triggerType: selectedRule.trigger_type, steps: executionSteps.length },
          });
          if (selectedReason !== "welcome_automation") {
            return { ...base, aiReplied: false, aiSkippedReason: selectedReason };
          }
          // A saudação não deve impedir a IA de responder à pergunta da primeira mensagem.
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
  const skip = !number.ai_enabled
    ? "whatsapp_ai_off"
    : number.status !== "connected"
      ? "whatsapp_not_connected"
      : currentAssignedTo && !currentAiEnabled
        ? "human_agent"
        : currentStatus !== "open"
          ? "conversation_not_open"
          : !res.auto_reply
            ? "auto_reply_off"
            : !currentAiEnabled
              ? "conversation_ai_off"
              : null;

  if (skip) {
    await logWhatsAppEvent(number.organization_id, "ai_skipped", {
      whatsappNumberId: number.id,
      provider: incoming.provider,
      detail: { reason: skip },
    });
    return { ...base, aiReplied: false, aiSkippedReason: skip };
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

  const showTypingIndicator = async () => {
    // QR/Baileys already emits "composing" while sending. Cloud API supports
    // the official read + typing indicator request while the model prepares a reply.
    if (number.provider === "qr") return;
    try {
      await replyProvider.showTypingIndicator?.({
        organizationId: number.organization_id,
        whatsappNumberId: number.id,
        to: incoming.fromWaId,
        waMessageId: incoming.waMessageId,
        ...(inboundMeta ? { meta: inboundMeta } : {}),
      });
    } catch (error) {
      await logWhatsAppEvent(number.organization_id, "error", {
        whatsappNumberId: number.id, provider: incoming.provider,
        detail: { stage: "typing_indicator", error: (error as Error).message.slice(0, 200) },
      });
    }
  };

  // Respostas determinísticas sobre pagamentos registados: nunca inferir pagamento apenas pelo comprovativo.
  const paymentQuestion = /\b(pagamento|pagamentos|transfer[eê]ncia|comprovativo|recibo|j[aá] paguei|foi pago|foi confirmado|confirmaram|receberam o valor|valor recebido|estado do pagamento|status do pagamento|liquidado|liquida[cç][aã]o)\b/i.test(incoming.body ?? "");
  if (paymentQuestion && (res.contact_id || res.conversation_id)) {
    const paymentQuery = admin.from("customer_payments")
      .select("status,amount_aoa,description,reference,received_at,confirmed_at")
      .eq("organization_id", number.organization_id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (res.contact_id) paymentQuery.eq("contact_id", res.contact_id);
    else paymentQuery.eq("conversation_id", res.conversation_id!);
    const paymentResult = await paymentQuery;
    if (paymentResult.error) {
      await logWhatsAppEvent(number.organization_id, "error", {
        whatsappNumberId: number.id, provider: incoming.provider,
        detail: { stage: "customer_payment_lookup", error: paymentResult.error.message.slice(0, 200) },
      });
    } else if ((paymentResult.data ?? []).length > 0) {
      const latest = paymentResult.data![0] as { status: string; amount_aoa: number; description: string; reference: string | null; received_at: string; confirmed_at: string | null };
      const amountText = new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 2 }).format(Number(latest.amount_aoa));
      const refText = latest.reference ? " Referência: " + latest.reference + "." : "";
      const dateText = new Date(latest.received_at).toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda" });
      const responseText = latest.status === "confirmed"
        ? "Confirmamos que o pagamento de " + amountText + " (" + latest.description + ") consta como confirmado no nosso registo." + refText
        : latest.status === "pending_review"
          ? "Encontrámos o registo do pagamento de " + amountText + " (" + latest.description + "), recebido em " + dateText + ", mas ainda está pendente de verificação. O comprovativo, por si só, não significa que o valor já foi confirmado." + refText
          : latest.status === "needs_review"
            ? "O pagamento de " + amountText + " (" + latest.description + ") está em revisão adicional. A equipa irá verificar e actualizar o estado." + refText
            : latest.status === "rejected"
              ? "O registo do pagamento de " + amountText + " (" + latest.description + ") foi rejeitado após revisão." + (latest.reference ? " Referência: " + latest.reference + "." : "") + " Contacte a equipa se precisar de esclarecer o motivo."
              : latest.status === "refunded"
                ? "O pagamento de " + amountText + " (" + latest.description + ") consta como reembolsado no nosso registo." + refText
                : latest.status === "cancelled"
                  ? "O registo do pagamento de " + amountText + " (" + latest.description + ") consta como cancelado." + refText
                  : "O pagamento de " + amountText + " consta como " + latest.status + " no nosso registo." + refText;
      await showTypingIndicator();
      await sendOutgoingMessage({
        organizationId: number.organization_id, whatsappNumberId: number.id,
        conversationId: res.conversation_id, body: responseText, isAi: true,
      });
      return { ...base, aiReplied: true };
    } else {
      const responseText = "Não encontrei um pagamento registado associado a esta conversa. Para a equipa confirmar, envie a referência da transferência ou o comprovativo. O pagamento só será confirmado depois de a equipa verificar a entrada do valor.";
      await showTypingIndicator();
      await sendOutgoingMessage({
        organizationId: number.organization_id, whatsappNumberId: number.id,
        conversationId: res.conversation_id, body: responseText, isAi: true,
      });
      return { ...base, aiReplied: true };
    }
  }

  try {
    // Só mostramos "a escrever" quando existe uma decisão válida de gerar resposta.
    // Na Cloud API o indicador acompanha a preparação; no QR o provider trata disso no envio.
    if (number.provider !== "qr") await showTypingIndicator();

    let ai: Awaited<ReturnType<typeof generateViaWhappNusAI>>;
    try {
      ai = await generateViaWhappNusAI({
        organizationId: number.organization_id,
        whatsappNumberId: number.id,
        conversationId: res.conversation_id,
        contactId: res.contact_id ?? null,
        messageId: incoming.waMessageId,
        fromWaId: incoming.fromWaId,
        profileName: incoming.profileName,
        text: incoming.body ?? `[O cliente enviou ${incoming.messageType}]`,
        messageType: incoming.messageType,
        mediaPath: incoming.mediaId?.startsWith(`${number.organization_id}/${number.id}/`)
          ? incoming.mediaId
          : null,
        mediaMimeType: incoming.mediaMimeType ?? null,
      });
    } catch (generationError) {
      const errorCode = (generationError as Error).message;
      await logWhatsAppEvent(number.organization_id, "message_failed", {
        whatsappNumberId: number.id,
        provider: incoming.provider,
        detail: { stage: "ai_generation", error: errorCode.slice(0, 200) },
      });
      // Não contornar limites de plano nem estados de atendimento intencionais.
      if (["AUTO_REPLY_DISABLED", "NO_ACTIVE_AGENT", "SUBSCRIPTION_REQUIRED", "ACCOUNT_SUSPENDED", "AI_CONVERSATIONS_EXHAUSTED", "PLAN_HAS_NO_AI_CONVERSATIONS"].includes(errorCode)) {
        return { ...base, aiReplied: false, aiSkippedReason: errorCode };
      }
      const fallbackText = "Peço desculpa, estou com uma dificuldade momentânea para processar a tua mensagem. Podes tentar novamente dentro de instantes? Se for urgente, a nossa equipa pode ajudar.";
      await sendOutgoingMessage({
        organizationId: number.organization_id,
        whatsappNumberId: number.id,
        conversationId: res.conversation_id,
        body: fallbackText,
        isAi: true,
      });
      return { ...base, aiReplied: true, aiSkippedReason: "ai_generation_fallback" };
    }

    await waitForResponseDelay(behavior.responseDelaySeconds);
    await sendOutgoingMessage({
      organizationId: number.organization_id,
      whatsappNumberId: number.id,
      conversationId: res.conversation_id,
      body: ai.text,
      isAi: true,
      ...(ai.reactionEmoji ? { reaction: { waMessageId: incoming.waMessageId, emoji: ai.reactionEmoji } } : {}),
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
  media?: { kind: "image" | "audio" | "video" | "document"; storagePath: string; mimeType: string; caption?: string; fileName?: string; durationMs?: number };
  isAi?: boolean;
  sentBy?: string | null;
  reaction?: { waMessageId: string; emoji: string };
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

  let outgoingMedia: OutgoingMedia | undefined;
  if (input.media) {
    const expectedPrefix = input.organizationId + "/";
    if (!input.media.storagePath.startsWith(expectedPrefix) || input.media.storagePath.includes("..")) {
      throw new Error("Caminho de mídia inválido para esta organização.");
    }
    if ((input.media.kind === "image" && !input.media.mimeType.startsWith("image/")) ||
        (input.media.kind === "audio" && !input.media.mimeType.startsWith("audio/")) ||
        (input.media.kind === "video" && !input.media.mimeType.startsWith("video/")) ||
        (input.media.kind === "document" && !input.media.mimeType)) {
      throw new Error("Tipo de mídia inválido.");
    }
    const { data: signed, error: signError } = await admin.storage
      .from("automation-media").createSignedUrl(input.media.storagePath, 300);
    if (signError || !signed?.signedUrl) throw new Error("Não foi possível preparar o ficheiro de mídia: " + (signError?.message ?? "URL temporário indisponível"));
    outgoingMedia = {
      kind: input.media.kind,
      url: signed.signedUrl,
      mimeType: input.media.mimeType,
      ...(input.media.caption !== undefined ? { caption: input.media.caption } : {}),
      ...(input.media.fileName !== undefined ? { fileName: input.media.fileName } : {}),
      storagePath: input.media.storagePath,
      ...(input.media.durationMs !== undefined ? { durationMs: input.media.durationMs } : {}),
    };
  }

  try {
    const sent = await provider.sendMessage({
      ...ref,
      to,
      body: input.body,
      ...(outgoingMedia ? { media: outgoingMedia } : {}),
      ...(metaCreds ? { meta: metaCreds } : {}),
    });
    const { error: messageInsertError } = await admin.from("messages").insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      whatsapp_number_id: input.whatsappNumberId,
      direction: "outbound",
      message_type: input.media?.kind ?? "text",
      body: input.media ? (input.media.caption || ({ image: "[Imagem enviada]", audio: "[Áudio enviado]", video: "[Vídeo enviado]", document: "[Documento enviado]" } as Record<string, string>)[input.media.kind]) : input.body,
      media_url: input.media?.storagePath ?? null,
      status: "sent",
      wa_message_id: sent.waMessageId,
      sent_at: new Date().toISOString(),
      sent_by: input.sentBy ?? null,
      is_ai: Boolean(input.isAi),
    });
    if (messageInsertError) throw new Error("Mensagem enviada, mas não foi possível gravar o histórico: " + messageInsertError.message);
    await admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", input.conversationId);

    if (input.reaction && provider.sendReaction) {
      try {
        await provider.sendReaction({
          ...ref,
          to,
          waMessageId: input.reaction.waMessageId,
          emoji: input.reaction.emoji,
          meta: metaCreds,
        });
      } catch (reactionError) {
        // A falha da reação nunca invalida uma resposta que já foi entregue.
        await logWhatsAppEvent(input.organizationId, "message_failed", {
          whatsappNumberId: number.id,
          provider: providerName,
          detail: { stage: "ai_reaction", error: (reactionError as Error).message.slice(0, 200) },
        });
      }
    }

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
