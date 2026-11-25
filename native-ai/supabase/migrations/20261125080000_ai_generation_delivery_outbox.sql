-- Durable delivery outbox for AI generations that outlive the synchronous webhook wait.
alter table public.ai_generation_jobs
  add column if not exists delivery_status text not null default 'not_required',
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_available_at timestamptz not null default now(),
  add column if not exists delivery_locked_at timestamptz,
  add column if not exists delivery_lease_expires_at timestamptz,
  add column if not exists delivery_locked_by text,
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

do $$ begin
  alter table public.ai_generation_jobs
    add constraint ai_generation_jobs_delivery_status_check
    check (delivery_status in ('not_required','queued','processing','sent','skipped','failed'));
exception when duplicate_object then null; end $$;

alter table public.messages
  add column if not exists ai_generation_job_id uuid;

create unique index if not exists messages_ai_generation_job_id_unique
  on public.messages(ai_generation_job_id)
  where ai_generation_job_id is not null;

create index if not exists ai_generation_jobs_delivery_claim_idx
  on public.ai_generation_jobs(delivery_status,delivery_available_at,completed_at)
  where delivery_status in ('queued','processing');

create or replace function public.claim_ai_generation_delivery(
  _worker_id text,
  _lease_seconds integer default 60
)
returns setof public.ai_generation_jobs
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.ai_generation_jobs
  set delivery_status='failed',
      delivery_error='delivery_lease_expired_max_attempts',
      delivery_locked_at=null,
      delivery_lease_expires_at=null,
      delivery_locked_by=null
  where status='succeeded'
    and delivery_status='processing'
    and delivery_lease_expires_at < now()
    and delivery_attempts >= 5;

  return query
  with candidate as (
    select id
    from public.ai_generation_jobs
    where status='succeeded'
      and (
        (delivery_status='queued' and delivery_available_at<=now())
        or (delivery_status='processing' and delivery_lease_expires_at<now() and delivery_attempts<5)
      )
    order by delivery_available_at,completed_at
    for update skip locked
    limit 1
  )
  update public.ai_generation_jobs j
  set delivery_status='processing',
      delivery_attempts=j.delivery_attempts+1,
      delivery_locked_at=now(),
      delivery_lease_expires_at=now()+make_interval(secs=>greatest(15,least(_lease_seconds,300))),
      delivery_locked_by=_worker_id
  from candidate
  where j.id=candidate.id
  returning j.*;
end;
$$;

create or replace function public.finish_ai_generation_delivery(
  _job_id uuid,
  _worker_id text,
  _status text,
  _error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare changed integer;
begin
  if _status not in ('queued','sent','skipped','failed') then
    raise exception 'invalid delivery status';
  end if;

  update public.ai_generation_jobs
  set delivery_status=case
        when _status='queued' and delivery_attempts<5 then 'queued'
        when _status='queued' then 'failed'
        else _status
      end,
      delivery_available_at=case
        when _status='queued' and delivery_attempts<5
          then now()+make_interval(secs=>least(60,2^least(delivery_attempts,5)))
        else delivery_available_at
      end,
      delivery_error=case when _status in ('queued','failed') then left(coalesce(_error_code,'delivery_failed'),180) else null end,
      delivery_locked_at=null,
      delivery_lease_expires_at=null,
      delivery_locked_by=null,
      delivered_at=case when _status in ('sent','skipped') then now() else delivered_at end
  where id=_job_id
    and status='succeeded'
    and delivery_status='processing'
    and delivery_locked_by=_worker_id;

  get diagnostics changed=row_count;
  return changed=1;
end;
$$;

revoke all on function public.claim_ai_generation_delivery(text,integer) from public,anon,authenticated;
revoke all on function public.finish_ai_generation_delivery(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_ai_generation_delivery(text,integer) to service_role;
grant execute on function public.finish_ai_generation_delivery(uuid,text,text,text) to service_role;
