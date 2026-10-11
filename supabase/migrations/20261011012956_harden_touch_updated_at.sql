alter function public.touch_updated_at() set search_path = public, pg_temp;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
