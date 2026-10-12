-- WhappNus: harden Kursinha activation RPC.
-- Applied to Supabase production on 2026-10-12.
-- The signed Kursinha webhook Edge Function is the intended caller.
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_kursinha_approved_sale(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_kursinha_approved_sale(text) TO service_role;

-- Payment/sale/mapping/webhook-event tables are server-only. RLS stays enabled
-- without anon/authenticated policies (deny-by-default), while service_role
-- performs verified webhook processing.
