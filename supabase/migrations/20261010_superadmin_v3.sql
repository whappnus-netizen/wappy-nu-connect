-- WhappNus Super Admin v3: least-privilege grants for the public plan catalog.
begin;
revoke all on public.subscription_plans from anon;
grant select on public.subscription_plans to authenticated;
commit;
