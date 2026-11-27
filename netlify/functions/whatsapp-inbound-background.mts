type ScheduledContext = { site?: { url?: string } };

type MetaWorkItem = {
  phoneNumberId: string;
  profileName: string | null;
  message: Record<string, unknown>;
};

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return mismatch === 0;
}

export default async (request: Request, _context: ScheduledContext): Promise<Response> => {
  const runtime = globalThis as typeof globalThis & {
    Netlify?: { env?: { get: (name: string) => string | undefined } };
  };
  const secret = runtime.Netlify?.env?.get("WHAPPNUS_AI_WORKER_SECRET")
    ?? process.env["WHAPPNUS_AI_WORKER_SECRET"];
  const deployContext = String(process.env["CONTEXT"] ?? "").trim().toLowerCase();
  const isNetlify = process.env["NETLIFY"] === "true";

  // Deploy previews must never process real AI/WhatsApp traffic.
  if (isNetlify && deployContext !== "production" && deployContext !== "dev") {
    return new Response("Not Found", { status: 404 });
  }

  if (!secret) return new Response("worker secret not configured", { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!bearer || !safeEqual(bearer, secret)) return new Response("unauthorized", { status: 401 });

  const raw = await request.text();
  if (raw.length > 250_000) return new Response("payload too large", { status: 413 });

  let payload: { messages?: MetaWorkItem[] };
  try {
    payload = JSON.parse(raw) as { messages?: MetaWorkItem[] };
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const items = payload.messages;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return new Response("invalid messages batch", { status: 400 });
  }

  const [{ serviceClient }, { metaProvider }, { processIncomingMessage }] = await Promise.all([
    import("@/lib/whatsapp.server"),
    import("@/lib/whatsapp/provider.server"),
    import("@/lib/whatsapp/pipeline.server"),
  ]);
  const admin = serviceClient();
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    try {
      if (!item?.phoneNumberId || !item.message || typeof item.message !== "object") {
        skipped += 1;
        continue;
      }

      const { data: number, error } = await admin
        .from("whatsapp_numbers")
        .select("id, organization_id, provider")
        .eq("phone_number_id", item.phoneNumberId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw new Error("WHATSAPP_NUMBER_LOOKUP_FAILED: " + error.message);
      if (!number || !["meta_cloud", "meta"].includes(String(number.provider))) {
        skipped += 1;
        console.warn("[whatsapp-inbound-background] número Meta não encontrado ou provider inválido");
        continue;
      }

      const incoming = metaProvider.handleIncomingMessage({
        ...item.message,
        profileName: item.profileName,
      });
      if (!incoming) {
        skipped += 1;
        continue;
      }

      const outcome = await processIncomingMessage(number.id, incoming);
      if (outcome.ok) processed += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[whatsapp-inbound-background] processamento falhou:",
        error instanceof Error ? error.message.slice(0, 180) : "unknown",
      );
    }
  }

  // Netlify retries failed background invocations. Message ingestion is
  // idempotent by WhatsApp message ID, so already-completed items are safe.
  if (failed > 0) {
    throw new Error("WHATSAPP_INBOUND_BATCH_FAILED: " + failed);
  }

  console.log("[whatsapp-inbound-background] batch completed", { processed, skipped });
  return new Response(null, { status: 200 });
};

export const config = {
  background: true,
};
