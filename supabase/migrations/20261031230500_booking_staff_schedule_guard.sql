create or replace function public.validate_booking_slot_v1(
 p_organization_id uuid,p_service_id uuid,p_starts_at timestamptz,p_staff_id uuid default null,
 p_resource_id uuid default null,p_exclude_booking_id uuid default null
) returns void
language plpgsql security definer set search_path=''
as $validate$
declare
 v_service public.booking_services%rowtype;
 v_timezone text;
 v_ends_at timestamptz;
 v_local_start timestamp;
 v_local_end timestamp;
 v_weekday integer;
begin
 select * into v_service from public.booking_services where id=p_service_id and organization_id=p_organization_id and is_active;
 if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;
 v_ends_at:=p_starts_at+pg_catalog.make_interval(mins=>v_service.duration_minutes);
 select coalesce(timezone,'Africa/Luanda') into v_timezone from public.organizations where id=p_organization_id;
 if v_timezone is null then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
 v_local_start:=p_starts_at at time zone v_timezone;
 v_local_end:=v_ends_at at time zone v_timezone;
 v_weekday:=extract(dow from v_local_start)::integer;
 if not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='organization' and r.scope_id is null and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
  raise exception 'BOOKING_OUTSIDE_BUSINESS_HOURS' using errcode='22023';
 end if;
 if p_staff_id is not null then
  if not exists(select 1 from public.booking_service_staff ss join public.booking_staff st on st.id=ss.staff_id and st.organization_id=ss.organization_id where ss.organization_id=p_organization_id and ss.service_id=p_service_id and ss.staff_id=p_staff_id and st.is_active) then
   raise exception 'BOOKING_STAFF_NOT_ELIGIBLE' using errcode='23503';
  end if;
  if exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=p_staff_id)
   and not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=p_staff_id and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
   raise exception 'BOOKING_OUTSIDE_STAFF_HOURS' using errcode='22023';
  end if;
 end if;
 if p_resource_id is not null then
  if not exists(select 1 from public.booking_service_resources sr join public.booking_resources r on r.id=sr.resource_id and r.organization_id=sr.organization_id where sr.organization_id=p_organization_id and sr.service_id=p_service_id and sr.resource_id=p_resource_id and r.is_active) then
   raise exception 'BOOKING_RESOURCE_NOT_ELIGIBLE' using errcode='23503';
  end if;
  if exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='resource' and r.scope_id=p_resource_id)
   and not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='resource' and r.scope_id=p_resource_id and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
   raise exception 'BOOKING_OUTSIDE_RESOURCE_HOURS' using errcode='22023';
  end if;
 end if;
 if exists(select 1 from public.booking_availability_exceptions e where e.organization_id=p_organization_id and e.exception_type='unavailable'
  and (e.scope_type='organization' or (e.scope_type='staff' and e.scope_id=p_staff_id) or (e.scope_type='resource' and e.scope_id=p_resource_id))
  and e.starts_at<v_ends_at and e.ends_at>p_starts_at) then
  raise exception 'BOOKING_BLOCKED_BY_EXCEPTION' using errcode='22023';
 end if;
end;
$validate$;
