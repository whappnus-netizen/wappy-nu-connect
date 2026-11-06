-- Keep WHAPPNUS plan prices and Kursinha validation in sync with the seller's updated product prices.
begin;
update public.subscription_plans
set price_aoa = case code
  when 'start-monthly' then 5000
  when 'pro-monthly' then 10000
  when 'premium-monthly' then 20000
  else price_aoa
end,
updated_at = now()
where code in ('start-monthly','pro-monthly','premium-monthly');

update public.kursinha_product_mappings m
set expected_amount_aoa = case p.code
  when 'start-monthly' then 5000
  when 'pro-monthly' then 10000
  when 'premium-monthly' then 20000
  else m.expected_amount_aoa
end,
updated_at = now()
from public.subscription_plans p
where p.id = m.plan_id
  and p.code in ('start-monthly','pro-monthly','premium-monthly');

do $$
begin
  if (select count(*) from public.subscription_plans where code in ('start-monthly','pro-monthly','premium-monthly') and price_aoa in (5000,10000,20000)) <> 3 then
    raise exception 'Plan price catalog update validation failed';
  end if;
  if (select count(*) from public.kursinha_product_mappings m join public.subscription_plans p on p.id=m.plan_id where p.code in ('start-monthly','pro-monthly','premium-monthly') and m.expected_amount_aoa=p.price_aoa and m.is_active) <> 3 then
    raise exception 'Kursinha product mapping validation failed';
  end if;
end $$;
commit;
