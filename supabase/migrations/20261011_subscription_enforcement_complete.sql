-- Final idempotent subscription enforcement state for WhappNus.
-- Commercial plan data and trial auto-assignment are defined in 20261011_whappnus_subscription_plans.sql.

CREATE OR REPLACE FUNCTION public.consume_ai_conversation(p_organization_id uuid, p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_status text;
  v_sub_status text;
  v_subscription_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_limits jsonb;
  v_limit bigint;
  v_used bigint;
  v_balance bigint;
begin
  if p_organization_id is null or p_conversation_id is null then
    return jsonb_build_object('allowed',false,'remaining',0,'reason','MISSING_CONTEXT');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_conversation_id::text,0));
  select o.status,s.status,s.id,s.current_period_start,s.current_period_end,p.limits
    into v_org_status,v_sub_status,v_subscription_id,v_period_start,v_period_end,v_plan_limits
  from public.organizations o
  left join lateral(select * from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
  left join public.subscription_plans p on p.id=s.plan_id
  where o.id=p_organization_id;

  if v_org_status is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','ORGANIZATION_NOT_FOUND'); end if;
  if v_org_status in ('suspended','blocked','cancelled') then return jsonb_build_object('allowed',false,'remaining',0,'reason','ACCOUNT_SUSPENDED'); end if;
  if v_sub_status is null or v_sub_status not in ('trialing','active') or (v_period_end is not null and v_period_end<=now()) then
    update public.organization_subscriptions set status='expired',updated_at=now()
      where id=v_subscription_id and status in ('trialing','active') and current_period_end<=now();
    update public.organizations set status='suspended',suspended_at=coalesce(suspended_at,now()),
      suspension_reason=coalesce(suspension_reason,'subscription_expired'),updated_at=now()
      where id=p_organization_id and status not in ('blocked','cancelled');
    return jsonb_build_object('allowed',false,'remaining',0,'reason','SUBSCRIPTION_REQUIRED');
  end if;

  v_limit:=coalesce((v_plan_limits->>'ai_conversations_monthly')::bigint,0);
  if v_limit<=0 then return jsonb_build_object('allowed',false,'remaining',0,'reason','PLAN_HAS_NO_AI_CONVERSATIONS'); end if;
  select count(distinct(metadata->>'conversation_id')) into v_used from public.ai_credit_ledger
    where organization_id=p_organization_id and reason='ai_conversation'
      and created_at>=coalesce(v_period_start,date_trunc('month',now()))
      and (v_period_end is null or created_at<v_period_end);

  if exists(select 1 from public.ai_credit_ledger where organization_id=p_organization_id and reason='ai_conversation'
      and metadata->>'conversation_id'=p_conversation_id::text
      and created_at>=coalesce(v_period_start,date_trunc('month',now()))
      and (v_period_end is null or created_at<v_period_end)) then
    return jsonb_build_object('allowed',true,'remaining',greatest(v_limit-v_used,0),'already_counted',true,'limit',v_limit,'used',v_used);
  end if;

  if v_used>=v_limit then
    update public.organization_subscriptions set status='suspended',updated_at=now()
      where id=v_subscription_id and status in ('trialing','active');
    update public.organizations set status='suspended',suspended_at=coalesce(suspended_at,now()),
      suspension_reason='ai_conversations_exhausted',updated_at=now()
      where id=p_organization_id and status not in ('blocked','cancelled');
    return jsonb_build_object('allowed',false,'remaining',0,'reason','AI_CONVERSATIONS_EXHAUSTED','limit',v_limit,'used',v_used);
  end if;

  insert into public.ai_credit_ledger(organization_id,units,reason,metadata)
    values(p_organization_id,-1,'ai_conversation',jsonb_build_object('conversation_id',p_conversation_id));
  v_used:=v_used+1;
  v_balance:=greatest(v_limit-v_used,0);
  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
    values(p_organization_id,v_balance,v_limit,now())
    on conflict(organization_id) do update set balance=excluded.balance,monthly_limit=excluded.monthly_limit,updated_at=now();

  if v_used>=v_limit then
    update public.organization_subscriptions set status='suspended',updated_at=now()
      where id=v_subscription_id and status in ('trialing','active');
    update public.organizations set status='suspended',suspended_at=coalesce(suspended_at,now()),
      suspension_reason='ai_conversations_exhausted',updated_at=now()
      where id=p_organization_id and status not in ('blocked','cancelled');
  end if;

  return jsonb_build_object('allowed',true,'remaining',v_balance,'limit',v_limit,'used',v_used);
end $function$
;

CREATE OR REPLACE FUNCTION public.suspend_expired_subscriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer := 0;
begin
  with expired as (
    select distinct on (s.organization_id) s.id as subscription_id,s.organization_id
    from public.organization_subscriptions s
    where s.status in ('trialing','active')
      and s.current_period_end is not null
      and s.current_period_end <= now()
    order by s.organization_id,s.created_at desc
  ), ended as (
    update public.organization_subscriptions s
      set status='expired',updated_at=now()
    from expired e
    where s.id=e.subscription_id
    returning s.organization_id
  ), suspended as (
    update public.organizations o
      set status='suspended',
          suspended_at=coalesce(o.suspended_at,now()),
          suspension_reason=coalesce(o.suspension_reason,'subscription_expired'),
          updated_at=now()
    from ended e
    where o.id=e.organization_id and o.status not in ('blocked','cancelled','suspended')
    returning o.id
  )
  select count(*) into v_count from suspended;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whappnus_apply_organization_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('suspended','blocked','cancelled') and old.status is distinct from new.status then
    update public.ai_agents
      set config=coalesce(config,'{}'::jsonb) || jsonb_build_object('_subscription_was_active',true),
          is_active=false, updated_at=now()
      where organization_id=new.id and is_active=true;
    update public.automation_rules
      set config=coalesce(config,'{}'::jsonb) || jsonb_build_object('_subscription_was_active',true),
          is_active=false, updated_at=now()
      where organization_id=new.id and is_active=true;
  elsif new.status in ('active','trial') and old.status in ('suspended','blocked') then
    update public.ai_agents
      set is_active=true, config=coalesce(config,'{}'::jsonb) - '_subscription_was_active', updated_at=now()
      where organization_id=new.id and config->>'_subscription_was_active'='true';
    update public.automation_rules
      set is_active=true, config=coalesce(config,'{}'::jsonb) - '_subscription_was_active', updated_at=now()
      where organization_id=new.id and config->>'_subscription_was_active'='true';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whappnus_enforce_plan_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_limits jsonb; v_sub_status text; v_org_status text; v_end timestamptz; v_limit bigint; v_count bigint;
begin
 if auth.uid() is null or pg_trigger_depth()>1 then return new; end if;
 v_org:=coalesce(new.organization_id,old.organization_id);
 select o.status,s.status,s.current_period_end,p.limits into v_org_status,v_sub_status,v_end,v_limits
 from public.organizations o
 left join lateral(select * from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
 left join public.subscription_plans p on p.id=s.plan_id where o.id=v_org;
 if v_org_status in ('suspended','blocked','cancelled') or v_sub_status is null or v_sub_status not in ('active','trialing') or (v_end is not null and v_end<=now()) then
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
end $function$
;

CREATE OR REPLACE FUNCTION public.whappnus_guard_ai_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if auth.uid() is null or pg_trigger_depth()>1 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_org:=coalesce(new.organization_id,old.organization_id);
  if not public.whappnus_subscription_is_active(v_org) then
    raise exception 'SUBSCRIPTION_REQUIRED: AI configuration is locked while the subscription is inactive' using errcode='P0001';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.whappnus_subscription_is_active(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    o.status in ('active','trial')
    and s.status in ('active','trialing')
    and (s.current_period_end is null or s.current_period_end > now()),
    false
  )
  from public.organizations o
  left join lateral (
    select status,current_period_end from public.organization_subscriptions
    where organization_id=o.id order by created_at desc limit 1
  ) s on true
  where o.id=p_organization_id
$function$
;


revoke all on function public.consume_ai_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_conversation(uuid,uuid) to service_role;
revoke all on function public.suspend_expired_subscriptions() from public,anon,authenticated;
grant execute on function public.suspend_expired_subscriptions() to service_role;
revoke all on function public.whappnus_enforce_plan_limits() from public,anon,authenticated;
revoke all on function public.whappnus_guard_ai_configuration() from public,anon,authenticated;
revoke all on function public.whappnus_subscription_is_active(uuid) from public,anon,authenticated;
grant execute on function public.whappnus_subscription_is_active(uuid) to service_role;
revoke all on function public.whappnus_apply_organization_status() from public,anon,authenticated;

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
drop trigger if exists trg_whappnus_organization_status on public.organizations;
create trigger trg_whappnus_organization_status after update of status on public.organizations for each row execute function public.whappnus_apply_organization_status();

drop trigger if exists trg_whappnus_lock_ai_settings on public.ai_settings;
create trigger trg_whappnus_lock_ai_settings before insert or update or delete on public.ai_settings for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_ai_knowledge on public.ai_knowledge;
create trigger trg_whappnus_lock_ai_knowledge before insert or update or delete on public.ai_knowledge for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_ai_knowledge_documents on public.ai_knowledge_documents;
create trigger trg_whappnus_lock_ai_knowledge_documents before insert or update or delete on public.ai_knowledge_documents for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_ai_training_examples on public.ai_training_examples;
create trigger trg_whappnus_lock_ai_training_examples before insert or update or delete on public.ai_training_examples for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_agent_whatsapp_assignments on public.ai_agent_whatsapp_numbers;
create trigger trg_whappnus_lock_agent_whatsapp_assignments before insert or update or delete on public.ai_agent_whatsapp_numbers for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_agent_delete on public.ai_agents;
create trigger trg_whappnus_lock_agent_delete before delete on public.ai_agents for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_automation_delete on public.automation_rules;
create trigger trg_whappnus_lock_automation_delete before delete on public.automation_rules for each row execute function public.whappnus_guard_ai_configuration();
drop trigger if exists trg_whappnus_lock_deal_delete on public.deals;
create trigger trg_whappnus_lock_deal_delete before delete on public.deals for each row execute function public.whappnus_guard_ai_configuration();
