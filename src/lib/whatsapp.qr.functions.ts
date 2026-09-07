import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,15}$/, "Telefone deve estar em formato E.164, ex.: +244912345678");

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
        displayName: z.string().trim().min(2).max(80),
        phoneE164: phone,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { qrProvider, qrBridgeConfigured } = await import("./whatsapp/qr.server");
    const { logWhatsAppEvent } = await import("./whatsapp/pipeline.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);

    const admin = serviceClient();

    // Número (reutiliza whatsapp_numbers — nada de tabela paralela).
    const { data: numberRow, error: numErr } = await admin
      .from("whatsapp_numbers")
      .upsert(
        {
          organization_id: data.organizationId,
          display_name: data.displayName,
          phone_e164: data.phoneE164,
          provider: "qr",
          status: "connecting",
        },
        { onConflict: "organization_id,phone_e164" },
      )
      .select("id, provider")
      .single();
    if (numErr) throw new Error(`Base de dados: ${numErr.message}`);
    const numberId = (numberRow as { id: string }).id;

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
