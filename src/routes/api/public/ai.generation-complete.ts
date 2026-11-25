import { createFileRoute } from "@tanstack/react-router";

/**
 * Internal callback from WHAPPNUS Native AI Engine.
 * Only a durable generation job ID is accepted; tenant and conversation
 * identifiers are reloaded from Supabase inside the server pipeline.
 */
export const Route = createFileRoute("/api/public/ai/generation-complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["WHAPPNUS_NATIVE_AI_ENGINE_SECRET"] || process.env["WHAPPNUS_AI_ENGINE_SECRET"];
        const authorization = request.headers.get("authorization") ?? "";
        const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        if (!secret) return Response.json({ ok: false, error: "callback_secret_not_configured" }, { status: 503 });
        if (!bearer || !timingSafeEqualText(bearer, secret)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        let payload: { jobId?: unknown };
        try {
          payload = await request.json() as { jobId?: unknown };
        } catch {
          return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
        }
        const jobId = typeof payload.jobId === "string" ? payload.jobId.trim() : "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
          return Response.json({ ok: false, error: "invalid_job_id" }, { status: 400 });
        }

        try {
          const { deliverAiGenerationJob } = await import("@/lib/whatsapp/pipeline.server");
          const result = await deliverAiGenerationJob(jobId);
          return Response.json(result, { status: result.status === "pending" ? 202 : 200 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          console.error("[whappnus] AI delivery callback failed:", message);
          if (message === "AI_DELIVERY_PREVIOUSLY_FAILED" || message === "AI_DELIVERY_UNCERTAIN") {
            return Response.json({ ok: false, status: "failed", error: message });
          }
          return Response.json({ ok: false, status: "failed", error: "ai_delivery_failed" }, { status: 500 });
        }
      },
    },
  },
});

function timingSafeEqualText(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
