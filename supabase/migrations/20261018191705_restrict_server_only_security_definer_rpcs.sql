-- Server-only SECURITY DEFINER RPCs are called by trusted Edge Functions with service_role.
revoke execute on function public.ai_agent_context(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_agent_context(uuid, uuid, uuid) to service_role;

revoke execute on function public.apply_kursinha_approved_sale(text) from public, anon, authenticated;
grant execute on function public.apply_kursinha_approved_sale(text) to service_role;

revoke execute on function public.request_affiliate_payout(uuid) from public, anon, authenticated;
grant execute on function public.request_affiliate_payout(uuid) to service_role;

revoke execute on function public.review_affiliate_payout(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_affiliate_payout(uuid, uuid, text, text, text, text) to service_role;
