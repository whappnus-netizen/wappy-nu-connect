-- Keep AI conversation billing compatible with the legacy plan key and avoid
-- suspending the whole organization when only its AI allowance is exhausted.
create or replace function public.consume_ai_conversation(
  p_organization_id uuid,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  left join lateral(
    select *
    from public.organization_subscriptions
    where organization_id=o.id
    order by created_at desc
    limit 1
  ) s on true
  left join public.subscription_plans p on p.id=s.plan_id
  where o.id=p_organization_id;

  if v_org_status is null then
    return jsonb_build_object('allowed',false,'remaining',0,'reason','ORGANIZATION_NOT_FOUND');
  end if;

  if v_org_status in ('suspended','blocked','cancelled') then
    return jsonb_build_object('allowed',false,'remaining',0,'reason','ACCOUNT_SUSPENDED');
  end if;

  if v_sub_status is null or v_sub_status not in ('trialing','active')
     or (v_period_end is not null and v_period_end<=now()) then
    update public.organization_subscriptions
      set status='expired',updated_at=now()
      where id=v_subscription_id
        and status in ('trialing','active')
        and current_period_end<=now();

    update public.organizations
      set status='suspended',
          suspended_at=coalesce(suspended_at,now()),
          suspension_reason=coalesce(suspension_reason,'subscription_expired'),
          updated_at=now()
      where id=p_organization_id and status not in ('blocked','cancelled');

    return jsonb_build_object('allowed',false,'remaining',0,'reason','SUBSCRIPTION_REQUIRED');
  end if;

  v_limit:=coalesce(
    nullif(v_plan_limits->>'ai_conversations_monthly','')::bigint,
    nullif(v_plan_limits->>'ai_messages_monthly','')::bigint,
    0
  );

  if v_limit<=0 then
    return jsonb_build_object('allowed',false,'remaining',0,'reason','PLAN_HAS_NO_AI_CONVERSATIONS');
  end if;

  select count(distinct(metadata->>'conversation_id'))
    into v_used
  from public.ai_credit_ledger
  where organization_id=p_organization_id
    and reason='ai_conversation'
    and created_at>=coalesce(v_period_start,date_trunc('month',now()))
    and (v_period_end is null or created_at<v_period_end);

  if exists(
    select 1
    from public.ai_credit_ledger
    where organization_id=p_organization_id
      and reason='ai_conversation'
      and metadata->>'conversation_id'=p_conversation_id::text
      and created_at>=coalesce(v_period_start,date_trunc('month',now()))
      and (v_period_end is null or created_at<v_period_end)
  ) then
    return jsonb_build_object(
      'allowed',true,
      'remaining',greatest(v_limit-v_used,0),
      'already_counted',true,
      'limit',v_limit,
      'used',v_used
    );
  end if;

  if v_used>=v_limit then
    return jsonb_build_object(
      'allowed',false,
      'remaining',0,
      'reason','AI_CONVERSATIONS_EXHAUSTED',
      'limit',v_limit,
      'used',v_used
    );
  end if;

  insert into public.ai_credit_ledger(organization_id,units,reason,metadata)
    values(p_organization_id,-1,'ai_conversation',jsonb_build_object('conversation_id',p_conversation_id));

  v_used:=v_used+1;
  v_balance:=greatest(v_limit-v_used,0);

  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
    values(p_organization_id,v_balance,v_limit,now())
    on conflict(organization_id) do update
      set balance=excluded.balance,
          monthly_limit=excluded.monthly_limit,
          updated_at=now();

  return jsonb_build_object('allowed',true,'remaining',v_balance,'limit',v_limit,'used',v_used);
end
$function$;

-- Restore only organizations accidentally suspended by the former
-- ai_conversations_exhausted branch; expired or manually suspended accounts
-- are deliberately not changed.
with recoverable as (
  select o.id as organization_id, s.id as subscription_id
  from public.organizations o
  join lateral (
    select *
    from public.organization_subscriptions
    where organization_id=o.id
    order by created_at desc
    limit 1
  ) s on true
  join public.subscription_plans p on p.id=s.plan_id
  where o.status='suspended'
    and o.suspension_reason='ai_conversations_exhausted'
    and s.status='suspended'
    and (s.current_period_end is null or s.current_period_end>now())
    and coalesce(
      nullif(p.limits->>'ai_conversations_monthly','')::bigint,
      nullif(p.limits->>'ai_messages_monthly','')::bigint,
      0
    )>0
)
update public.organization_subscriptions s
set status='active', updated_at=now()
where s.id in (select subscription_id from recoverable);

with recoverable as (
  select o.id as organization_id
  from public.organizations o
  join lateral (
    select *
    from public.organization_subscriptions
    where organization_id=o.id
    order by created_at desc
    limit 1
  ) s on true
  join public.subscription_plans p on p.id=s.plan_id
  where o.status='suspended'
    and o.suspension_reason='ai_conversations_exhausted'
    and s.status='active'
    and (s.current_period_end is null or s.current_period_end>now())
    and coalesce(
      nullif(p.limits->>'ai_conversations_monthly','')::bigint,
      nullif(p.limits->>'ai_messages_monthly','')::bigint,
      0
    )>0
)
update public.organizations o
set status='active', suspended_at=null, suspension_reason=null, updated_at=now()
where o.id in (select organization_id from recoverable);
