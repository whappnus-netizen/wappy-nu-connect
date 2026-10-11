
create or replace function public.ai_agent_context(
  _organization_id uuid,
  _whatsapp_number_id uuid default null,
  _agent_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_agent public.ai_agents;
  v_result json;
  v_assigned_agent_id uuid;
  v_assignment_exists boolean := false;
begin
  if auth.uid() is not null and not public.is_member(_organization_id) then
    raise exception 'Sem permissão nesta organização.' using errcode = '42501';
  end if;

  if auth.uid() is null and current_setting('request.jwt.claim.role', true) = 'anon' then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  if _agent_id is not null then
    select a.* into v_agent
    from public.ai_agents a
    where a.organization_id = _organization_id and a.id = _agent_id;
  elsif _whatsapp_number_id is not null then
    if not exists (
      select 1 from public.whatsapp_numbers n
      where n.id = _whatsapp_number_id and n.organization_id = _organization_id
        and n.deleted_at is null
    ) then
      raise exception 'Número WhatsApp inválido para esta organização.' using errcode = '42501';
    end if;

    select m.agent_id into v_assigned_agent_id
    from public.ai_agent_whatsapp_numbers m
    where m.organization_id = _organization_id
      and m.whatsapp_number_id = _whatsapp_number_id
    limit 1;
    v_assignment_exists := found;

    if v_assignment_exists then
      select a.* into v_agent
      from public.ai_agents a
      where a.organization_id = _organization_id
        and a.id = v_assigned_agent_id
        and a.is_active = true;
    else
      select a.* into v_agent
      from public.ai_agents a
      where a.organization_id = _organization_id and a.is_active = true
      order by a.created_at asc
      limit 1;
    end if;
  else
    select a.* into v_agent
    from public.ai_agents a
    where a.organization_id = _organization_id
    order by a.created_at asc
    limit 1;
  end if;

  if v_agent.id is null then
    return json_build_object('agent', null, 'knowledge', '[]'::json, 'examples', '[]'::json);
  end if;

  select json_build_object(
    'agent', to_jsonb(v_agent) - 'config',
    'knowledge', coalesce((
      select json_agg(json_build_object('title', k.title, 'category', k.category, 'content', k.content)
                      order by k.category, k.created_at)
      from public.ai_knowledge k
      where k.organization_id = _organization_id and k.is_active
        and (k.agent_id = v_agent.id or k.agent_id is null)
    ), '[]'::json),
    'examples', coalesce((
      select json_agg(json_build_object('input', e.input, 'output', e.expected_output, 'type', e.example_type)
                      order by e.created_at)
      from public.ai_training_examples e
      where e.organization_id = _organization_id and e.is_active
        and (e.agent_id = v_agent.id or e.agent_id is null)
    ), '[]'::json)
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.ai_agent_context(uuid, uuid, uuid) from public, anon;
grant execute on function public.ai_agent_context(uuid, uuid, uuid) to authenticated, service_role;
