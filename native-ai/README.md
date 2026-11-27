# Optional Native AI Engine Runtime

**This directory is not part of the current production request path.** The live WHAPPNUS backend runs its business orchestration in the main application and calls the independent WHAPPNUS AI Orchestrator directly from `src/lib/ai-engine.server.ts`.

The current production Railway project contains the AI Orchestrator and Redis; it does not contain a deployed Native AI Engine service. The Netlify production configuration also does not define `WHAPPNUS_NATIVE_AI_URL` or `WHAPPNUS_NATIVE_AI_SECRET`. Do not add those dependencies or deploy this service as part of the current migration.

## What this optional runtime contains

This folder retains an independently buildable runtime prototype with:
- Tenant-scoped agent context, knowledge and conversation history.
- Conversation-credit checks.
- Booking tools and permissions.
- Payment-proof extraction for human review.
- Durable generation and delivery queue support.
- An Orchestrator provider adapter using tenant HMAC signatures.

The main backend now has its own tenant-scoped booking tools in `src/lib/ai-booking-tools.server.ts`, plus conversation-credit checks and the direct Orchestrator request path. The payment-proof extractor in this optional folder is still not active in production; the main backend deliberately keeps payment confirmation under human review. Do not assume code in this folder is called by the main Netlify request path.

## Provider gateway

When this optional runtime is used independently, the WHAPPNUS AI Orchestrator remains its only LLM provider gateway. It must use:
- `ORCHESTRATOR_URL`
- `ORCHESTRATOR_API_KEY`
- `TENANT_SIGNING_SECRET`

Never restore Ollama or the deprecated Intelligence Router as a provider fallback.

## Worker safety

`AI_WORKER_ENABLED` defaults to false. Do not enable it while the Netlify worker is consuming the same Supabase generation queue unless both consumers are intentionally configured and verified for the same runtime contract.
