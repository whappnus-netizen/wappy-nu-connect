# WHAPPNUS tenant isolation and WhatsApp smoke test

## Purpose

Prove that two organizations receive responses using only their own agent identity, instructions, knowledge, conversation history, WhatsApp number and queued jobs.

This is a controlled acceptance test. Do not use customer organizations, customer phone numbers or real payment/booking data.

## Preconditions

- Apply migration 20261127113015_serialize_ai_conversation_usage_per_organization.sql through the approved Supabase migration process before relying on strict monthly AI conversation limits.
- Two dedicated test organizations: ORG-A and ORG-B.
- One dedicated WhatsApp test number connected to each organization.
- One active agent per organization.
- Distinct, harmless marker values stored only in each organization's test knowledge:
  - ORG-A marker: a unique value such as TEST-A-<random>.
  - ORG-B marker: a different unique value such as TEST-B-<random>.
- Both agents configured to use the WHAPPNUS Orchestrator.
- The same production routing policy under test, with Gemini Flash Lite as primary.
- A test operator able to inspect Supabase rows and Railway/Netlify logs without exposing credentials.

If the project still has only one organization or lacks two dedicated WhatsApp numbers, this runtime test is BLOCKED; do not claim tenant isolation has passed based only on static tests.

## Test A — agent identity and knowledge separation

1. Send a message to ORG-A asking for its test marker. The answer may contain only ORG-A's marker.
2. Send the same question to ORG-B. The answer may contain only ORG-B's marker.
3. In ORG-A, explicitly ask for ORG-B's marker. The agent must not know or disclose it.
4. Repeat in ORG-B asking for ORG-A's marker. The agent must not know or disclose it.
5. Repeat after several alternating turns to detect accidental cross-conversation history reuse.

Acceptance:
- A never returns B's marker.
- B never returns A's marker.
- Each agent uses its own name, company identity, rules and knowledge.
- No response restarts the other organization's conversation.

## Test B — persistence and queue boundaries

For each test message, inspect the relevant Supabase rows and confirm:

- messages.organization_id matches the receiving organization.
- messages.conversation_id belongs to that same organization.
- messages.whatsapp_number_id is the receiving number.
- ai_generation_jobs.organization_id and whatsapp_number_id match the source message and conversation.
- The worker rejects a job if its payload organization or WhatsApp number differs from the job row.
- The delivery outbox and final message remain associated with the same organization and generation job.

Do not copy message contents or personal data into logs or this document.

## Test C — operational isolation

1. Disable AI on ORG-A's test conversation only.
2. Send a new message to ORG-A: no automatic AI response should be sent.
3. Send a new message to ORG-B: its AI response should still be delivered.
4. Re-enable AI on ORG-A and verify normal operation resumes.
5. Trigger a controlled transient generation failure on the test environment and confirm the durable queue retains the original organization and WhatsApp number.

Before the runtime test, apply both pending migrations through the approved Supabase process: 20261127113015_serialize_ai_conversation_usage_per_organization.sql and 20261127113019_harden_ingest_provider_message.sql. Confirm WHAPPNUS_AI_WORKER_SECRET is configured for Netlify Functions; the Meta webhook dispatches inbound work to the authenticated background function.

## Test D — inbound to outbound WhatsApp path

Run separately for each provider path that is enabled:

1. Send a unique text message from the test phone to the organization's connected WhatsApp number.
2. Confirm the inbound webhook/engine event is persisted once.
3. Confirm the backend resolves the correct organization and conversation.
4. Confirm the correct agent instructions and knowledge are used.
5. Confirm the Orchestrator response reports Gemini and gemini-3.1-flash-lite while advanced mode is disabled.
6. Confirm the outgoing message is delivered once to the same sender.
7. Confirm the message and delivery records remain scoped to the same organization.

Repeat for QR/Baileys and Meta Cloud API only if both paths are configured and have dedicated test numbers.

## Evidence to record

- Test date/time and test organization labels (do not include secrets).
- WhatsApp message IDs and conversation IDs (test-only identifiers).
- Provider/model and request IDs.
- Supabase row counts and organization/number linkage.
- Whether each assertion passed or failed.
- Sanitized Railway/Netlify error codes only.

## Rollout gate

Do not merge the backend Orchestrator integration or enable customer traffic until:
- all static CI checks pass;
- both organizations pass Tests A–C;
- at least one dedicated test number passes Test D;
- manual takeover, AI-disabled behavior and idempotent delivery are verified;
- unresolved provider quota/fallback behavior is understood.
