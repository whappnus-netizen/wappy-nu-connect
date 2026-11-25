-- Serialize generation per conversation while allowing independent conversations
-- to run concurrently across multiple Native AI worker instances.
-- Preserve the retry-budget cleanup from the previously deployed queue function.
create index if not exists ai_generation_jobs_conversation_order_idx
  on public.ai_generation_jobs(organization_id, whatsapp_number_id, conversation_id, created_at, id)
  where conversation_id is not null;

create or replace function public.claim_ai_generation_job(
  _worker_id text,
  _lease_seconds integer default 90
)
returns setof public.ai_generation_jobs
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.ai_generation_jobs
  set status='failed',
      error_code='lease_expired_max_attempts',
      locked_at=null,
      lease_expires_at=null,
      locked_by=null,
      completed_at=now(),
      updated_at=now()
  where status='processing'
    and lease_expires_at < now()
    and attempt_count >= max_attempts;

  return query
  with candidate as (
    select j.id
    from public.ai_generation_jobs j
    where (
      (j.status='queued' and j.available_at<=now())
      or (j.status='processing' and j.lease_expires_at<now() and j.attempt_count<j.max_attempts)
    )
    and (
      j.conversation_id is null
      or not exists (
        select 1
        from public.ai_generation_jobs prior
        where prior.organization_id=j.organization_id
          and prior.whatsapp_number_id=j.whatsapp_number_id
          and prior.conversation_id=j.conversation_id
          and prior.status in ('queued','processing')
          and (prior.created_at,prior.id)<(j.created_at,j.id)
      )
    )
    order by j.available_at,j.created_at,j.id
    for update of j skip locked
    limit 1
  )
  update public.ai_generation_jobs j
  set status='processing',
      attempt_count=j.attempt_count+1,
      locked_at=now(),
      lease_expires_at=now()+make_interval(secs=>greatest(30,least(_lease_seconds,600))),
      locked_by=_worker_id,
      updated_at=now()
  from candidate
  where j.id=candidate.id
  returning j.*;
end;
$$;

revoke all on function public.claim_ai_generation_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_ai_generation_job(text,integer) to service_role;
