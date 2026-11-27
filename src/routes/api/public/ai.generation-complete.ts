import { createFileRoute } from "@tanstack/react-router";
import { serviceClient } from "@/lib/whatsapp.server";
import { generateViaWhappNusAI } from "@/lib/ai-engine.server";
import { deliverAiGenerationJob } from "@/lib/whatsapp/pipeline.server";

type GenerationJob = {
  id: string;
  request_payload: Record<string, unknown>;
  organization_id: string;
  whatsapp_number_id: string;
  conversation_id: string | null;
};

function jobContextMatches(job: GenerationJob): boolean {
  const payload = job.request_payload;
  return payload["organizationId"] === job.organization_id
    && payload["whatsappNumberId"] === job.whatsapp_number_id
    && (payload["conversationId"] ?? null) === job.conversation_id;
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return mismatch === 0;
}

function retryable(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error &&
      typeof (error as { retryable?: unknown }).retryable === "boolean") {
    return (error as { retryable: boolean }).retryable;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /generation_pending_retry|delivery_enqueue_failed|generation_finish_failed|AbortError|TimeoutError|timeout|fetch failed|ECONN|socket|network|HTTP (408|425|429|5\d\d)/i.test(message);
}

export const Route = createFileRoute("/api/public/ai/generation-complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const context = String(process.env["CONTEXT"] ?? "").trim().toLowerCase();
        const isNetlify = process.env["NETLIFY"] === "true";
        if ((isNetlify && context !== "production" && context !== "dev") ||
            (context && context !== "production" && context !== "dev")) {
          return new Response("Not Found", { status: 404 });
        }

        const secret = process.env["WHAPPNUS_AI_WORKER_SECRET"];
        const authorization = request.headers.get("authorization") ?? "";
        const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        if (!secret) return Response.json({ ok: false, error: "worker_secret_not_configured" }, { status: 503 });
        if (!bearer || !safeEqual(bearer, secret)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const admin = serviceClient();
        const workerId = "netlify-router-worker-" + crypto.randomUUID();
        let generated = "idle";
        let delivered = "idle";

        const claim = await admin.rpc("claim_ai_generation_job", {
          _worker_id: workerId,
          _lease_seconds: 90,
        });
        if (claim.error) {
          console.error("[ai-worker] generation claim failed:", claim.error.message);
          return Response.json({ ok: false, error: "generation_claim_failed" }, { status: 500 });
        }

        const job = (Array.isArray(claim.data) ? claim.data[0] : claim.data) as GenerationJob | null;
        if (job?.id) {
          if (!jobContextMatches(job)) {
            const finish = await admin.rpc("finish_ai_generation_job", {
              _job_id: job.id,
              _worker_id: workerId,
              _status: "failed",
              _result: null,
              _error_code: "AI_GENERATION_JOB_TENANT_CONTEXT_MISMATCH",
            });
            if (finish.error) console.error("[ai-worker] tenant-mismatch job could not be finalized:", finish.error.message);
            generated = "failed";
          } else {
            try {
              const result = await generateViaWhappNusAI(job.request_payload as Parameters<typeof generateViaWhappNusAI>[0]);
              const deliveryStatus = job.conversation_id && job.request_payload["testMode"] !== true ? "queued" : "skipped";
              const deliveryUpdate = await admin.from("ai_generation_jobs").update({
                delivery_status: deliveryStatus,
                delivery_available_at: new Date().toISOString(),
              }).eq("id", job.id).eq("status", "processing").eq("locked_by", workerId);
              if (deliveryUpdate.error) throw new Error("delivery_enqueue_failed: " + deliveryUpdate.error.message);

              const finish = await admin.rpc("finish_ai_generation_job", {
                _job_id: job.id,
                _worker_id: workerId,
                _status: "succeeded",
                _result: result,
                _error_code: null,
              });
              if (finish.error) throw new Error("generation_finish_failed: " + finish.error.message);
              generated = "succeeded";
            } catch (error) {
              const message = error instanceof Error ? error.message : "AI_GENERATION_FAILED";
              const finish = await admin.rpc("finish_ai_generation_job", {
                _job_id: job.id,
                _worker_id: workerId,
                _status: retryable(error) ? "queued" : "failed",
                _result: null,
                _error_code: message.slice(0, 120),
              });
              if (finish.error) console.error("[ai-worker] generation finish failed:", finish.error.message);
              generated = retryable(error) ? "retry_queued" : "failed";
              console.error("[ai-worker] generation job failed:", { jobId: job.id, error: message.slice(0, 180) });
            }
          }
        }

        const deliveryClaim = await admin.rpc("claim_ai_generation_delivery", {
          _worker_id: workerId,
          _lease_seconds: 60,
        });
        if (deliveryClaim.error) {
          console.error("[ai-worker] delivery claim failed:", deliveryClaim.error.message);
          return Response.json({ ok: false, generated, error: "delivery_claim_failed" }, { status: 500 });
        }
        const deliveryJob = (Array.isArray(deliveryClaim.data) ? deliveryClaim.data[0] : deliveryClaim.data) as { id: string } | null;
        if (deliveryJob?.id) {
          try {
            const outcome = await deliverAiGenerationJob(deliveryJob.id);
            const status = outcome.status === "sent" ? "sent"
              : outcome.status === "skipped" ? "skipped"
                : outcome.status === "failed" ? "failed" : "queued";
            const finish = await admin.rpc("finish_ai_generation_delivery", {
              _job_id: deliveryJob.id,
              _worker_id: workerId,
              _status: status,
              _error_code: outcome.reason ?? null,
            });
            if (finish.error) throw new Error("delivery_finish_failed: " + finish.error.message);
            delivered = status;
          } catch (error) {
            const message = error instanceof Error ? error.message : "AI_DELIVERY_FAILED";
            const finish = await admin.rpc("finish_ai_generation_delivery", {
              _job_id: deliveryJob.id,
              _worker_id: workerId,
              _status: "queued",
              _error_code: message.slice(0, 180),
            });
            if (finish.error) console.error("[ai-worker] delivery retry scheduling failed:", finish.error.message);
            delivered = "retry_queued";
          }
        }

        return Response.json({ ok: true, generated, delivered });
      },
    },
  },
});
