# WHAPPNUS Native AI Engine

This service is the application-owned business orchestration runtime for WHAPPNUS. Its source lives in the main `wappy-nu-connect` repository under `native-ai/`.

## Runtime responsibilities

- Supabase remains the source of truth for organizations, agents, knowledge, history, credits, bookings, logs and durable generation jobs.
- This service retains business logic: agent selection, context construction, intent classification, knowledge ranking, billing checks, booking tools, payment-proof review, evaluation and delivery callbacks.
- The independent WHAPPNUS AI Orchestrator is the only LLM provider gateway. This service signs each provider request with the organization ID, timestamp and one-time nonce.
- Provider/model selection, retries, fallback, circuit breakers, tenant rate limits and replay protection belong to the external Orchestrator.
- No Ollama or legacy Intelligence Router inference remains in this runtime.

## Required Railway variables

- Existing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_INTERNAL_SECRET`, `AI_RESULT_CALLBACK_URL`.
- New: `ORCHESTRATOR_URL`, `ORCHESTRATOR_API_KEY`, `TENANT_SIGNING_SECRET`.
- Optional: `ORCHESTRATOR_TIMEOUT_MS`, `AI_MODEL`, `AI_TEMPERATURE`, `AI_MAX_OUTPUT_TOKENS`, queue and history limits.

The Orchestrator API key and tenant signing secret must match the corresponding secrets configured on the Orchestrator service. Store them only in Railway Variables; never commit them or send them in chat.

## Worker and queue

`AI_WORKER_ENABLED` remains an explicit switch and defaults to false. Enable the worker only after the Orchestrator variables are present and the live signed smoke test passes. Netlify and this service can share the durable Supabase queue during a controlled rollout because `claim_ai_generation_job` uses row locking with `SKIP LOCKED`; both workers must use the same new provider gateway before concurrent operation is allowed.

## Migration safety

Do not delete Supabase credit, booking, knowledge, history, or delivery logic. This service is the business layer; the independent Orchestrator is the provider layer. Keep the old Railway deployment available for rollback until signed generation, payment-proof extraction, booking tools, queue retry and WhatsApp delivery have all passed end-to-end tests.
