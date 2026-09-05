-- =====================================================================
-- WAPPY NUS — FASE 4: IA POR ORGANIZAÇÃO (configuração + conhecimento +
-- exemplos de treinamento)
--
-- Idempotente: pode ser executado mais de uma vez sem perder dados.
-- Reutiliza a tabela existente public.ai_agents (TABELA 1) e cria apenas
-- as duas estruturas que faltavam: ai_knowledge (TABELA 2) e
-- ai_training_examples (TABELA 3).
--
-- Depende de objectos que já existem no projecto:
--   public.organizations, public.ai_agents, public.set_updated_at(),
--   public.is_member(uuid), public.has_org_role(uuid, public.app_role[])
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABELA 1 — CONFIGURAÇÃO DO AGENTE (reutiliza public.ai_agents)
-- ---------------------------------------------------------------------
alter table public.ai_agents add column if not exists goal text;
alter table public.ai_agents add column if not exists company_name text;
alter table public.ai_agents add column if not exists company_description text;
alter table public.ai_agents add column if not exists products_services text;
alter table public.ai_agents add column if not exists business_hours text;
alter table public.ai_agents add column if not exists location text;
alter table public.ai_agents add column if not exists payment_methods text;
alter table public.ai_agents add column if not exists faq text;
alter table public.ai_agents add column if not exists tone text not null default 'profissional e simpático';
alter table public.ai_agents add column if not exists service_rules text;
alter table public.ai_agents add column if not exists can_do text;
alter table public.ai_agents add column if not exists cannot_do text;
alter table public.ai_agents add column if not exists handoff_instructions text;
alter table public.ai_agents add column if not exists greeting_message text;
alter table public.ai_agents add column if not exists extra_instructions text;
alter table public.ai_agents add column if not exists language text not null default 'pt-AO';

create index if not exists idx_ai_agents_org_active on public.ai_agents(organization_id, is_active);

-- ---------------------------------------------------------------------
-- TABELA 2 — CONHECIMENTO DA IA
-- ---------------------------------------------------------------------
create table if not exists public.ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid,
  title text not null,
  content text not null,
  category text not null default 'geral'
    check (category in ('geral','produtos','servicos','precos','faq','politicas','horarios','empresa','entrega','pagamentos')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint ai_knowledge_agent_same_org
    foreign key (agent_id, organization_id)
    references public.ai_agents(id, organization_id) on delete cascade
);

create index if not exists idx_ai_knowledge_org on public.ai_knowledge(organization_id, is_active);
create index if not exists idx_ai_knowledge_agent on public.ai_knowledge(agent_id);
create index if not exists idx_ai_knowledge_category on public.ai_knowledge(organization_id, category);

-- ---------------------------------------------------------------------
-- TABELA 3 — EXEMPLOS / REGRAS DE TREINAMENTO
-- ---------------------------------------------------------------------
create table if not exists public.ai_training_examples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid,
  input text not null,
  expected_output text not null,
  example_type text not null default 'exemplo'
    check (example_type in ('exemplo','regra','proibicao','encaminhamento')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint ai_training_agent_same_org
    foreign key (agent_id, organization_id)
    references public.ai_agents(id, organization_id) on delete cascade
);

create index if not exists idx_ai_training_org on public.ai_training_examples(organization_id, is_active);
create index if not exists idx_ai_training_agent on public.ai_training_examples(agent_id);

-- ---------------------------------------------------------------------
-- TRIGGERS updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ai_knowledge','ai_training_examples'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- GRANTS + RLS (multi-tenant estrito, sem acesso anónimo)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ai_knowledge','ai_training_examples'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated
                    using (public.is_member(organization_id))', t);

    execute format('drop policy if exists "members write %1$s" on public.%1$I', t);
    execute format('create policy "members write %1$s" on public.%1$I for insert to authenticated
                    with check (public.is_member(organization_id))', t);

    execute format('drop policy if exists "members update %1$s" on public.%1$I', t);
    execute format('create policy "members update %1$s" on public.%1$I for update to authenticated
                    using (public.is_member(organization_id))
                    with check (public.is_member(organization_id))', t);

    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format($f$create policy "admins delete %1$s" on public.%1$I for delete to authenticated
                    using (public.has_org_role(organization_id,
                      array['OWNER','ADMIN','SUPERVISOR']::public.app_role[]))$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- FUNÇÃO: garante que a organização tem um agente (usada no onboarding da IA)
-- ---------------------------------------------------------------------
create or replace function public.ensure_ai_agent(_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent_id uuid;
begin
  if not public.is_member(_organization_id) then
    raise exception 'Sem permissão nesta organização.' using errcode = '42501';
  end if;

  select a.id into v_agent_id
  from public.ai_agents a
  where a.organization_id = _organization_id
  order by a.created_at asc
  limit 1;

  if v_agent_id is null then
    insert into public.ai_agents (organization_id, name, purpose, is_active)
    values (_organization_id, 'Assistente Wappy', 'autoreply', false)
    returning id into v_agent_id;
  end if;

  return v_agent_id;
end $$;

revoke all on function public.ensure_ai_agent(uuid) from public, anon;
grant execute on function public.ensure_ai_agent(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- FUNÇÃO: contexto completo da IA de UMA organização (usado pelo servidor
-- do Wappy Nus antes de gerar a resposta do WhatsApp Cloud API)
-- ---------------------------------------------------------------------
create or replace function public.ai_agent_context(_organization_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.ai_agents;
  v_result json;
begin
  select a.* into v_agent
  from public.ai_agents a
  where a.organization_id = _organization_id
  order by a.created_at asc
  limit 1;

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
    ), '[]'::json),
    'examples', coalesce((
      select json_agg(json_build_object('input', e.input, 'output', e.expected_output, 'type', e.example_type)
                      order by e.created_at)
      from public.ai_training_examples e
      where e.organization_id = _organization_id and e.is_active
    ), '[]'::json)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.ai_agent_context(uuid) from public, anon;
grant execute on function public.ai_agent_context(uuid) to service_role;

-- FIM DA MIGRATION — FASE 4 (IA POR ORGANIZAÇÃO)
