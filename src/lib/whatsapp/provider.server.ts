/**
 * Wappy Nus — camada de provider do WhatsApp (SERVER-ONLY).
 *
 * A aplicação nunca fala directamente com a Graph API: fala com esta interface.
 * Assim é possível desenvolver e testar toda a Fase 3 sem credenciais reais da
 * Meta (`WHATSAPP_PROVIDER=mock`) e ligar as credenciais depois sem tocar em
 * nenhuma outra camada (`WHATSAPP_PROVIDER=meta`, o valor por omissão).
 */

export type ProviderName = "meta" | "mock";

export type SendTextInput = {
  phoneNumberId: string;
  token: string;
  to: string;
  body: string;
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

export interface WhatsAppProvider {
  readonly name: ProviderName;
  verifyNumber(phoneNumberId: string, token: string): Promise<NumberInfo>;
  sendText(input: SendTextInput): Promise<SendResult>;
  markRead(phoneNumberId: string, token: string, waMessageId: string): Promise<void>;
}

const GRAPH = "https://graph.facebook.com/v21.0";

function graphError(json: Record<string, unknown>, status: number): Error {
  const message =
    (json["error"] as { message?: string } | undefined)?.message ?? `Graph API respondeu ${status}`;
  return new Error(`Meta: ${message}`);
}

export const metaProvider: WhatsAppProvider = {
  name: "meta",

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
      provider: "meta",
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
    return { waMessageId: waId, provider: "meta" };
  },

  async markRead(phoneNumberId, token, waMessageId) {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
    });
    if (!res.ok) throw graphError((await res.json()) as Record<string, unknown>, res.status);
  },
};

/** Provider de desenvolvimento: não chama a Meta, devolve IDs determinísticos. */
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
};

/** Escolhe o provider activo. Meta por omissão; `mock` só quando pedido explicitamente. */
export function whatsappProvider(): WhatsAppProvider {
  return process.env["WHATSAPP_PROVIDER"] === "mock" ? mockProvider : metaProvider;
}
