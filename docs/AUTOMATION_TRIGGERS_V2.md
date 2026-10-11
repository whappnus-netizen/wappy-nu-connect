# Automation triggers — v2

Supported triggers:
- `keyword_match`: case-insensitive substring match against the inbound text.
- `outside_business_hours`: uses the organization's persisted IANA timezone, a configurable start/end time, and weekdays by default. The automatic reply is rate-limited per conversation by checking whether the same reply was sent in the previous 12 hours.
- `conversation_created`: runs only when the incoming message is the first inbound message in that conversation.

When multiple rules match, the execution priority is keyword, then outside-hours, then welcome. Keyword and outside-hours rules send one response and suppress AI generation for that inbound message to prevent duplicates. A welcome rule sends its greeting and then allows AI to answer the customer’s original question when AI is enabled. Human-assigned conversations are excluded from all automatic rules.

The outside-hours UI currently defaults to Monday–Friday and lets the organization set opening/closing times. Weekday configuration and more advanced action sequences remain a future increment.


## Schema notes
The organization locale and trigger-function hardening migrations use the exact version identifiers recorded by the connected Supabase project, so future migration pushes will not re-run them under a different version.


Before merging this feature, the repository TypeScript check and both Netlify preview builds must pass.


## Automatic distribution
A `conversation_created` rule can set `config.actionType = 'assign_agent'`. The runtime assigns the first message to the eligible member with the fewest conversations in `open` or `in_progress`, preferring AGENT, then SUPERVISOR, ADMIN, and OWNER. The conversation stays `open` with AI enabled until a human explicitly assumes it; that action changes it to `in_progress` and disables AI.


## Automatic CRM opportunities
A `conversation_created` rule can set `config.actionType = 'create_deal'`. On the first inbound message of a conversation, the runtime creates an opportunity in the first pipeline stage if the contact does not already have an open deal. It uses the organization currency and associates the deal with the auto-assigned member when distribution is enabled. The rule is opt-in; no deals are created automatically until an administrator enables it.
