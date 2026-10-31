create or replace function public.save_booking_schedule_v1(p_organization_id uuid,p_days jsonb)
returns integer
language plpgsql security definer set search_path=''
as $schedule$
declare v_count integer;
begin
 if p_organization_id is null or pg_catalog.jsonb_typeof(p_days)<>'array'
   or pg_catalog.jsonb_array_length(p_days)<>7 then
  raise exception 'BOOKING_SCHEDULE_REQUIRES_SEVEN_DAYS' using errcode='22023';
 end if;
 if (select count(distinct x.weekday) from pg_catalog.jsonb_to_recordset(p_days) as x(weekday integer,enabled boolean,starts_at time,ends_at time))<>7 then
  raise exception 'BOOKING_SCHEDULE_DUPLICATE_WEEKDAY' using errcode='22023';
 end if;
 if exists(select 1 from pg_catalog.jsonb_to_recordset(p_days) as x(weekday integer,enabled boolean,starts_at time,ends_at time)
   where x.enabled and (x.starts_at is null or x.ends_at is null or x.ends_at<=x.starts_at)) then
  raise exception 'BOOKING_SCHEDULE_INVALID_RANGE' using errcode='22023';
 end if;
 delete from public.booking_availability_rules where organization_id=p_organization_id and scope_type='organization';
 insert into public.booking_availability_rules(organization_id,scope_type,scope_id,weekday,starts_at,ends_at,is_available)
 select p_organization_id,'organization',null,x.weekday,x.starts_at,x.ends_at,true
 from pg_catalog.jsonb_to_recordset(p_days) as x(weekday integer,enabled boolean,starts_at time,ends_at time)
 where x.enabled;
 get diagnostics v_count=row_count;
 return v_count;
end;
$schedule$;
revoke all on function public.save_booking_schedule_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_booking_schedule_v1(uuid,jsonb) to service_role;
