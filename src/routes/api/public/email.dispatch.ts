import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { renderTemplate, TEMPLATE_CODES } from "@/lib/email/templates.server";

const Body = z.object({
  template: z.enum(TEMPLATE_CODES as [string, ...string[]]),
  to: z.string().email().max(320),
  name: z.string().max(200).optional(),
  vars: z.record(z.string(), z.unknown()).default({}),
  idempotency_key: z.string().min(3).max(300),
});

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Envio central de e-mails transacionais via Brevo. Chamado só pelo backend (edge functions) com segredo partilhado.
export const Route = createFileRoute("/api/public/email/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["EMAIL_DISPATCH_SECRET"];
        const got = request.headers.get("x-email-secret") ?? "";
        if (!secret || !safeEqual(got, secret)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        const { template, to, name, vars, idempotency_key } = parsed.data;

        const LOVABLE_API_KEY = process.env["LOVABLE_API_KEY"];
        const BREVO_API_KEY = process.env["BREVO_API_KEY"];
        if (!LOVABLE_API_KEY || !BREVO_API_KEY) return Response.json({ ok: false, error: "email_not_configured" }, { status: 503 });

        const { subject, html } = renderTemplate(template as never, { ...vars, name: name || vars["name"] });
        const senderEmail = process.env["EMAIL_SENDER"] || "whappnus@gmail.com";
        const res = await fetch("https://connector-gateway.lovable.dev/brevo/smtp/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": BREVO_API_KEY,
            // Brevo deduplica pedidos repetidos com o mesmo idempotency key.
            "Idempotency-Key": idempotency_key,
          },
          body: JSON.stringify({
            sender: { name: "WhappNus", email: senderEmail },
            replyTo: { email: process.env["EMAIL_REPLY_TO"] || senderEmail, name: "WhappNus" },
            to: [{ email: to, ...(name ? { name } : {}) }],
            subject,
            htmlContent: html,
            tags: [template],
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error(`[email.dispatch] Brevo ${res.status}: ${text.slice(0, 500)}`);
          return Response.json({ ok: false, error: `brevo_${res.status}`, detail: text.slice(0, 300) }, { status: 502 });
        }
        let messageId: string | null = null;
        try { messageId = JSON.parse(text).messageId ?? null; } catch { /* ignore */ }
        return Response.json({ ok: true, messageId });
      },
    },
  },
});
