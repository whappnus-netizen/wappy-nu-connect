type ScheduledContext = { site?: { url?: string } };

export default async (_request: Request, context: ScheduledContext): Promise<Response> => {
  const runtime = globalThis as typeof globalThis & {
    Netlify?: { env?: { get: (name: string) => string | undefined } };
  };
  const secret = runtime.Netlify?.env?.get("WHAPPNUS_ROUTER_API_KEY")
    ?? process.env["WHAPPNUS_ROUTER_API_KEY"];
  const siteUrl = context.site?.url ?? process.env["URL"];
  if (!secret || !siteUrl) {
    console.error("[ai-generation-worker] missing server runtime configuration");
    return new Response("worker configuration missing", { status: 503 });
  }

  try {
    const response = await fetch(new URL("/api/public/ai/generation-complete", siteUrl), {
      method: "POST",
      headers: { authorization: "Bearer " + secret, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(28_000),
    });
    if (!response.ok) {
      console.error("[ai-generation-worker] backend worker returned HTTP", response.status);
      return new Response("worker invocation failed", { status: 502 });
    }
    return new Response("worker tick completed", { status: 200 });
  } catch (error) {
    console.error("[ai-generation-worker] invocation failed:", error instanceof Error ? error.message : "unknown");
    return new Response("worker invocation failed", { status: 502 });
  }
};

export const config = {
  // Netlify scheduled functions run in UTC and only on published deploys.
  schedule: "* * * * *",
};
