import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook oficial da Meta / WhatsApp Cloud API.
 *
 * GET  -> verificação (hub.challenge) com META_WEBHOOK_VERIFY_TOKEN
 * POST -> valida assinatura Meta, encaminha eventos para background function
 *        e responde rapidamente para evitar timeouts/reentregas do webhook.
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
        const workItems: Array<{
          phoneNumberId: string;
          message: WebhookMessage;
          profileName: string | null;
        }> = [];

        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            const phoneNumberId = value?.metadata?.phone_number_id;
            if (!phoneNumberId) continue;

            // Mensagens recebidas: o processamento completo corre fora do webhook
            // síncrono, através da mesma pipeline utilizada pelo QR/Baileys.
            for (const message of value.messages ?? []) {
              const profileName =
                value.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name ?? null;
              workItems.push({ phoneNumberId, message, profileName });
            }

            // Estados de entrega das mensagens enviadas continuam a ser tratados
            // directamente, sem passar pelo pipeline de mensagens recebidas.
            for (const status of value.statuses ?? []) {
              if (!status.id || !status.status) continue;
              const { error } = await admin.rpc("update_whatsapp_message_status", {
                _wa_message_id: status.id,
                _status: status.status,
              });
              if (error) console.error("[wappy-nus] update_whatsapp_message_status falhou", error.message);
            }
          }
        }

        if (workItems.length === 0) {
          return Response.json({ received: true, queued: 0 });
        }

        const workerSecret = process.env["WHAPPNUS_AI_WORKER_SECRET"];
        if (!workerSecret) {
          console.error("[wappy-nus] WHAPPNUS_AI_WORKER_SECRET não configurado para o worker inbound");
          return Response.json({ received: false, error: "inbound_worker_not_configured" }, { status: 503 });
        }

        try {
          const backgroundUrl = new URL("/.netlify/functions/whatsapp-inbound-background", request.url);
          const accepted = await fetch(backgroundUrl, {
            method: "POST",
            headers: {
              authorization: "Bearer " + workerSecret,
              "content-type": "application/json",
            },
            body: JSON.stringify({ messages: workItems }),
          });

          if (!accepted.ok) {
            console.error("[wappy-nus] background inbound worker rejeitou o lote:", accepted.status);
            return Response.json({ received: false, error: "inbound_worker_rejected" }, { status: 503 });
          }
        } catch (error) {
          console.error(
            "[wappy-nus] não foi possível encaminhar mensagens ao worker:",
            (error as Error).message.slice(0, 180),
          );
          return Response.json({ received: false, error: "inbound_worker_unavailable" }, { status: 503 });
        }

        return Response.json({ received: true, queued: workItems.length });
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
  image?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; mime_type?: string };
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
