# Automation triggers — v2

Supported triggers:
- `keyword_match`: case-insensitive substring match against the inbound text.
- `outside_business_hours`: uses the organization's persisted IANA timezone, a configurable start/end time, and weekdays by default. The automatic reply is rate-limited per conversation by checking whether the same reply was sent in the previous 12 hours.
- `conversation_created`: runs only when the incoming message is the first inbound message in that conversation.

When multiple rules match, the execution priority is keyword, then outside-hours, then welcome. Keyword and outside-hours rules send one response and suppress AI generation for that inbound message to prevent duplicates. A welcome rule sends its greeting and then allows AI to answer the customer’s original question when AI is enabled. Human-assigned conversations are excluded from all automatic rules.

The outside-hours UI currently defaults to Monday–Friday and lets the organization set opening/closing times. Weekday configuration and more advanced action sequences remain a future increment.
