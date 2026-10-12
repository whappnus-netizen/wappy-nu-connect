-- WhappNus: harden Kursinha activation RPC.
-- Apply only after reviewing the production function's callers.
-- The Kursinha Edge Function is the intended caller; client-side roles must not
-- be able to activate a sale by invoking this RPC directly.
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_kursinha_approved_sale(text) TO service_role;

-- Payment/sale/mapping/webhook tables are server-only. Keep RLS enabled and
-- deliberately do not add anon/authenticated policies (deny-by-default).
