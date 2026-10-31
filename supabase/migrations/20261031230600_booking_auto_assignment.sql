create or replace function public.create_booking_v2(
 p_organization_id uuid,p_contact_id uuid,p_conversation_id uuid,p_service_id uuid,p_staff_id uuid,p_resource_id uuid,
 p_starts_at timestamptz,p_source text,p_customer_notes text default null,p_idempotency_key text default null,p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $create$
declare
 v_service public.booking_services%rowtype;
 v_timezone text;
 v_ends_at timestamptz;
 v_local_start timestamp;
 v_local_end timestamp;
 v_weekday integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
 perform public.expire_pending_bookings_v1(p_organization_id);
 select * into v_service from public.booking_services where id=p_service_id and organization_id=p_organization_id and is_active;
 if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;
 v_ends_at:=p_starts_at+pg_catalog.make_interval(mins=>v_service.duration_minutes);
 select coalesce(timezone,'Africa/Luanda') into v_timezone from public.organizations where id=p_organization_id;
 v_local_start:=p_starts_at at time zone v_timezone;
 v_local_end:=v_ends_at at time zone v_timezone;
 v_weekday:=extract(dow from v_local_start)::integer;

 if p_staff_id is null and exists(select 1 from public.booking_service_staff where organization_id=p_organization_id and service_id=p_service_id) then
  select ss.staff_id into p_staff_id from public.booking_service_staff ss
  join public.booking_staff st on st.id=ss.staff_id and st.organization_id=ss.organization_id
  where ss.organization_id=p_organization_id and ss.service_id=p_service_id and st.is_active
   and (not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=ss.staff_id)
     or exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=ss.staff_id and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time))
   and not exists(select 1 from public.bookings b join public.booking_services prior_service on prior_service.id=b.service_id and prior_service.organization_id=b.organization_id
     where b.organization_id=p_organization_id and b.staff_id=ss.staff_id
     and b.status in ('pending_confirmation','confirmed','in_progress')
     and tstzrange(b.starts_at-prior_service.buffer_before_minutes*interval '1 minute',b.ends_at+prior_service.buffer_after_minutes*interval '1 minute','[)')
       && tstzrange(p_starts_at-v_service.buffer_before_minutes*interval '1 minute',v_ends_at+v_service.buffer_after_minutes*interval '1 minute','[)'))
  order by (select count(*) from public.bookings b where b.organization_id=p_organization_id and b.staff_id=ss.staff_id
    and b.starts_at::date=v_local_start::date and b.status in ('pending_confirmation','confirmed','in_progress')),ss.staff_id limit 1;
  if p_staff_id is null then raise exception 'BOOKING_NO_STAFF_AVAILABLE' using errcode='23P01'; end if;
 end if;

 if p_resource_id is null and exists(select 1 from public.booking_service_resources where organization_id=p_organization_id and service_id=p_service_id) then
  select sr.resource_id into p_resource_id from public.booking_service_resources sr
  join public.booking_resources r on r.id=sr.resource_id and r.organization_id=sr.organization_id
  where sr.organization_id=p_organization_id and sr.service_id=p_service_id and r.is_active
   and (not exists(select 1 from public.booking_availability_rules ar where ar.organization_id=p_organization_id and ar.scope_type='resource' and ar.scope_id=sr.resource_id)
     or exists(select 1 from public.booking_availability_rules ar where ar.organization_id=p_organization_id and ar.scope_type='resource' and ar.scope_id=sr.resource_id and ar.weekday=v_weekday and ar.is_available and ar.starts_at<=v_local_start::time and ar.ends_at>=v_local_end::time))
   and not exists(select 1 from public.bookings b where b.organization_id=p_organization_id and b.resource_id=sr.resource_id
     and b.status in ('pending_confirmation','confirmed','in_progress') and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_ends_at,'[)'))
  order by sr.resource_id limit 1;
  if p_resource_id is null then raise exception 'BOOKING_NO_RESOURCE_AVAILABLE' using errcode='23P01'; end if;
 end if;

 perform public.validate_booking_slot_v1(p_organization_id,p_service_id,p_starts_at,p_staff_id,p_resource_id,null);
 return public.create_booking_v1(p_organization_id,p_contact_id,p_conversation_id,p_service_id,p_staff_id,p_resource_id,
  p_starts_at,p_source,p_customer_notes,p_idempotency_key,p_actor_user_id);
end;
$create$;
