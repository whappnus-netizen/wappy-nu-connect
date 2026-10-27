-- Count each successfully generated AI reply as one plan unit, not one conversation.
-- Keep the subscription active when the message allowance is exhausted; only AI replies are blocked.
update public.subscription_plans
set limits = (limits - 'ai_conversations_monthly') || jsonb_build_object(
  'ai_messages_monthly',
  coalesce((limits->>'ai_messages_monthly')::bigint, (limits->>'ai_conversations_monthly')::bigint, 0)
)
where limits ? 'ai_conversations_monthly' or limits ? 'ai_messages_monthly';

create or replace function public.consume_ai_message(
  p_organization_id uuid,
  p_message_key text,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org_status text;
  v_sub_status text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_plan_limits jsonb;
  v_limit bigint;
  v_used bigint;
  v_balance bigint;
begin
  if p_organization_id is null or nullif(trim(p_message_key), '') is null then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'MISSING_CONTEXT');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':ai_messages', 0));
  select o.status, s.status, s.current_period_start, s.current_period_end, p.limits
    into v_org_status, v_sub_status, v_period_start, v_period_end, v_plan_limits
  from public.organizations o
  left join lateral (select * from public.organization_subscriptions where organization_id=o.id order by created_at desc limit 1) s on true
  left join public.subscription_plans p on p.id=s.plan_id
  where o.id=p_organization_id;

  if v_org_status is null then return jsonb_build_object('allowed',false,'remaining',0,'reason','ORGANIZATION_NOT_FOUND'); end if;
  if v_org_status in ('suspended','blocked','cancelled') then return jsonb_build_object('allowed',false,'remaining',0,'reason','ACCOUNT_SUSPENDED'); end if;
  if v_sub_status is null or v_sub_status not in ('trialing','active') or (v_period_end is not null and v_period_end<=now()) then
    return jsonb_build_object('allowed',false,'remaining',0,'reason','SUBSCRIPTION_REQUIRED');
  end if;

  v_limit:=coalesce((v_plan_limits->>'ai_messages_monthly')::bigint,0);
  if v_limit<=0 then return jsonb_build_object('allowed',false,'remaining',0,'reason','PLAN_HAS_NO_AI_MESSAGES'); end if;

  if exists(select 1 from public.ai_credit_ledger where organization_id=p_organization_id and reason='ai_message'
    and metadata->>'message_id'=p_message_key
    and created_at>=coalesce(v_period_start,date_trunc('month',now()))
    and (v_period_end is null or created_at<v_period_end)) then
    select count(*) into v_used from public.ai_credit_ledger where organization_id=p_organization_id and reason='ai_message'
      and created_at>=coalesce(v_period_start,date_trunc('month',now()))
      and (v_period_end is null or created_at<v_period_end);
    return jsonb_build_object('allowed',true,'already_counted',true,'remaining',greatest(v_limit-v_used,0),'limit',v_limit,'used',v_used);
  end if;

  select count(*) into v_used from public.ai_credit_ledger where organization_id=p_organization_id and reason='ai_message'
    and created_at>=coalesce(v_period_start,date_trunc('month',now()))
    and (v_period_end is null or created_at<v_period_end);
  if v_used>=v_limit then return jsonb_build_object('allowed',false,'remaining',0,'reason','AI_MESSAGES_EXHAUSTED','limit',v_limit,'used',v_used); end if;

  insert into public.ai_credit_ledger(organization_id,units,reason,metadata)
    values(p_organization_id,-1,'ai_message',jsonb_build_object('message_id',p_message_key,'conversation_id',p_conversation_id));
  v_used:=v_used+1;
  v_balance:=greatest(v_limit-v_used,0);
  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
    values(p_organization_id,v_balance,v_limit,now())
    on conflict(organization_id) do update set balance=excluded.balance,monthly_limit=excluded.monthly_limit,updated_at=now();
  return jsonb_build_object('allowed',true,'remaining',v_balance,'limit',v_limit,'used',v_used);
end;
$function$;

revoke all on function public.consume_ai_message(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_message(uuid,text,uuid) to service_role;

-- Preserve the old successful-generation history as per-message usage for the current billing period.
insert into public.ai_credit_ledger(organization_id, units, reason, metadata, created_at)
select l.organization_id, -1, 'ai_message',
  jsonb_build_object('message_id', 'legacy-ai-log:' || l.id::text, 'conversation_id', l.conversation_id),
  l.created_at
from public.ai_logs l
join lateral (
  select current_period_start, current_period_end
  from public.organization_subscriptions
  where organization_id=l.organization_id
  order by created_at desc limit 1
) s on true
where l.event_type='generation' and l.status='success'
  and l.created_at >= coalesce(s.current_period_start, date_trunc('month', now()))
  and (s.current_period_end is null or l.created_at < s.current_period_end)
  and not exists (
    select 1 from public.ai_credit_ledger c
    where c.organization_id=l.organization_id and c.reason='ai_message'
      and c.metadata->>'message_id'='legacy-ai-log:' || l.id::text
  );

-- Recover only accounts suspended by the old conversation-limit mechanism, if their subscription is still valid.
update public.organization_subscriptions s
set status='active', updated_at=now()
where s.status='suspended'
  and s.organization_id in (select id from public.organizations where suspension_reason='ai_conversations_exhausted')
  and (s.current_period_end is null or s.current_period_end>now());

update public.organizations o
set status='active', suspension_reason=null, suspended_at=null, updated_at=now()
where o.suspension_reason='ai_conversations_exhausted' and o.status='suspended'
  and exists(select 1 from public.organization_subscriptions s where s.organization_id=o.id
    and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()));
