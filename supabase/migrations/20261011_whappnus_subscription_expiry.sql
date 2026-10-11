-- Called by the always-on AI Engine once per minute; organization status changes pause agents and automations.
create or replace function public.suspend_expired_subscriptions()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0;
begin
 with expired as (
  select distinct on (s.organization_id) s.id as subscription_id,s.organization_id
  from public.organization_subscriptions s
  where s.status in ('trialing','active') and s.current_period_end is not null and s.current_period_end<=now()
  order by s.organization_id,s.created_at desc
 ), ended as (
  update public.organization_subscriptions s set status='expired',updated_at=now()
  from expired e where s.id=e.subscription_id returning s.organization_id
 ), suspended as (
  update public.organizations o set status='suspended',suspended_at=coalesce(o.suspended_at,now()),
   suspension_reason=coalesce(o.suspension_reason,'subscription_expired'),updated_at=now()
  from ended e where o.id=e.organization_id and o.status not in ('blocked','cancelled','suspended') returning o.id
 )
 select count(*) into v_count from suspended;
 return v_count;
end $$;
revoke all on function public.suspend_expired_subscriptions() from public,anon,authenticated;
grant execute on function public.suspend_expired_subscriptions() to service_role;
