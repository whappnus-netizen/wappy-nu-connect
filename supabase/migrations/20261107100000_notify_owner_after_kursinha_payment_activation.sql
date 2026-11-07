create or replace function public.notify_kursinha_sale_activation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_org_name text; v_plan_name text; v_end timestamptz; v_message text;
begin
 if old.applied_at is not null or new.applied_at is null or new.status<>'approved' or new.organization_id is null then return new; end if;
 select o.name,s.current_period_end,p.name into v_org_name,v_end,v_plan_name
 from public.organizations o left join public.organization_subscriptions s on s.id=new.subscription_id
 left join public.subscription_plans p on p.id=new.plan_id where o.id=new.organization_id;
 v_message:='O pagamento do plano '||coalesce(v_plan_name,new.product_name,'WHAPPNUS')||' ('||
 to_char(new.amount_aoa,'FM999G999G990')||' Kz) foi confirmado. A assinatura de '||
 coalesce(v_org_name,'a tua organização')||' está activa até '||
 coalesce(to_char(v_end at time zone 'Africa/Luanda','DD/MM/YYYY'),'à data indicada no painel')||
 '. Obrigado por escolher a WHAPPNUS!';
 insert into public.organization_notifications(organization_id,title,body,notification_type,metadata)
 values(new.organization_id,'Pagamento confirmado',v_message,'subscription',
 jsonb_build_object('source','kursinha-webhook','sale_id',new.sale_id,'subscription_id',new.subscription_id,'event','payment_approved'));
 insert into public.platform_notification_delivery_logs(organization_id,subscription_id,recipient_user_id,event_type,channel,status,destination,message,idempotency_key,sent_at,metadata)
 select new.organization_id,new.subscription_id,m.user_id,'payment_approved','in_app','sent',m.user_id::text,v_message,
 'payment_approved:'||new.sale_id||':in_app',now(),jsonb_build_object('sale_id',new.sale_id,'source','kursinha-webhook')
 from public.memberships m where m.organization_id=new.organization_id and m.role='OWNER'
 order by m.created_at asc limit 1 on conflict(idempotency_key) do nothing;
 return new;
end; $$;
drop trigger if exists kursinha_sale_activation_notification on public.kursinha_sales;
create trigger kursinha_sale_activation_notification after update of applied_at on public.kursinha_sales
for each row execute function public.notify_kursinha_sale_activation();