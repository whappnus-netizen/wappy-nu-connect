import { createFileRoute } from "@tanstack/react-router";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/public/email/welcome")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json({ ok: false, error: "unauthorized" }, 401);

        const supabaseUrl = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
        const anonKey = process.env["VITE_SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        const dispatchSecret = process.env["EMAIL_DISPATCH_SECRET"];
        if (!supabaseUrl || !anonKey || !serviceKey || !dispatchSecret) {
          return json({ ok: false, error: "server_not_configured" }, 503);
        }

        const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!authResponse.ok) return json({ ok: false, error: "invalid_session" }, 401);
        const user: any = await authResponse.json().catch(() => null);
        if (!user?.id || !user?.email || !user?.email_confirmed_at) {
          return json({ ok: false, error: "email_not_confirmed" }, 403);
        }

        const key = `welcome:${user.id}`;
        const restHeaders = {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        };
        const queryUrl = `${supabaseUrl}/rest/v1/email_delivery_logs?select=id,status&idempotency_key=eq.${encodeURIComponent(key)}`;
        const existingResponse = await fetch(queryUrl, { headers: restHeaders });
        if (!existingResponse.ok) return json({ ok: false, error: "email_log_unavailable" }, 503);
        const existingRows: any[] = await existingResponse.json().catch(() => []);
        const existing = existingRows[0];
        if (existing && ["sent", "delivered", "sending"].includes(existing.status)) {
          return json({ ok: true, duplicate: true });
        }

        let logId = existing?.id;
        const row = {
          idempotency_key: key,
          template_code: "welcome",
          recipient_email: String(user.email).toLowerCase(),
          event_type: "welcome",
          status: "sending",
          metadata: { source: "auth-confirmation", user_id: user.id },
          updated_at: new Date().toISOString(),
        };
        if (logId) {
          const update = await fetch(`${supabaseUrl}/rest/v1/email_delivery_logs?id=eq.${encodeURIComponent(logId)}`, {
            method: "PATCH",
            headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "sending", error_message: null, updated_at: row.updated_at }),
          });
          if (!update.ok) return json({ ok: false, error: "email_log_update_failed" }, 503);
        } else {
          const insert = await fetch(`${supabaseUrl}/rest/v1/email_delivery_logs`, {
            method: "POST",
            headers: { ...restHeaders, Prefer: "return=representation" },
            body: JSON.stringify(row),
          });
          if (!insert.ok) {
            if (insert.status === 409) return json({ ok: true, duplicate: true });
            return json({ ok: false, error: "email_log_insert_failed" }, 503);
          }
          const inserted: any[] = await insert.json().catch(() => []);
          logId = inserted[0]?.id;
        }

        const senderUrl = process.env["EMAIL_DISPATCH_URL"] ?? "https://whappnus.online/api/public/email/dispatch";
        const metadata = user.user_metadata ?? {};
        const name = String(metadata.full_name ?? metadata.name ?? "").trim();
        try {
          const response = await fetch(senderUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-email-secret": dispatchSecret },
            body: JSON.stringify({
              template: "welcome",
              to: String(user.email).toLowerCase(),
              name: name || undefined,
              vars: { name, organization: "" },
              idempotency_key: key,
            }),
            signal: AbortSignal.timeout(18000),
          });
          const result: any = await response.json().catch(() => ({}));
          const ok = response.ok && result?.ok === true;
          if (logId) {
            await fetch(`${supabaseUrl}/rest/v1/email_delivery_logs?id=eq.${encodeURIComponent(logId)}`, {
              method: "PATCH",
              headers: { ...restHeaders, Prefer: "return=minimal" },
              body: JSON.stringify(ok
                ? { status: "sent", provider: "brevo", provider_message_id: result.messageId ?? null, sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }
                : { status: "failed", error_message: String(result.error ?? "dispatch_failed").slice(0, 300), updated_at: new Date().toISOString() }),
            });
          }
          return json({ ok, ...(ok ? {} : { error: "email_dispatch_failed" }) }, ok ? 200 : 502);
        } catch {
          if (logId) await fetch(`${supabaseUrl}/rest/v1/email_delivery_logs?id=eq.${encodeURIComponent(logId)}`, {
            method: "PATCH",
            headers: { ...restHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", error_message: "dispatch_failed", updated_at: new Date().toISOString() }),
          });
          return json({ ok: false, error: "email_dispatch_failed" }, 502);
        }
      },
    },
  },
});
