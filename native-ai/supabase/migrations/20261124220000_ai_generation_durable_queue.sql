-- Durable, tenant-scoped AI generation queue with webhook idempotency.
create table if not exists public.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  whatsapp_number_id uuid not null references public.whatsapp_numbers(id) on delete cascade,
  conversation_id uuid null references public.conversations(id) on delete set null,
  message_id text null,
  request_payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','succeeded','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz null,
  lease_expires_at timestamptz null,
  locked_by text null,
  result_payload jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);
create index if not exists ai_generation_jobs_claim_idx on public.ai_generation_jobs(status,available_at,created_at);
create index if not exists ai_generation_jobs_lease_idx on public.ai_generation_jobs(status,lease_expires_at) where status='processing';
alter table public.ai_generation_jobs enable row level security;
revoke all on public.ai_generation_jobs from anon,authenticated;
grant select,insert,update on public.ai_generation_jobs to service_role;

create or replace function public.claim_ai_generation_job(_worker_id text,_lease_seconds integer default 90)
returns setof public.ai_generation_jobs language sql security definer set search_path=public as $$
 with candidate as (
  select id from public.ai_generation_jobs
  where ((status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<now() and attempt_count<max_attempts))
  order by available_at,created_at for update skip locked limit 1
 )
 update public.ai_generation_jobs j
 set status='processing',attempt_count=j.attempt_count+1,locked_at=now(),
     lease_expires_at=now()+make_interval(secs=>greatest(30,least(_lease_seconds,600))),
     locked_by=_worker_id,updated_at=now()
 from candidate where j.id=candidate.id returning j.*;
$$;

create or replace function public.finish_ai_generation_job(_job_id uuid,_worker_id text,_status text,_result jsonb default null,_error_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 if _status not in ('queued','succeeded','failed') then raise exception 'invalid job status'; end if;
 update public.ai_generation_jobs
 set status=case when _status='queued' and attempt_count<max_attempts then 'queued' when _status='queued' then 'failed' else _status end,
     available_at=case when _status='queued' and attempt_count<max_attempts then now()+make_interval(secs=>case when coalesce(_error_code,'') like '%CIRCUIT_OPEN%' then 30 else least(30,2^least(attempt_count,4)) end) else available_at end,
     result_payload=case when _status='succeeded' then _result else null end,
     error_code=case when _status in ('failed','queued') then left(coalesce(_error_code,'generation_failed'),120) else null end,
     locked_at=null,lease_expires_at=null,locked_by=null,updated_at=now(),
     completed_at=case when _status='succeeded' or _status='failed' or (_status='queued' and attempt_count>=max_attempts) then now() else null end
 where id=_job_id and status='processing' and locked_by=_worker_id;
 get diagnostics changed=row_count;
 return changed=1;
end;
$$;
revoke all on function public.claim_ai_generation_job(text,integer) from public,anon,authenticated;
revoke all on function public.finish_ai_generation_job(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_ai_generation_job(text,integer) to service_role;
grant execute on function public.finish_ai_generation_job(uuid,text,text,jsonb,text) to service_role;
