# Wapnus core workflows — v1

## Inbox statuses
- `open`: conversation is open and awaiting work.
- `pending`: conversation is waiting for a later follow-up.
- `in_progress`: a team member is actively handling the conversation.
- `closed`: conversation is closed; a later inbound message can create a new active conversation according to the ingestion function.

The Inbox status actions update the conversation row within the current organization. Claiming a conversation assigns it to the signed-in user, moves it to `in_progress`, and disables AI replies for that conversation.

## Keyword automations
An active `automation_rules` row with `trigger_type = 'keyword'` may define:
- `config.keyword`: phrase to look for, case-insensitive substring match.
- `config.reply`: response to send when the phrase matches.

The shared inbound pipeline evaluates these rules before AI generation. It uses the first matching active rule, skips the AI call for that message to prevent duplicate replies, and does not run an automatic rule against a conversation assigned to a human. If a send attempt fails ambiguously, it records the failure and does not attempt a second response through AI for the same inbound message.

## CRM
Opportunities can be created manually and moved to the next configured pipeline stage. A conversation is not automatically classified as a sales lead just because the AI replied; this avoids filling the pipeline with support or test chats. Automatic lead qualification requires agreed criteria and should be added as a separate tested increment.

## WhatsApp QR archive
Archiving a QR connection is a soft archive. It attempts to disconnect the Baileys session, then marks the number as archived using `deleted_at` and clears the stored QR. It does not delete contacts, conversations, messages, or CRM records. If disconnection cannot be confirmed, the archive is rejected so the UI does not hide a potentially live session.

## AI provider strategy
The frontend workflow changes do not alter the AI engine's provider order, credentials, or fallback implementation.
