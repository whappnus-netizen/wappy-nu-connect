# WHAPPNUS Native AI Engine

This service is the application-owned AI runtime for WHAPPNUS. Its source lives in the main `wappy-nu-connect` repository under `native-ai/`; it is not the legacy `WhappNus-AI-Engine` repository.

## Runtime contract

- Express API compatible with the current server-side WHAPPNUS adapter.
- Supabase is the source of truth for tenants, agents, knowledge, history, credits, bookings, logs and durable generation jobs.
- Ollama is the only generation provider; model defaults to `qwen2.5vl:3b`.
- The browser never calls Ollama or receives the internal AI secret.
- The app's server-side adapter calls this service with bearer authentication.

## Railway

Set the service root directory to `native-ai`. Build with `npm install && npm run build`; start with `npm start`. Required runtime variables are validated in `src/config.ts`. Reuse the existing AI Engine's Supabase and Ollama variables through Railway variable references during the blue/green transition; do not copy secret values into source control.

## Migration strategy

The legacy service remains available for rollback. Both runtimes can share the existing idempotent Supabase queue during controlled rollout because `claim_ai_generation_job` uses row locking with `SKIP LOCKED`. Only after internal and real WhatsApp validation should Netlify's server-side engine URL be switched to this service and the legacy worker be retired.

## Known limitations pending completion

- Slow WhatsApp generations now use a durable delivery outbox, authenticated callback, and unique `ai_generation_job_id` on outbound messages. This still requires production migration and end-to-end delivery validation before it can be considered approved.
- Qwen2.5-VL supports image understanding, but audio requires a local transcription service and PDFs/documents require extraction before model invocation.
