-- Harden the trigger-only conversation activity function and plan-limit trigger search path.
alter function public.enforce_org_plan_resource_limits() set search_path = public, pg_temp;
revoke execute on function public.whappnus_sync_conversation_activity() from public, anon, authenticated;
revoke execute on function public.enforce_org_plan_resource_limits() from public, anon, authenticated;
