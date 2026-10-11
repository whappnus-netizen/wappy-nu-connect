-- Restore authenticated read access to organization subscriptions.
-- Row-level security remains enforced by the existing "members read organization subscriptions"
-- policy, which only returns rows for organizations the current user belongs to.
grant select on public.organization_subscriptions to authenticated;
