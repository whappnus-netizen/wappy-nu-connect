# Inbox to CRM — v1.1

The Inbox provides an explicit action to convert a conversation into an opportunity. This is intentional: not every WhatsApp conversation is a qualified sales lead, so the system should not automatically classify every contact as a sales opportunity.

When a team member selects **Criar oportunidade no CRM**, the app:
1. Requires a contact associated with the conversation.
2. Checks whether that contact already has an open opportunity in the organization.
3. Uses the first configured pipeline stage.
4. Creates an open opportunity linked to the same contact, with the organization's currency.
5. Refreshes the CRM query.

The CRM creation form also allows associating an existing contact with a manually created opportunity. Both paths preserve organization isolation through the existing RLS policies.
