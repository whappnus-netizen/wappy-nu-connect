# WhappNus Superadmin v1 — integration notes

## Current architecture confirmed
- Frontend repository: `whappnus-netizen/wappy-nu-connect` (Netlify site `whappnus1`, custom domain `https://whappnus.online`).
- External Supabase project: `icqkoafhitudaqylnnfd` (active, EU West 2). Keep this as the source of truth.
- Railway services: `WhappNus-AI-Engine` and WhatsApp engine remain separate runtime services.
- Existing public schema already contains organizations, memberships, profiles, WhatsApp sessions/numbers, AI settings/logs, conversations, messages, and activity logs. This migration is additive; it does not recreate those tables.

## Superadmin v1 modules
1. Overview: organization count, active/suspended tenants, active subscriptions, payment failures, WhatsApp connection health, AI errors.
2. Organizations: search/list, create organization, suspend/reactivate, inspect tenant health. No client-side cross-tenant SQL access.
3. Subscriptions & plans: monthly/yearly plan catalog, status, period, renewal/cancellation.
4. Payments: provider reference, amount in AOA, status, idempotency; payment webhooks must verify provider signatures and deduplicate provider event IDs.
5. WhatsApp: connection state and one-use invitation metadata; never store raw QR credentials/tokens in audit logs.
6. AI configuration/health: per-tenant agent status, provider/model health, usage and failures without exposing API keys.
7. Team & audit: scoped staff permissions and immutable audit history.

## Security boundary (required)
- The browser may only read its own `superadmin_users` membership and active plan catalog.
- Every administrative operation must call a Supabase Edge Function (or a private authenticated backend endpoint). That function must validate the user's active superadmin row and role/permission for each action before using the service-role key.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, payment secrets, AI provider keys, or webhook secrets in Netlify frontend environment variables prefixed with `VITE_` or in browser code.
- Do not rely on hiding routes or a SPA URL for security. Route visibility is UX only; authorization is enforced on the server and by RLS.
- Payment webhooks must verify signatures, use idempotency, and only then update `payment_transactions` and `organization_subscriptions`.
- Use least privilege: support staff cannot change billing; billing staff cannot change owner accounts; only owner can promote another owner.

## Migration
Run `supabase/migrations/20261010_superadmin_v1.sql` manually in the SQL editor of external project `icqkoafhitudaqylnnfd`. Then insert the owner's auth UUID using the bootstrap statement at the bottom of that migration. Do not run the bootstrap until the correct auth user UUID is known.

## Implementation status
This commit adds the database migration and implementation/security specification. The existing frontend's route/layout source was not discoverable through the connected GitHub code-search index during this run, so no existing route was overwritten blindly. Next safe step is to inspect the current app entry/router and add a protected `/superadmin` route plus Edge Functions for dashboard, organizations, plans, billing, invites, and audit.
