-- Harden the six application-owned SECURITY DEFINER functions flagged by Supabase.
-- Their bodies use schema-qualified relations and auth helpers, so an empty search_path is safe.
ALTER FUNCTION public.create_organization(text, text) SET search_path = '';
ALTER FUNCTION public.ensure_ai_agent(uuid) SET search_path = '';
ALTER FUNCTION public.ensure_my_profile() SET search_path = '';
ALTER FUNCTION public.ensure_profile(uuid) SET search_path = '';
ALTER FUNCTION public.has_org_role(uuid, public.app_role[]) SET search_path = '';
ALTER FUNCTION public.is_member(uuid) SET search_path = '';

-- Remove implicit/public and anonymous invocation. Preserve authenticated execution
-- because create/profile operations and RLS helper functions intentionally need it.
REVOKE EXECUTE ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_ai_agent(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_profile(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, public.app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_member(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_ai_agent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO authenticated;
