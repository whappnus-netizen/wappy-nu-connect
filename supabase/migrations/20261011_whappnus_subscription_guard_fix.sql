-- Correct the plan guard so active subscribers can edit their AI and automation settings,
-- and enforce automation limits when an existing paused rule is activated.
create or replace function public.whappnus_enforce_plan_limits()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_limits jsonb; v_sub_status text; v_org_status text; v_end timestamptz; v_limit bigint; v_count bigint;
begin
 if auth.uid() is null or pg_trigger_depth()>1 then return new; end if;
 v_org:=coalesce(new.organization_id,old.organization_id);
 select o.status,s.status,s.current_period_end,p.limits into v_org_status,v_sub_status,v_end,v_limits
 from public.organizations o
 left join lateral(select * from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
 left join public.subscription_plans p on p.id=s.plan_id where o.id=v_org;
 if v_org_status in ('suspended','blocked','cancelled') or v_sub_status not in ('active','trialing') or (v_end is not null and v_end<=now()) then
   raise exception 'SUBSCRIPTION_REQUIRED' using errcode='P0001';
 end if;
 if tg_table_name='ai_agents' and tg_op='INSERT' then
   v_limit:=coalesce((v_limits->>'agents')::bigint,0); select count(*) into v_count from public.ai_agents where organization_id=v_org;
   if v_count>=v_limit then raise exception 'PLAN_LIMIT_AGENTS' using errcode='P0001'; end if;
 elsif tg_table_name='automation_rules' and
       (tg_op='INSERT' or (tg_op='UPDATE' and coalesce(new.is_active,false) and not coalesce(old.is_active,false))) then
   v_limit:=coalesce((v_limits->>'automations')::bigint,0);
   if coalesce(new.is_active,false) then
     select count(*) into v_count from public.automation_rules where organization_id=v_org and is_active=true
       and (tg_op='INSERT' or id<>new.id);
     if v_count>=v_limit then raise exception 'PLAN_LIMIT_AUTOMATIONS' using errcode='P0001'; end if;
   end if;
 elsif tg_table_name='whatsapp_numbers' and tg_op='INSERT' then
   v_limit:=coalesce((v_limits->>'whatsapp_numbers')::bigint,0); select count(*) into v_count from public.whatsapp_numbers where organization_id=v_org and deleted_at is null;
   if v_count>=v_limit then raise exception 'PLAN_LIMIT_WHATSAPP_NUMBERS' using errcode='P0001'; end if;
 elsif tg_table_name='memberships' and tg_op='INSERT' then
   v_limit:=coalesce((v_limits->>'team_members')::bigint,1); select count(*) into v_count from public.memberships where organization_id=v_org;
   if v_count>=v_limit then raise exception 'PLAN_LIMIT_TEAM_MEMBERS' using errcode='P0001'; end if;
 end if;
 return new;
end $$;
revoke all on function public.whappnus_enforce_plan_limits() from public,anon,authenticated;
