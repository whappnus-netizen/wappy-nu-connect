-- WhappNus plans, automatic trial creation, and one-count-per-conversation usage.
insert into public.subscription_plans
  (code,name,description,billing_interval,price_aoa,trial_days,limits,features,is_active,sort_order)
values
  ('free-trial','Teste grátis','Acesso de avaliação durante 7 dias, sem cartão bancário.','monthly',0,7,
   '{"whatsapp_numbers":1,"agents":1,"ai_conversations_monthly":150,"automations":2,"team_members":1}'::jsonb,
   '{"dashboard":true,"inbox":true,"contacts":true,"crm":true,"ai":true,"automations":true}'::jsonb,true,1),
  ('start-monthly','WhappNus Start','Para negócios que querem começar a automatizar o atendimento.','monthly',10000,0,
   '{"whatsapp_numbers":1,"agents":1,"ai_conversations_monthly":1500,"automations":2,"team_members":2}'::jsonb,
   '{"dashboard":true,"inbox":true,"contacts":true,"crm":true,"ai":true,"automations":true}'::jsonb,true,2),
  ('pro-monthly','WhappNus Pro','Mais capacidade para equipas em crescimento.','monthly',25000,0,
   '{"whatsapp_numbers":2,"agents":2,"ai_conversations_monthly":4000,"automations":5,"team_members":4}'::jsonb,
   '{"dashboard":true,"inbox":true,"contacts":true,"crm":true,"ai":true,"automations":true}'::jsonb,true,3),
  ('premium-monthly','WhappNus Premium','Capacidade avançada para operações de maior volume.','monthly',45000,0,
   '{"whatsapp_numbers":4,"agents":4,"ai_conversations_monthly":10000,"automations":15,"team_members":10}'::jsonb,
   '{"dashboard":true,"inbox":true,"contacts":true,"crm":true,"ai":true,"automations":true}'::jsonb,true,4)
on conflict (code) do update set
  name=excluded.name, description=excluded.description, billing_interval=excluded.billing_interval,
  price_aoa=excluded.price_aoa, trial_days=excluded.trial_days, limits=excluded.limits,
  features=excluded.features, is_active=excluded.is_active, sort_order=excluded.sort_order,
  updated_at=now();

update public.subscription_plans set is_active=false,updated_at=now()
where code in ('starter-monthly','starter-yearly','pro-yearly');

create or replace function public.start_organization_trial()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_plan public.subscription_plans%rowtype; v_now timestamptz:=now();
begin
  if new.management_mode <> 'self_service' then return new; end if;
  select * into v_plan from public.subscription_plans where code='free-trial' and is_active=true limit 1;
  if v_plan.id is null then return new; end if;
  insert into public.organization_subscriptions
    (organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,provider,metadata)
  values (new.id,v_plan.id,'trialing','monthly',0,'AOA',v_now,v_now,v_now+make_interval(days=>v_plan.trial_days),'manual',
    jsonb_build_object('source','automatic_trial','trial_days',v_plan.trial_days)) on conflict do nothing;
  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
  values(new.id,coalesce((v_plan.limits->>'ai_conversations_monthly')::bigint,150),coalesce((v_plan.limits->>'ai_conversations_monthly')::bigint,150),v_now)
  on conflict(organization_id) do update set balance=excluded.balance,monthly_limit=excluded.monthly_limit,updated_at=v_now;
  update public.organizations set status='trial' where id=new.id and status='active';
  return new;
end $$;
revoke all on function public.start_organization_trial() from public,anon,authenticated;
drop trigger if exists trg_start_organization_trial on public.organizations;
create trigger trg_start_organization_trial after insert on public.organizations for each row execute function public.start_organization_trial();

create or replace function public.consume_ai_conversation(p_organization_id uuid,p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org_status text; v_sub_status text; v_period_start timestamptz; v_period_end timestamptz;
  v_plan_limits jsonb; v_limit bigint; v_used bigint; v_balance bigint;
begin
  if p_organization_id is null or p_conversation_id is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','MISSING_CONTEXT'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_conversation_id::text,0));
  select o.status,s.status,s.current_period_start,s.current_period_end,p.limits
    into v_org_status,v_sub_status,v_period_start,v_period_end,v_plan_limits
  from public.organizations o
  left join lateral (select * from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
  left join public.subscription_plans p on p.id=s.plan_id where o.id=p_organization_id;
  if v_org_status is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','ORGANIZATION_NOT_FOUND'); end if;
  if v_org_status in ('suspended','blocked','cancelled') then return jsonb_build_object('allowed',false,'remaining',0,'reason','ACCOUNT_SUSPENDED'); end if;
  if v_sub_status not in ('trialing','active') or (v_period_end is not null and v_period_end<=now()) then
    update public.organizations set status='suspended',suspended_at=coalesce(suspended_at,now()),
      suspension_reason=coalesce(suspension_reason,'subscription_expired'),updated_at=now()
      where id=p_organization_id and status not in ('blocked','cancelled');
    update public.organization_subscriptions set status='expired',updated_at=now()
      where organization_id=p_organization_id and status='trialing' and current_period_end<=now();
    return jsonb_build_object('allowed',false,'remaining',0,'reason','SUBSCRIPTION_REQUIRED');
  end if;
  v_limit:=coalesce((v_plan_limits->>'ai_conversations_monthly')::bigint,0);
  if v_limit<=0 then return jsonb_build_object('allowed',false,'remaining',0,'reason','PLAN_HAS_NO_AI_CONVERSATIONS'); end if;
  select count(distinct(metadata->>'conversation_id')) into v_used from public.ai_credit_ledger
    where organization_id=p_organization_id and reason='ai_conversation'
      and created_at>=coalesce(v_period_start,date_trunc('month',now())) and (v_period_end is null or created_at<v_period_end);
  if exists(select 1 from public.ai_credit_ledger where organization_id=p_organization_id and reason='ai_conversation'
      and metadata->>'conversation_id'=p_conversation_id::text
      and created_at>=coalesce(v_period_start,date_trunc('month',now())) and (v_period_end is null or created_at<v_period_end)) then
    return jsonb_build_object('allowed',true,'remaining',greatest(v_limit-v_used,0),'already_counted',true);
  end if;
  if v_used>=v_limit then return jsonb_build_object('allowed',false,'remaining',0,'reason','AI_CONVERSATIONS_EXHAUSTED','limit',v_limit,'used',v_used); end if;
  insert into public.ai_credit_ledger(organization_id,units,reason,metadata)
    values(p_organization_id,-1,'ai_conversation',jsonb_build_object('conversation_id',p_conversation_id));
  v_used:=v_used+1; v_balance:=greatest(v_limit-v_used,0);
  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at) values(p_organization_id,v_balance,v_limit,now())
  on conflict(organization_id) do update set balance=excluded.balance,monthly_limit=excluded.monthly_limit,updated_at=now();
  return jsonb_build_object('allowed',true,'remaining',v_balance,'limit',v_limit,'used',v_used);
end $$;
revoke all on function public.consume_ai_conversation(uuid,uuid) from public,anon;
grant execute on function public.consume_ai_conversation(uuid,uuid) to service_role;

do $$ declare r record; v_plan public.subscription_plans%rowtype; v_now timestamptz:=now();
begin
  select * into v_plan from public.subscription_plans where code='free-trial' limit 1;
  for r in select o.id from public.organizations o where o.management_mode='self_service'
    and not exists(select 1 from public.organization_subscriptions s where s.organization_id=o.id)
  loop
    insert into public.organization_subscriptions(organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,provider,metadata)
      values(r.id,v_plan.id,'trialing','monthly',0,'AOA',v_now,v_now,v_now+interval '7 days','manual',jsonb_build_object('source','legacy_trial_backfill','trial_days',7));
    insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at) values(r.id,150,150,v_now) on conflict(organization_id) do nothing;
    update public.organizations set status='trial' where id=r.id and status='active';
  end loop;
end $$;
