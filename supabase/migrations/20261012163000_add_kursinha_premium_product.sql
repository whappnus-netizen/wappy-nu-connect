-- WhappNus: register Kursinha Premium monthly product (45,000 AOA).
INSERT INTO public.kursinha_product_mappings
  (product_id, plan_id, expected_amount_aoa, currency, checkout_url, is_active)
VALUES
  ('6acc80e79db7fbd07069b6e0',
   '61a3bbe5-36c6-44e8-804e-08d82f0376f2',
   45000, 'AOA',
   'https://pay.kursinha.com/c/6acc80e79db7fbd07069b6e0',
   true)
ON CONFLICT (product_id) DO UPDATE SET
  plan_id = EXCLUDED.plan_id,
  expected_amount_aoa = EXCLUDED.expected_amount_aoa,
  currency = EXCLUDED.currency,
  checkout_url = EXCLUDED.checkout_url,
  is_active = true,
  updated_at = now();
