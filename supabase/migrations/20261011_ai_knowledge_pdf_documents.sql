-- PDF knowledge uploads for each AI agent.
-- Private bucket; extracted text is chunked into ai_knowledge for the existing retrieval pipeline.
create table if not exists public.ai_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  extracted_chars integer not null default 0 check (extracted_chars >= 0),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_knowledge
  add column if not exists source_document_id uuid
  references public.ai_knowledge_documents(id) on delete cascade;

create index if not exists ai_knowledge_documents_agent_idx
  on public.ai_knowledge_documents (organization_id, agent_id, created_at desc);

create index if not exists ai_knowledge_source_document_idx
  on public.ai_knowledge (source_document_id)
  where source_document_id is not null;

alter table public.ai_knowledge_documents enable row level security;

drop policy if exists ai_knowledge_documents_select_member on public.ai_knowledge_documents;
create policy ai_knowledge_documents_select_member
on public.ai_knowledge_documents for select to authenticated
using (exists (
  select 1 from public.memberships m
  where m.organization_id = ai_knowledge_documents.organization_id
    and m.user_id = auth.uid()
));

drop policy if exists ai_knowledge_documents_insert_admin on public.ai_knowledge_documents;
create policy ai_knowledge_documents_insert_admin
on public.ai_knowledge_documents for insert to authenticated
with check (exists (
  select 1 from public.memberships m
  where m.organization_id = ai_knowledge_documents.organization_id
    and m.user_id = auth.uid()
    and m.role in ('OWNER', 'ADMIN')
));

drop policy if exists ai_knowledge_documents_delete_admin on public.ai_knowledge_documents;
create policy ai_knowledge_documents_delete_admin
on public.ai_knowledge_documents for delete to authenticated
using (exists (
  select 1 from public.memberships m
  where m.organization_id = ai_knowledge_documents.organization_id
    and m.user_id = auth.uid()
    and m.role in ('OWNER', 'ADMIN')
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-knowledge-pdfs', 'ai-knowledge-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

drop policy if exists ai_knowledge_pdfs_read_member on storage.objects;
create policy ai_knowledge_pdfs_read_member
on storage.objects for select to authenticated
using (
  bucket_id = 'ai-knowledge-pdfs'
  and exists (
    select 1 from public.memberships m
    where m.organization_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
  )
);

drop policy if exists ai_knowledge_pdfs_insert_admin on storage.objects;
create policy ai_knowledge_pdfs_insert_admin
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ai-knowledge-pdfs'
  and exists (
    select 1 from public.memberships m
    where m.organization_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
      and m.role in ('OWNER', 'ADMIN')
  )
);

drop policy if exists ai_knowledge_pdfs_delete_admin on storage.objects;
create policy ai_knowledge_pdfs_delete_admin
on storage.objects for delete to authenticated
using (
  bucket_id = 'ai-knowledge-pdfs'
  and exists (
    select 1 from public.memberships m
    where m.organization_id::text = (storage.foldername(name))[1]
      and m.user_id = auth.uid()
      and m.role in ('OWNER', 'ADMIN')
  )
);

grant select, insert, delete on public.ai_knowledge_documents to authenticated;
grant all on public.ai_knowledge_documents to service_role;
