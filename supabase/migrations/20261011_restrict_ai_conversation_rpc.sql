-- Keep AI conversation accounting callable only by the trusted AI engine service role.
revoke all on function public.consume_ai_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_ai_conversation(uuid,uuid) to service_role;
