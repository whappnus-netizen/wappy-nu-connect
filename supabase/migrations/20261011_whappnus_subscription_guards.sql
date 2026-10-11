-- Tenant-safe subscription read policy and organization suspension/reactivation hooks.
drop policy if exists "members read organization subscriptions" on public.organization_subscriptions;
create policy "members read organization subscriptions" on public.organization_subscriptions for select to authenticated using (public.is_member(organization_id));

create or replace function public.whappnus_subscription_is_active(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(o.status in ('active','trial') and s.status in ('active','trialing')
   and (s.current_period_end is null or s.current_period_end>now()),false)
 from public.organizations o
 left join lateral (select status,current_period_end from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
 where o.id=p_organization_id
$$;
revoke all on function public.whappnus_subscription_is_active(uuid) from public,anon,authenticated;
grant execute on function public.whappnus_subscription_is_active(uuid) to service_role;

create or replace function public.whappnus_apply_organization_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('suspended','blocked','cancelled') and old.status is distinct from new.status then
   update public.ai_agents set config=coalesce(config,'{}'::jsonb)||jsonb_build_object('_subscription_was_active',true),is_active=false,updated_at=now()
     where organization_id=new.id and is_active=true;
   update public.automation_rules set config=coalesce(config,'{}'::jsonb)||jsonb_build_object('_subscription_was_active',true),is_active=false,updated_at=now()
     where organization_id=new.id and is_active=true;
 elsif new.status in ('active','trial') and old.status in ('suspended','blocked') then
   update public.ai_agents set is_active=true,config=coalesce(config,'{}'::jsonb)-'_subscription_was_active',updated_at=now()
     where organization_id=new.id and config->>'_subscription_was_active'='true';
   update public.automation_rules set is_active=true,config=coalesce(config,'{}'::jsonb)-'_subscription_was_active',updated_at=now()
     where organization_id=new.id and config->>'_subscription_was_active'='true';
 end if;
 return new;
end $$;
revoke all on function public.whappnus_apply_organization_status() from public,anon,authenticated;
drop trigger if exists trg_whappnus_organization_status on public.organizations;
create trigger trg_whappnus_organization_status after update of status on public.organizations for each row execute function public.whappnus_apply_organization_status();

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
 elsif tg_table_name='automation_rules' and tg_op='INSERT' then
   v_limit:=coalesce((v_limits->>'automations')::bigint,0);
   if coalesce(new.is_active,false) then select count(*) into v_count from public.automation_rules where organization_id=v_org and is_active=true;
     if v_count>=v_limit then raise exception 'PLAN_LIMIT_AUTOMATIONS' using errcode='P0001'; end if; end if;
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
drop trigger if exists trg_whappnus_plan_ai_agents on public.ai_agents;
create trigger trg_whappnus_plan_ai_agents before insert or update on public.ai_agents for each row execute function public.whappnus_enforce_plan_limits();
drop trigger if exists trg_whappnus_plan_automations on public.automation_rules;
create trigger trg_whappnus_plan_automations before insert or update on public.automation_rules for each row execute function public.whappnus_enforce_plan_limits();
drop trigger if exists trg_whappnus_plan_whatsapp on public.whatsapp_numbers;
create trigger trg_whappnus_plan_whatsapp before insert on public.whatsapp_numbers for each row execute function public.whappnus_enforce_plan_limits();
drop trigger if exists trg_whappnus_plan_memberships on public.memberships;
create trigger trg_whappnus_plan_memberships before insert on public.memberships for each row execute function public.whappnus_enforce_plan_limits();
drop trigger if exists trg_whappnus_plan_deals on public.deals;
create trigger trg_whappnus_plan_deals before insert on public.deals for each row execute function public.whappnus_enforce_plan_limits();
