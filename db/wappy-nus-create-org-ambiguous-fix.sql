-- =====================================================================
-- WAPPY NUS — FIX 42702: column reference "organization_id" is ambiguous
-- Supabase externo: icqkoafhitudaqylnnfd
-- Causa: `returns table (organization_id uuid, ...)` cria variáveis OUT
--        com o mesmo nome de colunas usadas dentro da função
--        (insert into memberships / on conflict (organization_id)).
-- Correção: função devolve JSON (sem nomes colidentes) + qualificação
--        explícita de todas as colunas. Idempotente. Nada é apagado.
-- =====================================================================

begin;

drop function if exists public.create_organization(text, text);

create function public.create_organization(_name text, _slug text default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(_name);
  v_base text;
  v_candidate text;
  v_n integer := 0;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória.';
  end if;

  if v_name is null or length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'O nome da organização deve ter entre 2 e 120 caracteres.';
  end if;

  -- Garante o profile (auto-reparação, sem dados falsos)
  perform public.ensure_profile(v_uid);

  perform pg_advisory_xact_lock(hashtext('public.create_organization.slug'));

  v_base := btrim(
    regexp_replace(lower(coalesce(nullif(btrim(_slug), ''), v_name)), '[^a-z0-9]+', '-', 'g'),
    '-'
  );
  if v_base is null or v_base = '' then v_base := 'org'; end if;
  v_base := left(v_base, 40);
  v_candidate := v_base;

  while exists (select 1 from public.organizations o where o.slug = v_candidate) loop
    v_n := v_n + 1;
    v_candidate := left(v_base, greatest(1, 40 - length(v_n::text) - 1)) || '-' || v_n::text;
  end loop;

  insert into public.organizations (name, slug, created_by)
  values (v_name, v_candidate, v_uid)
  returning organizations.id into v_org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_uid, 'OWNER'::public.app_role)
  on conflict do nothing;

  insert into public.pipeline_stages (organization_id, name, position)
  values (v_org_id, 'Novo lead', 1), (v_org_id, 'Em conversa', 2), (v_org_id, 'Proposta', 3),
         (v_org_id, 'Ganho', 4), (v_org_id, 'Perdido', 5)
  on conflict do nothing;

  begin
    insert into public.ai_settings (organization_id) values (v_org_id);
  exception when unique_violation then
    null;
  end;

  return json_build_object(
    'organization_id', v_org_id,
    'organization_name', v_name,
    'organization_slug', v_candidate,
    'membership_role', 'OWNER'
  );
end $$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

commit;
