/**
 * Wappy Nus — provider WhatsApp por QR Code (SERVER-ONLY).
 *
 * IMPORTANTE (honestidade técnica):
 * A app corre num runtime serverless (Cloudflare Workers). Uma sessão
 * multi-device de WhatsApp (Baileys) precisa de um socket WebSocket permanente
 * e de estado de autenticação em disco — coisas que este runtime NÃO consegue
 * manter. Por isso este provider é um CLIENTE HTTP de um serviço "bridge"
 * Baileys hospedado separadamente (código em `bridge/`, ver bridge/README.md).
 *
 * Divisão de responsabilidades:
 *   - bridge (Node, hospedado por si): socket Baileys, auth state, QR, reconexão
 *   - esta app: sessões na base de dados, multi-tenant, CRM, IA, interface
 *
 * Sem bridge configurado (WHATSAPP_QR_BRIDGE_URL), nada é simulado: as funções
 * falham com uma mensagem explícita.
 *
 * Nenhum dado de autenticação da sessão passa por aqui para o browser.
 */
import type {
  ConnectInput,
  ConnectResult,
  NormalizedIncoming,
  SendMessageInput,
  SendResult,
  SessionRef,
  StatusResult,
  WhatsAppProvider,
} from "./provider.server";

type BridgeSession = {
  status?: string;
  qr?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
  error?: string | null;
};

function bridgeConfig(): { url: string; secret: string } {
  const url = process.env["WHATSAPP_QR_BRIDGE_URL"];
  const secret = process.env["WHATSAPP_QR_BRIDGE_SECRET"];
  if (!url || !secret) {
    throw new Error(
      "Ligação por QR Code indisponível: o serviço de sessões (bridge Baileys) ainda não está configurado. " +
        "Defina WHATSAPP_QR_BRIDGE_URL e WHATSAPP_QR_BRIDGE_SECRET.",
    );
  }
  return { url: url.replace(/\/+$/, ""), secret };
}

export function qrBridgeConfigured(): boolean {
  return Boolean(process.env["WHATSAPP_QR_BRIDGE_URL"] && process.env["WHATSAPP_QR_BRIDGE_SECRET"]);
}

/** ID de sessão determinístico: isola sempre por organização + número. */
export function qrSessionKey(ref: SessionRef): string {
  return `${ref.organizationId}:${ref.whatsappNumberId}`;
}

async function bridgeFetch<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const { url, secret } = bridgeConfig();
  let res: Response;
  try {
    const request: RequestInit = {
      method: init.method,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
    };
    if (init.body !== undefined) request.body = JSON.stringify(init.body);
    res = await fetch(`${url}${path}`, request);
  } catch (e) {
    throw new Error(`Serviço de sessões WhatsApp inacessível: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Serviço de sessões WhatsApp respondeu ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function mapStatus(raw: string | undefined): ConnectResult["status"] {
  switch (raw) {
    case "connected":
    case "connecting":
    case "qr_pending":
    case "reconnecting":
    case "error":
    case "disconnected":
      return raw;
    default:
      return "disconnected";
  }
}

export const qrProvider: WhatsAppProvider = {
  name: "qr",

  async connect(input: ConnectInput): Promise<ConnectResult> {
    const s = await bridgeFetch<BridgeSession>("/sessions", {
      method: "POST",
      body: {
        sessionId: qrSessionKey(input),
        organizationId: input.organizationId,
        whatsappNumberId: input.whatsappNumberId,
      },
    });
    return {
      status: mapStatus(s.status),
      qr: s.qr ?? null,
      phoneNumber: s.phoneNumber ?? null,
      displayName: s.displayName ?? null,
      error: s.error ?? null,
    };
  },

  async disconnect(ref: SessionRef): Promise<void> {
    await bridgeFetch(`/sessions/${encodeURIComponent(qrSessionKey(ref))}`, { method: "DELETE" });
  },

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    const out = await bridgeFetch<{ waMessageId?: string | null }>(
      `/sessions/${encodeURIComponent(qrSessionKey(input))}/messages`,
      { method: "POST", body: { to: input.to, body: input.body } },
    );
    return { waMessageId: out.waMessageId ?? null, provider: "qr" };
  },

  async getConnectionStatus(ref: SessionRef): Promise<StatusResult> {
    const s = await bridgeFetch<BridgeSession>(
      `/sessions/${encodeURIComponent(qrSessionKey(ref))}`,
      { method: "GET" },
    );
    return {
      status: mapStatus(s.status),
      qr: s.qr ?? null,
      phoneNumber: s.phoneNumber ?? null,
      displayName: s.displayName ?? null,
      error: s.error ?? null,
    };
  },

  /** Normaliza o evento de mensagem enviado pelo bridge Baileys. */
  handleIncomingMessage(raw: unknown): NormalizedIncoming | null {
    const m = raw as {
      waMessageId?: string;
      fromWaId?: string;
      profileName?: string | null;
      messageType?: string;
      body?: string | null;
      mediaId?: string | null;
      sentAt?: string;
      fromMe?: boolean;
    };
    if (!m?.waMessageId || !m.fromWaId) return null;

    const allowed = ["text", "image", "audio", "video", "document"] as const;
    const type = (allowed as readonly string[]).includes(m.messageType ?? "")
      ? (m.messageType as NormalizedIncoming["messageType"])
      : "system";

    return {
      provider: "qr",
      waMessageId: m.waMessageId,
      fromWaId: m.fromWaId.replace(/[^0-9]/g, ""),
      profileName: m.profileName ?? null,
      messageType: type,
      body: m.body ?? null,
      mediaId: m.mediaId ?? null,
      sentAt: m.sentAt ?? new Date().toISOString(),
      fromMe: Boolean(m.fromMe),
    };
  },
};
