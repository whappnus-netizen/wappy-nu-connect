-- WhappNus: authoritative plan limits and Group Commander AI training settings.
-- Safe to run more than once; current live schema already has the Group Commander base tables.

create table if not exists public.superadmin_group_ai_settings (
  id smallint primary key default 1 check (id = 1),
  system_prompt text not null default '',
  public_group_rules text not null default 'A IA não responde a mensagens comuns do grupo nem faz anúncios por conta própria. Só executa etapas explicitamente aprovadas no funil.',
  private_dm_rules text not null default 'Mensagens privadas de clientes não devem ser tratadas como mensagens do grupo; encaminhar para o fluxo privado da organização quando esse fluxo estiver configurado.',
  is_active boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.superadmin_group_ai_settings enable row level security;
revoke all on public.superadmin_group_ai_settings from anon, authenticated;
insert into public.superadmin_group_ai_settings (id, system_prompt, public_group_rules, private_dm_rules, is_active)
values (1, '', 'A IA não responde a mensagens comuns do grupo nem faz anúncios por conta própria. Só executa etapas explicitamente aprovadas no funil.', 'Mensagens privadas de clientes não devem ser tratadas como mensagens do grupo; encaminhar para o fluxo privado da organização quando esse fluxo estiver configurado.', false)
on conflict (id) do nothing;

alter table public.superadmin_group_flow_steps
  drop constraint if exists superadmin_group_flow_steps_action_type_check;
alter table public.superadmin_group_flow_steps
  add constraint superadmin_group_flow_steps_action_type_check
  check (action_type = any (array['text'::text, 'ai_text'::text, 'image'::text, 'audio'::text, 'video'::text, 'document'::text]));

create or replace function public.enforce_org_plan_resource_limits()
returns trigger
language plpgsql
as $$
declare
  v_org_id uuid;
  v_org_status text;
  v_limit_key text;
  v_feature_key text;
  v_limit integer;
  v_used integer;
  v_feature_enabled boolean := true;
begin
  v_org_id := new.organization_id;
  perform pg_advisory_xact_lock(hashtext(v_org_id::text)::bigint);

  case tg_table_name
    when 'whatsapp_numbers' then v_limit_key := 'whatsapp_numbers'; v_feature_key := 'integrations';
    when 'ai_agents' then v_limit_key := 'agents'; v_feature_key := 'ai';
    when 'automation_rules' then v_limit_key := 'automations'; v_feature_key := 'automations';
    when 'memberships' then v_limit_key := 'team_members'; v_feature_key := null;
    else return new;
  end case;

  select status into v_org_status from public.organizations where id = v_org_id;
  select
    coalesce(nullif(p.limits ->> v_limit_key, '')::integer, 0),
    case when v_feature_key is null then true else coalesce((p.features ->> v_feature_key)::boolean, false) end
  into v_limit, v_feature_enabled
  from public.organization_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.organization_id = v_org_id
    and s.status in ('active', 'trialing')
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.created_at desc
  limit 1;

  if v_limit is null then
    if v_org_status = 'setup' then return new; end if;
    raise exception 'SUBSCRIPTION_REQUIRED: organization has no active plan' using errcode = 'P0001';
  end if;
  if not v_feature_enabled then
    raise exception 'PLAN_FEATURE_DISABLED: % is not included in the current plan', v_feature_key using errcode = 'P0001';
  end if;

  if tg_table_name = 'whatsapp_numbers' then
    select count(*) into v_used from public.whatsapp_numbers where organization_id = v_org_id and deleted_at is null;
  elsif tg_table_name = 'ai_agents' then
    select count(*) into v_used from public.ai_agents where organization_id = v_org_id;
  elsif tg_table_name = 'automation_rules' then
    select count(*) into v_used from public.automation_rules where organization_id = v_org_id;
  elsif tg_table_name = 'memberships' then
    select count(*) into v_used from public.memberships where organization_id = v_org_id;
  end if;

  if v_limit > 0 and v_used >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED: % limit is %; currently used %', v_limit_key, v_limit, v_used using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_whatsapp_plan_limit on public.whatsapp_numbers;
create trigger enforce_whatsapp_plan_limit before insert on public.whatsapp_numbers
for each row execute function public.enforce_org_plan_resource_limits();

drop trigger if exists enforce_ai_agents_plan_limit on public.ai_agents;
create trigger enforce_ai_agents_plan_limit before insert on public.ai_agents
for each row execute function public.enforce_org_plan_resource_limits();

drop trigger if exists enforce_automation_plan_limit on public.automation_rules;
create trigger enforce_automation_plan_limit before insert on public.automation_rules
for each row execute function public.enforce_org_plan_resource_limits();

-- Membership creation is intentionally not guarded here: create_organization inserts OWNER before trial subscription creation.
-- Team-member cap is enforced by the invitation flow after subscription is available.
