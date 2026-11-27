-- These SECURITY DEFINER functions are trigger-only, not client-callable RPCs.
-- Trigger execution remains attached to the owning trigger; direct API execution is revoked.
alter function public.notify_kursinha_sale_activation() set search_path = '';
alter function public.touch_support_ticket_from_message() set search_path = '';

revoke execute on function public.notify_kursinha_sale_activation()
  from public, anon, authenticated, service_role;
revoke execute on function public.touch_support_ticket_from_message()
  from public, anon, authenticated, service_role;
