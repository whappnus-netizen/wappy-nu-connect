-- Paid-plan signups must not receive an automatic free trial while awaiting payment activation.
create or replace function public.start_organization_trial()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  v_plan public.subscription_plans%rowtype;
  v_now timestamptz := now();
  v_selected_plan text;
begin
  if new.management_mode <> 'self_service' then
    return new;
  end if;

  if auth.uid() is not null then
    select raw_user_meta_data->>'selected_plan_code'
      into v_selected_plan
      from auth.users
      where id = auth.uid();
    if v_selected_plan in ('start-monthly', 'pro-monthly', 'premium-monthly') then
      return new;
    end if;
  end if;

  select * into v_plan from public.subscription_plans
  where code='free-trial' and is_active=true limit 1;
  if v_plan.id is null then return new; end if;

  insert into public.organization_subscriptions
    (organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,provider,metadata)
  values
    (new.id,v_plan.id,'trialing','monthly',0,'AOA',v_now,v_now,v_now + make_interval(days => v_plan.trial_days),'manual',
     jsonb_build_object('source','automatic_trial','trial_days',v_plan.trial_days))
  on conflict do nothing;

  insert into public.ai_credit_accounts(organization_id,balance,monthly_limit,updated_at)
  values(new.id,coalesce((v_plan.limits->>'ai_conversations_monthly')::bigint,150),
    coalesce((v_plan.limits->>'ai_conversations_monthly')::bigint,150),v_now)
  on conflict (organization_id) do update set
    balance=excluded.balance, monthly_limit=excluded.monthly_limit, updated_at=v_now;

  update public.organizations set status='trial' where id=new.id and status='active';
  return new;
end;
$function$;
