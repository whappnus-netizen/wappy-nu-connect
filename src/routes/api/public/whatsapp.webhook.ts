import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook oficial da Meta / WhatsApp Cloud API.
 *
 * URL oficial de produção (configurar no Meta Developers):
 *   https://whappnus.online/api/public/whatsapp/webhook
 *
 * GET  → verificação (hub.challenge) com META_WEBHOOK_VERIFY_TOKEN
 * POST → recepção de mensagens/estados, com validação HMAC (META_APP_SECRET)
 */
export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        const expected = process.env["META_WEBHOOK_VERIFY_TOKEN"];

        if (!expected) return new Response("verify token not configured", { status: 503 });
        if (mode !== "subscribe" || token !== expected) {
          return new Response("forbidden", { status: 403 });
        }
        return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
      },

      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyWebhookSignature, serviceClient } = await import("@/lib/whatsapp.server");

        const valid = await verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"));
        if (!valid) return new Response("invalid signature", { status: 401 });

        let payload: WebhookPayload;
        try {
          payload = JSON.parse(raw) as WebhookPayload;
        } catch {
          return new Response("invalid json", { status: 400 });
        }

        const admin = serviceClient();
        let ingested = 0;

        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            if (!value?.metadata?.phone_number_id) continue;
            const phoneNumberId = value.metadata.phone_number_id;

            // Mensagens recebidas (cliente → empresa)
            for (const msg of value.messages ?? []) {
              const profileName =
                value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
              const { text, mediaId, type } = normalize(msg);
              const { data: result, error } = await admin.rpc("ingest_whatsapp_message", {
                _phone_number_id: phoneNumberId,
                _from_wa_id: msg.from,
                _profile_name: profileName,
                _wa_message_id: msg.id,
                _message_type: type,
                _body: text,
                _media_id: mediaId,
                _sent_at: msg.timestamp
                  ? new Date(Number(msg.timestamp) * 1000).toISOString()
                  : new Date().toISOString(),
              });
              const outcome = (result ?? null) as { ok?: boolean; duplicate?: boolean; reason?: string } | null;
              if (error) console.error("[wappy-nus] ingest_whatsapp_message falhou", error.message);
              else if (!outcome?.ok) console.warn("[wappy-nus] webhook ignorado:", outcome?.reason ?? "unknown");
              else if (!outcome.duplicate) ingested += 1;

            }

            // Estados de entrega das mensagens enviadas
            for (const st of value.statuses ?? []) {
              if (!st.id || !st.status) continue;
              const { error } = await admin.rpc("update_whatsapp_message_status", {
                _wa_message_id: st.id,
                _status: st.status,
              });
              if (error) console.error("[wappy-nus] update_whatsapp_message_status falhou", error);
            }
          }
        }

        return Response.json({ received: true, ingested });
      },
    },
  },
});

type WebhookMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string };
  button?: { text?: string };
  interactive?: unknown;
};

type WebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WebhookMessage[];
        statuses?: Array<{ id?: string; status?: string }>;
      };
    }>;
  }>;
};

const SUPPORTED = ["text", "image", "audio", "video", "document"] as const;

function normalize(msg: WebhookMessage): { text: string | null; mediaId: string | null; type: string } {
  const type = SUPPORTED.includes((msg.type ?? "text") as (typeof SUPPORTED)[number])
    ? (msg.type as string)
    : "system";
  switch (msg.type) {
    case "text":
      return { text: msg.text?.body ?? null, mediaId: null, type: "text" };
    case "image":
      return { text: msg.image?.caption ?? null, mediaId: msg.image?.id ?? null, type: "image" };
    case "audio":
      return { text: null, mediaId: msg.audio?.id ?? null, type: "audio" };
    case "video":
      return { text: msg.video?.caption ?? null, mediaId: msg.video?.id ?? null, type: "video" };
    case "document":
      return { text: msg.document?.filename ?? null, mediaId: msg.document?.id ?? null, type: "document" };
    case "button":
      return { text: msg.button?.text ?? null, mediaId: null, type: "text" };
    default:
      return { text: msg.type ? `[${msg.type}]` : null, mediaId: null, type };
  }
}
