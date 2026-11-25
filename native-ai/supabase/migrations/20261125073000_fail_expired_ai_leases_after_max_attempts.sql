-- Mark expired leases that exhausted their retry budget as terminal failures.
-- Without this cleanup, a worker crash on the final attempt leaves a job in
-- processing forever because claim_ai_generation_job only reclaims attempts
-- below max_attempts.
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
    select id
    from public.ai_generation_jobs
    where (
      (status='queued' and available_at<=now())
      or (status='processing' and lease_expires_at<now() and attempt_count<max_attempts)
    )
    order by available_at,created_at
    for update skip locked
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
