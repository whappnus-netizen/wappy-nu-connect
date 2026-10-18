-- Reject malformed WhatsApp numbers when a non-empty phone is first added or changed.
-- Existing unrelated metadata updates on legacy accounts remain allowed.
create or replace function private.sync_account_phone_registry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_raw text;
  v_new text;
  v_old text;
begin
  v_raw := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');
  v_new := private.normalize_e164_phone(v_raw);

  if tg_op = 'UPDATE' then
    v_old := private.normalize_e164_phone(old.raw_user_meta_data ->> 'phone');
    if v_new is not distinct from v_old then
      return new;
    end if;
    delete from private.account_phone_registry where user_id = old.id;
  end if;

  if v_raw is not null and v_new is null then
    raise exception using errcode = '22023', message = 'CONTACT_PHONE_INVALID';
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
