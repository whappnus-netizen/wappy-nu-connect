revoke all on function public.ai_agent_context(uuid, uuid, uuid) from public, anon;
grant execute on function public.ai_agent_context(uuid, uuid, uuid) to authenticated, service_role;