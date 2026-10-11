import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);

    const admin = serviceClient();

    // No QR Code o telefone real só existe depois de o WhatsApp ser autenticado.
    // Nunca usamos telefone falso. Se já houver uma sessão QR pendente sem telefone,
    // reutilizamo-la; caso contrário criamos um whatsapp_number com phone_e164 = null.
    let numberId: string;

    const { data: pendingNumber, error: pendingErr } = await admin
      .from("whatsapp_numbers")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("provider", "qr")
      .is("phone_e164", null)
      .in("status", ["pending", "connecting", "qr_pending", "reconnecting"])
      .limit(1)
      .maybeSingle();

    if (pendingErr) throw new Error(`Base de dados: ${pendingErr.message}`);

    if (pendingNumber) {
      numberId = (pendingNumber as { id: string }).id;
      const { error: updateErr } = await admin
        .from("whatsapp_numbers")
        .update({
          display_name: data.displayName ?? "WhatsApp (QR Code)",
          status: "connecting",
          last_error: null,
        })
        .eq("id", numberId)
        .eq("organization_id", data.organizationId);
      if (updateErr) throw new Error(`Base de dados: ${updateErr.message}`);
    } else {
      const { data: createdNumber, error: createErr } = await admin
        .from("whatsapp_numbers")
        .insert({
          organization_id: data.organizationId,
          display_name: data.displayName ?? "WhatsApp (QR Code)",
          phone_e164: null,
          provider: "qr",
          status: "connecting",
        })
        .select("id")
        .single();

      if (createErr) throw new Error(`Base de dados: ${createErr.message}`);
      numberId = (createdNumber as { id: string }).id;
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

/** Consulta o estado real da sessão no serviço de sessões e sincroniza a BD. */
export const refreshQrSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => orgNumber.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR"]);
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
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);
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
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);
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
      .select("id, provider, deleted_at")
      .eq("id", data.numberId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (numberError) throw new Error(numberError.message);
    if (!number) throw new Error("Ligação não encontrada nesta organização.");
    if (number.provider !== "qr") throw new Error("Esta operação só arquiva ligações QR.");
    if (number.deleted_at) return { ok: true, alreadyArchived: true };

    let bridgeError: string | null = null;
    if (qrBridgeConfigured()) {
      try {
        await qrProvider.disconnect({ organizationId: data.organizationId, whatsappNumberId: data.numberId });
      } catch (e) {
        bridgeError = (e as Error).message;
      }
    }

    const now = new Date().toISOString();
    const { error: sessionError } = await admin
      .from("whatsapp_sessions")
      .update({ status: "disconnected", qr_code: null, qr_expires_at: null, last_error: bridgeError, updated_at: now })
      .eq("organization_id", data.organizationId)
      .eq("whatsapp_number_id", data.numberId);
    if (sessionError) throw new Error(`Não foi possível encerrar a sessão: ${sessionError.message}`);

    const { error: archiveError } = await admin
      .from("whatsapp_numbers")
      .update({ status: "disconnected", deleted_at: now, disconnected_at: now, last_error: bridgeError, updated_at: now })
      .eq("id", data.numberId)
      .eq("organization_id", data.organizationId);
    if (archiveError) throw new Error(`Não foi possível arquivar a ligação: ${archiveError.message}`);

    await logWhatsAppEvent(data.organizationId, "disconnected", {
      whatsappNumberId: data.numberId,
      provider: "qr",
      detail: { archived: true, bridgeError: bridgeError ? bridgeError.slice(0, 200) : null },
    });
    return { ok: true, bridgeError };
  });
