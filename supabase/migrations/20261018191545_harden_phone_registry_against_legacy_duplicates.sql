-- Harden the existing private phone registry against legacy duplicate metadata.
-- The registry and trigger already exist in production; this migration makes the source-of-truth check explicit.
create or replace function private.sync_account_phone_registry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_new text;
  v_old text;
begin
  v_new := private.normalize_e164_phone(new.raw_user_meta_data ->> 'phone');

  if tg_op = 'UPDATE' then
    v_old := private.normalize_e164_phone(old.raw_user_meta_data ->> 'phone');
    -- Do not block unrelated metadata edits on legacy accounts.
    if v_new is not distinct from v_old then
      return new;
    end if;
    delete from private.account_phone_registry where user_id = old.id;
  end if;

  if v_new is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_new, 0));
    if exists (
      select 1
      from auth.users u
      where u.id <> new.id
        and private.normalize_e164_phone(u.raw_user_meta_data ->> 'phone') = v_new
    ) then
      raise exception using errcode = '23505', message = 'ACCOUNT_CONTACT_CONFLICT';
    end if;

    insert into private.account_phone_registry(user_id, phone_e164)
    values (new.id, v_new)
    on conflict (user_id) do update set phone_e164 = excluded.phone_e164;
  end if;

  return new;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'ACCOUNT_CONTACT_CONFLICT';
end;
$$;
