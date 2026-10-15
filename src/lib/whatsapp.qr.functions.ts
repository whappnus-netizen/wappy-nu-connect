import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const phoneSchema = z.string().trim().regex(/^\+?[0-9\s()-]{8,20}$/, "Introduz o número com indicativo internacional, por exemplo +244923456789.");

/** Canonical database format: + followed by 8–15 digits, with no formatting characters. */
function normalizePhoneE164(value: string): string {
  let digits = value.replace(/\D/g, "");
  // Os números angolanos locais têm 9 dígitos. Quando o utilizador não inclui
  // o indicativo, normalizar para +244 em vez de guardar +938... como país.
  if (/^9[0-9]{8}$/.test(digits)) digits = `244${digits}`;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    throw new Error("Número inválido. Usa o indicativo internacional e 8 a 15 dígitos, por exemplo +244923456789.");
  }
  return `+${digits}`;
}

const orgOnly = z.object({ organizationId: z.string().uuid() });
const orgNumber = orgOnly.extend({ numberId: z.string().uuid() });

/**
 * Cria (ou reaproveita) o número + sessão QR da organização e pede um QR Code
 * ao serviço de sessões. Nunca devolve dados de autenticação ao browser —
 * apenas o estado e a string do QR, que é pública por natureza.
 */
export const startQrSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    orgOnly
      .extend({
        displayName: z.string().trim().min(2).max(80).optional(),
        phoneE164: phoneSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, requireActiveSubscription, requireWhatsAppConnectionCapacity, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);
    await requireActiveSubscription(data.organizationId);

    const admin = serviceClient();

    // No QR Code o telefone real só existe depois de o WhatsApp ser autenticado.
    // Nunca usamos telefone falso. Se já houver uma sessão QR pendente sem telefone,
    // reutilizamo-la; caso contrário criamos um whatsapp_number com phone_e164 = null.
    let numberId: string;

    const requestedPhone = data.phoneE164 ? normalizePhoneE164(data.phoneE164) : undefined;
    const phoneCandidates = requestedPhone
      ? [requestedPhone, ...(requestedPhone.startsWith("+244") ? [`+${requestedPhone.slice(4)}`] : [])]
      : [];
    const { data: phoneRows, error: phoneRowsError } = phoneCandidates.length
      ? await admin.from("whatsapp_numbers")
          .select("id,phone_e164,deleted_at,created_at")
          .eq("organization_id", data.organizationId)
          .eq("provider", "qr")
          .in("phone_e164", phoneCandidates)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

    if (phoneRowsError) throw new Error("Base de dados: " + phoneRowsError.message);

    // Escolher a ligação com mais histórico. Os registos arquivados são elegíveis
    // para reactivação: apagar uma ligação não deve tornar o número impossível de
    // voltar a ligar, nem separar conversas/contactos do número que os criou.
    let selectedPhone: { id: string; deleted_at: string | null } | null = null;
    if (phoneRows?.length) {
      const ids = phoneRows.map((row: { id: string }) => row.id);
      const [{ data: conversations, error: conversationsError }, { data: contacts, error: contactsError }] = await Promise.all([
        admin.from("conversations").select("whatsapp_number_id").in("whatsapp_number_id", ids),
        admin.from("contacts").select("whatsapp_number_id").in("whatsapp_number_id", ids),
      ]);
      if (conversationsError) throw new Error("Histórico: " + conversationsError.message);
      if (contactsError) throw new Error("Contactos: " + contactsError.message);
      const scores = new Map<string, number>();
      for (const row of conversations ?? []) {
        const id = (row as { whatsapp_number_id: string | null }).whatsapp_number_id;
        if (id) scores.set(id, (scores.get(id) ?? 0) + 100);
      }
      for (const row of contacts ?? []) {
        const id = (row as { whatsapp_number_id: string | null }).whatsapp_number_id;
        if (id) scores.set(id, (scores.get(id) ?? 0) + 1);
      }
      const ranked = [...phoneRows].sort((a: any, b: any) => {
        const activeDiff = Number(a.deleted_at === null) - Number(b.deleted_at === null);
        if (activeDiff !== 0) return -activeDiff;
        const scoreDiff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      selectedPhone = ranked[0] as { id: string; deleted_at: string | null };
    }

    // As ligações antigas do mesmo número podem ter deixado sockets QR pendentes
    // mesmo depois de arquivadas. Fecha apenas sessões associadas aos registos
    // duplicados/arquivados; não toca na sessão que vamos reutilizar nem no histórico.
    if (selectedPhone && phoneRows?.length) {
      const archivedIds = phoneRows
        .filter((row: { id: string }) => row.id !== selectedPhone!.id)
        .map((row: { id: string }) => row.id);
      if (archivedIds.length) {
        if (qrBridgeConfigured()) {
          for (const archivedId of archivedIds) {
            try {
              await qrProvider.disconnect({
                organizationId: data.organizationId,
                whatsappNumberId: archivedId,
              });
            } catch (cleanupError) {
              console.warn("[WhappNus] Não foi possível terminar sessão QR arquivada", archivedId, cleanupError);
            }
          }
        }
        const { error: staleSessionsError } = await admin
          .from("whatsapp_sessions")
          .update({
            status: "disconnected",
            qr_code: null,
            qr_expires_at: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .in("whatsapp_number_id", archivedIds)
          .in("status", ["connected", "connecting", "qr_pending", "reconnecting"]);
        if (staleSessionsError) throw new Error("Não foi possível limpar sessões QR arquivadas: " + staleSessionsError.message);
      }
    }

    if (selectedPhone) {
      numberId = selectedPhone.id;
      const { error: updateErr } = await admin
        .from("whatsapp_numbers")
        .update({
          phone_e164: requestedPhone,
          deleted_at: null,
          display_name: data.displayName ?? "WhatsApp (código)",
          status: "connecting",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", numberId)
        .eq("organization_id", data.organizationId);
      if (updateErr) throw new Error(`Base de dados: ${updateErr.message}`);
    } else {
      const { data: pendingNumber, error: pendingErr } = await admin
        .from("whatsapp_numbers")
        .select("id")
        .eq("organization_id", data.organizationId)
        .eq("provider", "qr")
        .is("deleted_at", null)
        .is("phone_e164", null)
        .in("status", ["pending", "connecting", "qr_pending", "reconnecting", "error", "disconnected"])
        .limit(1)
        .maybeSingle();

      if (pendingErr) throw new Error(`Base de dados: ${pendingErr.message}`);

      if (pendingNumber) {
        numberId = (pendingNumber as { id: string }).id;
        const { error: updateErr } = await admin
          .from("whatsapp_numbers")
          .update({
            display_name: data.displayName ?? "WhatsApp (QR Code)",
            ...(requestedPhone ? { phone_e164: requestedPhone } : {}),
            status: "connecting",
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", numberId)
          .eq("organization_id", data.organizationId);
        if (updateErr) throw new Error(`Base de dados: ${updateErr.message}`);
      } else {
        await requireWhatsAppConnectionCapacity(data.organizationId, requestedPhone);
        const { data: createdNumber, error: createErr } = await admin
          .from("whatsapp_numbers")
          .insert({
            organization_id: data.organizationId,
            display_name: data.displayName ?? "WhatsApp (QR Code)",
            phone_e164: requestedPhone ?? null,
            provider: "qr",
            status: "connecting",
          })
          .select("id")
          .single();

        if (createErr) throw new Error(`Base de dados: ${createErr.message}`);
        numberId = (createdNumber as { id: string }).id;
      }
    }

    // Sessão (uma por organização + número; lock impede duplicados).
    const { data: sessionId, error: sesErr } = await admin.rpc("upsert_whatsapp_session", {
      _organization_id: data.organizationId,
      _whatsapp_number_id: numberId,
      _provider: "qr",
      _status: "connecting",
    });
    if (sesErr) throw new Error(`Sessão: ${sesErr.message}`);

    await logWhatsAppEvent(data.organizationId, "connecting", {
      whatsappNumberId: numberId,
      sessionId: sessionId as string,
      provider: "qr",
    });

    if (!qrBridgeConfigured()) {
      await admin.rpc("update_whatsapp_session_status", {
        _session_id: sessionId as string,
        _status: "error",
        _qr: null,
        _phone_number: null,
        _display_name: null,
        _error: "Serviço de sessões WhatsApp (bridge) não configurado.",
      });
      return {
        numberId,
        sessionId: sessionId as string,
        status: "error" as const,
        qr: null,
        bridgeConfigured: false,
        error:
          "A ligação por QR Code precisa do serviço de sessões (bridge Baileys) alojado à parte. " +
          "Depois de o alojar, defina WHATSAPP_QR_BRIDGE_URL e WHATSAPP_QR_BRIDGE_SECRET.",
      };
    }

    try {
      const result = await qrProvider.connect({
        organizationId: data.organizationId,
        whatsappNumberId: numberId,
      });
      await admin.rpc("update_whatsapp_session_status", {
        _session_id: sessionId as string,
        _status: result.status,
        _qr: result.qr ?? null,
        _phone_number: result.phoneNumber ?? null,
        _display_name: result.displayName ?? null,
        _error: result.error ?? null,
      });
      return {
        numberId,
        sessionId: sessionId as string,
        status: result.status,
        qr: result.qr ?? null,
        bridgeConfigured: true,
        error: result.error ?? null,
      };
    } catch (e) {
      const message = (e as Error).message;
      await admin.rpc("update_whatsapp_session_status", {
        _session_id: sessionId as string,
        _status: "error",
        _qr: null,
        _phone_number: null,
        _display_name: null,
        _error: message.slice(0, 500),
      });
      return {
        numberId,
        sessionId: sessionId as string,
        status: "error" as const,
        qr: null,
        bridgeConfigured: true,
        error: message,
      };
    }
  });

/** Lista os grupos reais de uma sessão conectada. Só utilizadores Super Admin activos podem chamar esta operação. */
export const listSuperAdminGroups = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ numberId: z.string().uuid(), accessToken: z.string().min(20).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { serviceClient } = await import("./whatsapp.server");
    const { listQrGroups: fetchGroups } = await import("./whatsapp/qr.server");
    const tokenHeader = getRequestHeader("authorization") ?? "";
    const headerToken = tokenHeader.toLowerCase().startsWith("bearer ") ? tokenHeader.slice(7) : "";
    const token = data.accessToken ?? headerToken;
    if (!token) throw new Error("Sessão ausente. Inicia sessão novamente.");
    const admin = serviceClient();
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData.user) throw new Error("Sessão inválida ou expirada.");
    const { data: adminRow, error: adminError } = await admin.from("superadmin_users")
      .select("user_id").eq("user_id", userData.user.id).eq("is_active", true).maybeSingle();
    if (adminError) throw new Error(adminError.message);
    if (!adminRow) throw new Error("A descoberta de grupos está reservada à equipa Super Admin.");
    const { data: number, error } = await admin.from("whatsapp_numbers")
      .select("id,organization_id,provider,status").eq("id", data.numberId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    if (!number || number.provider !== "qr") throw new Error("Escolhe uma ligação QR/Baileys válida.");
    return fetchGroups({ organizationId: number.organization_id, whatsappNumberId: number.id });
  });

/** Gera código de associação WhatsApp em vez de QR. A autorização é validada no servidor. */
export const requestQrPairingCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgOnly.extend({ numberId: z.string().uuid(), phoneE164: phoneSchema }).parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, requireActiveSubscription, serviceClient } = await import("./whatsapp.server");
    const { requestQrPairingCode: requestCode } = await import("./whatsapp/qr.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);
    await requireActiveSubscription(data.organizationId);
    const admin = serviceClient();
    const { data: number, error } = await admin.from("whatsapp_numbers")
      .select("id,provider").eq("id", data.numberId).eq("organization_id", data.organizationId)
      .is("deleted_at", null).maybeSingle();
    if (error) throw new Error(error.message);
    if (!number || number.provider !== "qr") throw new Error("A ligação WhatsApp não pertence a esta organização.");
    const phone = normalizePhoneE164(data.phoneE164);
    const code = await requestCode({ organizationId: data.organizationId, whatsappNumberId: data.numberId }, phone);
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("whatsapp_numbers")
      .update({ phone_e164: phone, status: "connecting", last_error: null, updated_at: now })
      .eq("id", data.numberId).eq("organization_id", data.organizationId);
    if (updateError) throw new Error(updateError.message);
    const { error: sessionUpdateError } = await admin.from("whatsapp_sessions")
      .update({ status: "connecting", qr_code: null, qr_expires_at: null, last_error: null, updated_at: now })
      .eq("organization_id", data.organizationId).eq("whatsapp_number_id", data.numberId);
    if (sessionUpdateError) throw new Error(sessionUpdateError.message);
    return { code, numberId: data.numberId };
  });

/** Consulta o estado real da sessão no serviço de sessões e sincroniza a BD. */
export const refreshQrSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgNumber.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, requireActiveSubscription, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR"]);
    await requireActiveSubscription(data.organizationId);
    if (!qrBridgeConfigured()) return { status: "error" as const, qr: null, error: "Bridge não configurado." };

    const admin = serviceClient();
    const { data: session } = await admin
      .from("whatsapp_sessions")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("whatsapp_number_id", data.numberId)
      .maybeSingle();

    try {
      const result = await qrProvider.getConnectionStatus({
        organizationId: data.organizationId,
        whatsappNumberId: data.numberId,
      });
      if (session) {
        await admin.rpc("update_whatsapp_session_status", {
          _session_id: (session as { id: string }).id,
          _status: result.status,
          _qr: result.qr ?? null,
          _phone_number: result.phoneNumber ?? null,
          _display_name: result.displayName ?? null,
          _error: result.error ?? null,
        });
      }
      return { status: result.status, qr: result.qr ?? null, error: result.error ?? null };
    } catch (e) {
      return { status: "error" as const, qr: null, error: (e as Error).message };
    }
  });

/**
 * Encerra a sessão. Mantém contactos, conversas e mensagens (CRM intacto):
 * apenas a ligação é desfeita, e pode ser refeita mais tarde.
 */
export const disconnectQrSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgNumber.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);

    const admin = serviceClient();
    let bridgeError: string | null = null;
    if (qrBridgeConfigured()) {
      try {
        await qrProvider.disconnect({
          organizationId: data.organizationId,
          whatsappNumberId: data.numberId,
        });
      } catch (e) {
        bridgeError = (e as Error).message;
      }
    }

    const { error } = await admin.rpc("disconnect_whatsapp_session", {
      _organization_id: data.organizationId,
      _whatsapp_number_id: data.numberId,
      _error: bridgeError,
    });
    if (error) throw new Error(error.message);

    await logWhatsAppEvent(data.organizationId, "disconnected", {
      whatsappNumberId: data.numberId,
      provider: "qr",
      detail: bridgeError ? { bridgeError: bridgeError.slice(0, 200) } : null,
    });
    return { ok: true, bridgeError };
  });

/** Religa uma sessão existente (mesmo número, mesma organização). */
export const reconnectQrSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgNumber.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, requireActiveSubscription, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);
    await requireActiveSubscription(data.organizationId);
    if (!qrBridgeConfigured()) {
      return { status: "error" as const, qr: null, error: "Serviço de sessões não configurado." };
    }

    const admin = serviceClient();
    const { data: sessionId, error: sesErr } = await admin.rpc("upsert_whatsapp_session", {
      _organization_id: data.organizationId,
      _whatsapp_number_id: data.numberId,
      _provider: "qr",
      _status: "connecting",
    });
    if (sesErr) throw new Error(`Sessão: ${sesErr.message}`);

    await logWhatsAppEvent(data.organizationId, "reconnecting", {
      whatsappNumberId: data.numberId,
      sessionId: sessionId as string,
      provider: "qr",
    });

    try {
      const result = await qrProvider.connect({
        organizationId: data.organizationId,
        whatsappNumberId: data.numberId,
      });
      await admin.rpc("update_whatsapp_session_status", {
        _session_id: sessionId as string,
        _status: result.status,
        _qr: result.qr ?? null,
        _phone_number: result.phoneNumber ?? null,
        _display_name: result.displayName ?? null,
        _error: result.error ?? null,
      });
      return { status: result.status, qr: result.qr ?? null, error: result.error ?? null };
    } catch (e) {
      return { status: "error" as const, qr: null, error: (e as Error).message };
    }
  });

/** Liga/desliga a IA automática numa conversa (controle humano por conversa). */
export const setConversationAi = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    orgOnly.extend({ conversationId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, requireActiveSubscription, serviceClient } = await import("./whatsapp.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);
    if (data.enabled) await requireActiveSubscription(data.organizationId);
    const admin = serviceClient();
    const { error } = await admin
      .from("conversations")
      .update({ ai_enabled: data.enabled })
      .eq("id", data.conversationId)
      .eq("organization_id", data.organizationId);
    if (error) throw new Error(error.message);
    return { ok: true, enabled: data.enabled };
  });


/**
 * Arquiva uma ligação QR sem apagar conversas, contactos ou mensagens.
 * A ligação deixa de aparecer na lista, mas o histórico permanece íntegro.
 */
export const archiveQrConnection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgNumber.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);

    const admin = serviceClient();
    const { data: number, error: numberError } = await admin
      .from("whatsapp_numbers")
      .select("id, provider, status, deleted_at")
      .eq("id", data.numberId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (numberError) throw new Error(numberError.message);
    if (!number) throw new Error("Ligação não encontrada nesta organização.");
    const isQr = number.provider === "qr";
    if (number.deleted_at) return { ok: true, alreadyArchived: true };

    let bridgeError: string | null = null;
    if (isQr && qrBridgeConfigured()) {
      try {
        await qrProvider.disconnect({ organizationId: data.organizationId, whatsappNumberId: data.numberId });
      } catch (e) {
        bridgeError = (e as Error).message;
      }
    }

    if (bridgeError) throw new Error(`Não foi possível confirmar a desconexão no motor WhatsApp. A ligação não foi apagada: ${bridgeError}`);
    if (isQr && !qrBridgeConfigured() && number.status === "connected") {
      throw new Error("O motor QR não está configurado; não é seguro apagar uma ligação que pode continuar activa.");
    }

    const now = new Date().toISOString();
    // Remove session state and stored credentials; preserve CRM history and soft-delete
    // the number so conversations retain their foreign keys while the phone can be reused.
    const { error: sessionError } = await admin
      .from("whatsapp_sessions")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("whatsapp_number_id", data.numberId);
    if (sessionError) throw new Error(`Não foi possível remover a sessão: ${sessionError.message}`);

    const { error: credentialError } = await admin
      .from("whatsapp_credentials")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("whatsapp_number_id", data.numberId);
    if (credentialError) throw new Error(`Não foi possível remover as credenciais: ${credentialError.message}`);

    const { error: archiveError } = await admin
      .from("whatsapp_numbers")
      .update({ status: "disconnected", deleted_at: now, disconnected_at: now, last_error: null, updated_at: now })
      .eq("id", data.numberId)
      .eq("organization_id", data.organizationId);
    if (archiveError) throw new Error(`Não foi possível remover a ligação: ${archiveError.message}`);

    await logWhatsAppEvent(data.organizationId, "disconnected", {
      whatsappNumberId: data.numberId,
      provider: number.provider,
      detail: { deleted: true },
    });
    return { ok: true, bridgeError };
  });
