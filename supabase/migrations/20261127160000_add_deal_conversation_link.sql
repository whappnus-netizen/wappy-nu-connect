-- Link each CRM opportunity to the WhatsApp conversation that originated it.
-- Existing deals remain valid with conversation_id NULL; no customer records are rewritten.
alter table public.deals
  add column if not exists conversation_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deals_conversation_same_org'
      and conrelid = 'public.deals'::regclass
  ) then
    alter table public.deals
      add constraint deals_conversation_same_org
      foreign key (conversation_id, organization_id)
      references public.conversations (id, organization_id);
  end if;
end
$$;

create index if not exists deals_org_conversation_idx
  on public.deals (organization_id, conversation_id)
  where conversation_id is not null;
