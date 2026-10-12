-- Internal, service-role-only activation. It is idempotent per sale and records each paid sale.
create or replace function public.apply_kursinha_approved_sale(p_sale_id text)
returns jsonb language plpgsql set search_path=public as $$
declare
 v_sale public.kursinha_sales%rowtype;
 v_plan public.subscription_plans%rowtype;
 v_org_ids uuid[];
 v_org_id uuid;
 v_org_status text;
 v_org_reason text;
 v_existing public.organization_subscriptions%rowtype;
 v_new_end timestamptz;
 v_new_start timestamptz;
 v_new_subscription_id uuid;
begin
 if p_sale_id is null or length(trim(p_sale_id))=0 then return jsonb_build_object('ok',false,'reason','SALE_ID_REQUIRED'); end if;
 select * into v_sale from public.kursinha_sales where sale_id=trim(p_sale_id) for update;
 if not found then return jsonb_build_object('ok',false,'reason','SALE_NOT_FOUND'); end if;
 if v_sale.status <> 'approved' then return jsonb_build_object('ok',true,'applied',false,'reason','SALE_NOT_APPROVED','status',v_sale.status); end if;
 if v_sale.applied_at is not null then return jsonb_build_object('ok',true,'applied',true,'already_applied',true,'organization_id',v_sale.organization_id); end if;
 if v_sale.plan_id is null then
  update public.kursinha_sales set status='invalid',updated_at=now() where sale_id=v_sale.sale_id;
  return jsonb_build_object('ok',false,'reason','PLAN_MAPPING_MISSING');
 end if;
 select * into v_plan from public.subscription_plans where id=v_sale.plan_id and is_active=true;
 if not found then
  update public.kursinha_sales set status='invalid',updated_at=now() where sale_id=v_sale.sale_id;
  return jsonb_build_object('ok',false,'reason','PLAN_INACTIVE');
 end if;
 v_org_id := v_sale.organization_id;
 if v_org_id is null then
  select array_agg(distinct m.organization_id) into v_org_ids
  from public.profiles p join public.memberships m on m.user_id=p.id and m.role='OWNER'
  where lower(trim(p.email))=lower(trim(v_sale.buyer_email));
  if coalesce(cardinality(v_org_ids),0) <> 1 then return jsonb_build_object('ok',true,'applied',false,'reason','ACCOUNT_ASSOCIATION_REQUIRED'); end if;
  v_org_id := v_org_ids[1];
 end if;
 select status,suspension_reason into v_org_status,v_org_reason from public.organizations where id=v_org_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','ORGANIZATION_NOT_FOUND'); end if;
 select * into v_existing from public.organization_subscriptions
  where organization_id=v_org_id and status in ('active','trialing') and (current_period_end is null or current_period_end>now())
  order by created_at desc limit 1 for update;
 if found and v_existing.status='active' and v_existing.current_period_end is not null then
  v_new_end := greatest(v_existing.current_period_end,now()) + interval '30 days';
  v_new_start := coalesce(v_existing.current_period_start,now());
 else
  v_new_start := now(); v_new_end := now() + interval '30 days';
 end if;
 if v_existing.id is not null then
  update public.organization_subscriptions set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_existing.id;
 end if;
 insert into public.organization_subscriptions
  (organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,provider,provider_subscription_id,metadata)
 values (v_org_id,v_plan.id,'active','monthly',v_sale.amount_aoa,'AOA',now(),v_new_start,v_new_end,'kursinha',v_sale.sale_id,
  jsonb_build_object('kursinha_sale_id',v_sale.sale_id,'kursinha_product_id',v_sale.product_id,'source','verified_webhook'))
 returning id into v_new_subscription_id;
 insert into public.payment_transactions
  (organization_id,subscription_id,provider,provider_payment_id,idempotency_key,status,amount_aoa,currency,description,paid_at,metadata)
 values (v_org_id,v_new_subscription_id,'kursinha',v_sale.sale_id,'sale:'||v_sale.sale_id,'succeeded',v_sale.amount_aoa,'AOA',
  'Pagamento Kursinha - '||coalesce(v_sale.product_name,v_plan.name),coalesce(v_sale.approved_at,now()),
  jsonb_build_object('sale_id',v_sale.sale_id,'order_id',v_sale.order_id,'product_id',v_sale.product_id))
 on conflict (provider,idempotency_key) do nothing;
 update public.kursinha_sales set organization_id=v_org_id,subscription_id=v_new_subscription_id,applied_at=now(),updated_at=now()
  where sale_id=v_sale.sale_id;
 if v_org_status in ('trial','setup') or (v_org_status='suspended' and v_org_reason in ('subscription_expired','payment_refunded','ai_conversations_exhausted')) then
  update public.organizations set status='active',suspended_at=null,suspension_reason=null,updated_at=now()
   where id=v_org_id and status not in ('blocked','cancelled');
 end if;
 return jsonb_build_object('ok',true,'applied',true,'organization_id',v_org_id,'subscription_id',v_new_subscription_id,'period_end',v_new_end);
end;
$$;
revoke all on function public.apply_kursinha_approved_sale(text) from public,anon,authenticated;
grant execute on function public.apply_kursinha_approved_sale(text) to service_role;
