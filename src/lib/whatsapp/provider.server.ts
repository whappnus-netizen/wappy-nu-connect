/**
 * Wappy Nus — camada de providers do WhatsApp (SERVER-ONLY).
 *
 * A aplicação nunca fala directamente com um provedor concreto: fala com esta
 * interface. Existem hoje dois provedores:
 *
 *   - "meta_cloud" → WhatsApp Cloud API oficial da Meta (Graph API)   [PRESERVADO]
 *   - "qr"         → sessão multi-device por QR Code (bridge Baileys)  [NOVO]
 *
 * O provider "mock" continua disponível para desenvolvimento sem credenciais.
 * Acrescentar um terceiro provedor no futuro é só implementar esta interface e
 * registá-lo em `registry.server.ts` — nenhuma outra camada precisa mudar.
 */

export type ProviderName = "meta_cloud" | "qr" | "mock";

/** Estados normalizados da ligação, iguais para todos os provedores. */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr_pending"
  | "connected"
  | "reconnecting"
  | "error";

export type SessionRef = {
  organizationId: string;
  whatsappNumberId: string;
};

export type ConnectInput = SessionRef & {
  /** Credenciais/parâmetros específicos do provedor (Cloud API: token + ids). */
  meta?: { phoneNumberId: string; token: string };
};

export type ConnectResult = {
  status: ConnectionStatus;
  /** String bruta do QR Code, quando o provedor exige leitura no telefone. */
  qr?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
  error?: string | null;
};

export type StatusResult = ConnectResult;

export type SendMessageInput = SessionRef & {
  to: string;
  body: string;
  /** Só o provedor Meta usa estes campos. */
  meta?: { phoneNumberId: string; token: string };
};

export type SendResult = {
  waMessageId: string | null;
  provider: ProviderName;
};

export type NumberInfo = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  provider: ProviderName;
};

/** Mensagem recebida já normalizada — o resto da app não sabe a origem. */
export type NormalizedIncoming = {
  provider: ProviderName;
  waMessageId: string;
  fromWaId: string;
  profileName: string | null;
  messageType: "text" | "image" | "audio" | "video" | "document" | "system";
  body: string | null;
  mediaId: string | null;
  sentAt: string;
  fromMe: boolean;
};

export interface WhatsAppProvider {
  readonly name: ProviderName;

  /** Inicia (ou revalida) a ligação do número. */
  connect(input: ConnectInput): Promise<ConnectResult>;
  /** Encerra a sessão sem apagar histórico de CRM. */
  disconnect(input: SessionRef): Promise<void>;
  /** Envia uma mensagem de texto. */
  sendMessage(input: SendMessageInput): Promise<SendResult>;
  /** Estado actual da ligação. */
  getConnectionStatus(input: SessionRef): Promise<StatusResult>;
  /** Converte o payload cru do provedor no formato interno único. */
  handleIncomingMessage(raw: unknown): NormalizedIncoming | null;

  /** Específico da Cloud API (mantido para compatibilidade da Fase 2). */
  verifyNumber?(phoneNumberId: string, token: string): Promise<NumberInfo>;
  sendText?(input: {
    phoneNumberId: string;
    token: string;
    to: string;
    body: string;
  }): Promise<SendResult>;
  markRead?(phoneNumberId: string, token: string, waMessageId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider oficial: Meta WhatsApp Cloud API  (comportamento da Fase 2 intacto)
// ---------------------------------------------------------------------------

const GRAPH = "https://graph.facebook.com/v21.0";

function graphError(json: Record<string, unknown>, status: number): Error {
  const message =
    (json["error"] as { message?: string } | undefined)?.message ?? `Graph API respondeu ${status}`;
  return new Error(`Meta: ${message}`);
}

const SUPPORTED = ["text", "image", "audio", "video", "document"] as const;

/** Normaliza uma mensagem crua da Cloud API. */
export function normalizeMetaMessage(msg: {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string };
  button?: { text?: string };
  profileName?: string | null;
}): NormalizedIncoming | null {
  if (!msg.id || !msg.from) return null;
  const type = (SUPPORTED as readonly string[]).includes(msg.type ?? "text")
    ? (msg.type as NormalizedIncoming["messageType"])
    : "system";

  let body: string | null = null;
  let mediaId: string | null = null;
  switch (msg.type) {
    case "text":
      body = msg.text?.body ?? null;
      break;
    case "image":
      body = msg.image?.caption ?? null;
      mediaId = msg.image?.id ?? null;
      break;
    case "audio":
      mediaId = msg.audio?.id ?? null;
      break;
    case "video":
      body = msg.video?.caption ?? null;
      mediaId = msg.video?.id ?? null;
      break;
    case "document":
      body = msg.document?.filename ?? null;
      mediaId = msg.document?.id ?? null;
      break;
    case "button":
      body = msg.button?.text ?? null;
      break;
    default:
      body = msg.type ? `[${msg.type}]` : null;
  }

  return {
    provider: "meta_cloud",
    waMessageId: msg.id,
    fromWaId: msg.from,
    profileName: msg.profileName ?? null,
    messageType: msg.type === "button" ? "text" : type,
    body,
    mediaId,
    sentAt: msg.timestamp
      ? new Date(Number(msg.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    fromMe: false,
  };
}

export const metaProvider: WhatsAppProvider = {
  name: "meta_cloud",

  async verifyNumber(phoneNumberId, token) {
    const res = await fetch(
      `${GRAPH}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw graphError(json, res.status);
    return {
      id: String(json["id"] ?? phoneNumberId),
      displayPhoneNumber: (json["display_phone_number"] as string | undefined) ?? null,
      verifiedName: (json["verified_name"] as string | undefined) ?? null,
      qualityRating: (json["quality_rating"] as string | undefined) ?? null,
      provider: "meta_cloud",
    };
  },

  async sendText({ phoneNumberId, token, to, body }) {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { preview_url: false, body },
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw graphError(json, res.status);
    const waId = (json["messages"] as Array<{ id?: string }> | undefined)?.[0]?.id ?? null;
    return { waMessageId: waId, provider: "meta_cloud" };
  },

  async markRead(phoneNumberId, token, waMessageId) {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
    });
    if (!res.ok) throw graphError((await res.json()) as Record<string, unknown>, res.status);
  },

  async connect(input) {
    if (!input.meta) throw new Error("Cloud API: phoneNumberId e token são obrigatórios.");
    const info = await metaProvider.verifyNumber!(input.meta.phoneNumberId, input.meta.token);
    return {
      status: "connected",
      qr: null,
      phoneNumber: info.displayPhoneNumber,
      displayName: info.verifiedName,
      error: null,
    };
  },

  async disconnect() {
    /* A Cloud API não tem sessão persistente para encerrar. */
  },

  async sendMessage(input) {
    if (!input.meta) throw new Error("Cloud API: phoneNumberId e token são obrigatórios.");
    return metaProvider.sendText!({
      phoneNumberId: input.meta.phoneNumberId,
      token: input.meta.token,
      to: input.to,
      body: input.body,
    });
  },

  async getConnectionStatus(input) {
    const ref = input as SessionRef & { meta?: { phoneNumberId: string; token: string } };
    if (!ref.meta) return { status: "disconnected", qr: null };
    try {
      const info = await metaProvider.verifyNumber!(ref.meta.phoneNumberId, ref.meta.token);
      return { status: "connected", phoneNumber: info.displayPhoneNumber, displayName: info.verifiedName };
    } catch (e) {
      return { status: "error", error: (e as Error).message };
    }
  },

  handleIncomingMessage(raw) {
    return normalizeMetaMessage(raw as Parameters<typeof normalizeMetaMessage>[0]);
  },
};

// ---------------------------------------------------------------------------
// Provider de desenvolvimento (sem chamadas externas)
// ---------------------------------------------------------------------------

export const mockProvider: WhatsAppProvider = {
  name: "mock",

  async verifyNumber(phoneNumberId) {
    return {
      id: phoneNumberId,
      displayPhoneNumber: null,
      verifiedName: "Número de teste (mock)",
      qualityRating: "GREEN",
      provider: "mock",
    };
  },

  async sendText({ to }) {
    return { waMessageId: `mock.${Date.now()}.${to.replace(/\D/g, "")}`, provider: "mock" };
  },

  async markRead() {
    /* noop */
  },

  async connect() {
    return { status: "connected", qr: null, displayName: "Sessão mock" };
  },

  async disconnect() {
    /* noop */
  },

  async sendMessage({ to }) {
    return { waMessageId: `mock.${Date.now()}.${to.replace(/\D/g, "")}`, provider: "mock" };
  },

  async getConnectionStatus() {
    return { status: "connected", qr: null };
  },

  handleIncomingMessage(raw) {
    return normalizeMetaMessage(raw as Parameters<typeof normalizeMetaMessage>[0]);
  },
};

/**
 * Compatibilidade com a Fase 2/3: código antigo chama `whatsappProvider()` e
 * espera a Cloud API oficial. `WHATSAPP_PROVIDER=mock` continua a funcionar.
 */
export function whatsappProvider(): WhatsAppProvider {
  return process.env["WHATSAPP_PROVIDER"] === "mock" ? mockProvider : metaProvider;
}
