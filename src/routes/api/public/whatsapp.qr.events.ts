import { createFileRoute } from "@tanstack/react-router";

/**
 * Receptor de eventos do serviço de sessões WhatsApp por QR Code (bridge).
 *
 * URL a configurar no bridge:
 *   https://whappnus.online/api/public/whatsapp/qr/events
 *
 * Segurança: cada pedido traz `x-wappy-signature: sha256=<hmac>` calculado
 * sobre o corpo cru com WHATSAPP_QR_BRIDGE_SECRET. Sem assinatura válida o
 * pedido é rejeitado (401). Nenhum dado de autenticação da sessão é aceite
 * nem devolvido aqui.
 *
 * Eventos suportados: qr, connecting, connected, disconnected, reconnecting,
 * error, message.
 */
export const Route = createFileRoute("/api/public/whatsapp/qr/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env["WHATSAPP_QR_BRIDGE_SECRET"];
        if (!secret) return new Response("bridge secret not configured", { status: 503 });

        // HMAC é o método principal; Bearer é aceito como fallback para
        // compatibilidade com versões do bridge que enviam Authorization.
        const signatureOk = await verifySignature(raw, request.headers.get("x-wappy-signature"), secret);
        const authorization = request.headers.get("authorization") ?? "";
        const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        const bearerOk = bearer.length > 0 && timingSafeEqualText(bearer, secret);
        if (!signatureOk && !bearerOk) return new Response("invalid bridge authentication", { status: 401 });

        let payload: BridgeEvent;
        try {
          payload = JSON.parse(raw) as BridgeEvent;
        } catch {
          return new Response("invalid json", { status: 400 });
        }

        const { organizationId, whatsappNumberId, event } = payload;
        if (!organizationId || !whatsappNumberId || !event) {
          return new Response("missing organizationId, whatsappNumberId or event", { status: 400 });
        }

        const { serviceClient } = await import("@/lib/whatsapp.server");
        const { logWhatsAppEvent, processIncomingMessage } = await import(
          "@/lib/whatsapp/pipeline.server"
        );
        const admin = serviceClient();

        // O número tem de existir E pertencer à organização anunciada:
        // impede que uma sessão escreva em dados de outra organização.
        const { data: number } = await admin
          .from("whatsapp_numbers")
          .select("id, organization_id, provider")
          .eq("id", whatsappNumberId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (!number) return new Response("number not found for organization", { status: 404 });

        if (event === "message") {
          const { qrProvider } = await import("@/lib/whatsapp/qr.server");
          const incoming = qrProvider.handleIncomingMessage(payload.message);
          if (!incoming) return Response.json({ ok: false, reason: "unsupported_message" });
          try {
            const outcome = await processIncomingMessage(whatsappNumberId, incoming);
            return Response.json(outcome);
          } catch (e) {
            console.error("[wappy-nus] pipeline QR falhou:", (e as Error).message);
            return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
          }
        }

        const status =
          event === "qr"
            ? "qr_pending"
            : event === "connected"
              ? "connected"
              : event === "connecting"
                ? "connecting"
                : event === "reconnecting"
                  ? "reconnecting"
                  : event === "disconnected"
                    ? "disconnected"
                    : "error";

        const { data: session } = await admin
          .from("whatsapp_sessions")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("whatsapp_number_id", whatsappNumberId)
          .maybeSingle();

        if (session) {
          await admin.rpc("update_whatsapp_session_status", {
            _session_id: (session as { id: string }).id,
            _status: status,
            _qr: payload.qr ?? null,
            _phone_number: payload.phoneNumber ?? null,
            _display_name: payload.displayName ?? null,
            _error: payload.error ?? null,
          });
        }

        // Substitui o número provisório pelo número real do telemóvel escaneado.
        if (event === "connected" && payload.phoneNumber) {
          const update: Record<string, string> = { phone_e164: payload.phoneNumber };
          if (payload.displayName) update["display_name"] = payload.displayName;
          await admin
            .from("whatsapp_numbers")
            .update(update)
            .eq("id", whatsappNumberId)
            .eq("organization_id", organizationId);
        }

        const logType =
          event === "qr"
            ? "qr_generated"
            : event === "connected"
              ? "connected"
              : event === "connecting"
                ? "connecting"
                : event === "reconnecting"
                  ? "reconnecting"
                  : event === "disconnected"
                    ? "disconnected"
                    : "error";

        await logWhatsAppEvent(organizationId, logType, {
          whatsappNumberId,
          sessionId: (session as { id: string } | null)?.id ?? null,
          provider: "qr",
          detail: payload.error ? { error: payload.error.slice(0, 300) } : null,
        });

        return Response.json({ ok: true, status });
      },
    },
  },
});

type BridgeEvent = {
  organizationId?: string;
  whatsappNumberId?: string;
  event?: "qr" | "connecting" | "connected" | "disconnected" | "reconnecting" | "error" | "message";
  qr?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
  error?: string | null;
  message?: unknown;
};

function timingSafeEqualText(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

// Deploy trigger: keep bridge authentication compatible with HMAC and Bearer.
