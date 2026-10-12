-- Map only the Kursinha products whose IDs and prices have been confirmed.
insert into public.kursinha_product_mappings(product_id,plan_id,expected_amount_aoa,currency,checkout_url,is_active)
select '6aca37f7bad1248c97213091',id,10000,'AOA','https://pay.kursinha.com/c/6aca37f7bad1248c97213091',true
from public.subscription_plans where code='start-monthly'
on conflict(product_id) do update set plan_id=excluded.plan_id,expected_amount_aoa=excluded.expected_amount_aoa,currency=excluded.currency,checkout_url=excluded.checkout_url,is_active=true,updated_at=now();
insert into public.kursinha_product_mappings(product_id,plan_id,expected_amount_aoa,currency,checkout_url,is_active)
select '6aca8c46e62b25eb5a5f9df3',id,25000,'AOA','https://pay.kursinha.com/c/6aca8c46e62b25eb5a5f9df3',true
from public.subscription_plans where code='pro-monthly'
on conflict(product_id) do update set plan_id=excluded.plan_id,expected_amount_aoa=excluded.expected_amount_aoa,currency=excluded.currency,checkout_url=excluded.checkout_url,is_active=true,updated_at=now();
-- Premium (45,000 Kz) is intentionally not mapped until its real Kursinha product ID is confirmed.
