create or replace function public.reject_superadmin_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.superadmin_users su
    where su.user_id = new.user_id
      and su.is_active = true
  ) then
    raise exception using
      errcode = '42501',
      message = 'Esta conta está reservada ao painel Super Admin e não pode pertencer a uma organização.';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_superadmin_membership() from public, anon, authenticated;

drop trigger if exists memberships_reject_superadmin on public.memberships;
create trigger memberships_reject_superadmin
before insert or update of user_id on public.memberships
for each row
execute function public.reject_superadmin_membership();
