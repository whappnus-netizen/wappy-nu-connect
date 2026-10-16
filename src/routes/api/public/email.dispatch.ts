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
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Endpoint exclusivamente servidor-a-servidor: nunca expor EMAIL_DISPATCH_SECRET ou BREVO_API_KEY no browser.
export const Route = createFileRoute("/api/public/email/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["EMAIL_DISPATCH_SECRET"] ?? "";
        const supplied = request.headers.get("x-email-secret") ?? "";
        if (!secret || !safeEqual(supplied, secret)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, error: "invalid_body" }, { status: 400 });
        const { template, to, name, vars, idempotency_key } = parsed.data;

        const apiKey = process.env["BREVO_API_KEY"];
        if (!apiKey) return Response.json({ ok: false, error: "email_not_configured" }, { status: 503 });

        const { subject, html } = renderTemplate(template as never, { ...vars, name: name || vars["name"] });
        const senderEmail = process.env["EMAIL_SENDER"] || "whappnus@gmail.com";
        const replyTo = process.env["EMAIL_REPLY_TO"] || senderEmail;

        // Idempotency is enforced by the Supabase caller's unique email_delivery_logs key.
        // Brevo's transactional API does not guarantee deduplication from an arbitrary Idempotency-Key header.
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            sender: { name: "WhappNus", email: senderEmail },
            replyTo: { email: replyTo, name: "WhappNus" },
            to: [{ email: to, ...(name ? { name } : {}) }],
            subject,
            htmlContent: html,
            tags: [template, idempotency_key.slice(0, 50)],
          }),
          signal: AbortSignal.timeout(15000),
        });

        const text = await res.text();
        if (!res.ok) {
          console.error(`[email.dispatch] Brevo ${res.status}: ${text.slice(0, 400)}`);
          return Response.json({ ok: false, error: `brevo_${res.status}` }, { status: 502 });
        }
        let messageId: string | null = null;
        try { messageId = JSON.parse(text).messageId ?? null; } catch { /* Brevo may return an empty body */ }
        return Response.json({ ok: true, messageId });
      },
    },
  },
});
