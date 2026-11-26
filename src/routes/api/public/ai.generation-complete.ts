import { createFileRoute } from "@tanstack/react-router";

/**
 * Retired callback from the deleted Native AI Engine.
 * The Intelligence Router is synchronous and does not call this endpoint.
 * Keep a 410 response temporarily so stale workers cannot trigger delivery.
 */
export const Route = createFileRoute("/api/public/ai/generation-complete")({
  server: {
    handlers: {
      POST: async () => Response.json(
        { ok: false, error: "legacy_ai_callback_retired" },
        { status: 410 },
      ),
    },
  },
});
