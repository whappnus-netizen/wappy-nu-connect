-- Additional guardrails for booking creation and rescheduling.
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
 select * into v_service from public.booking_services
 where id=p_service_id and organization_id=p_organization_id and is_active;
 if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;
 v_ends_at:=p_starts_at+pg_catalog.make_interval(mins=>v_service.duration_minutes);
 select coalesce(timezone,'Africa/Luanda') into v_timezone from public.organizations where id=p_organization_id;
 if v_timezone is null then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
 v_local_start:=p_starts_at at time zone v_timezone;
 v_local_end:=v_ends_at at time zone v_timezone;
 v_weekday:=extract(dow from v_local_start)::integer;
 if not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id
   and r.scope_type='organization' and r.scope_id is null and r.weekday=v_weekday and r.is_available
   and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
   raise exception 'BOOKING_OUTSIDE_BUSINESS_HOURS' using errcode='22023';
 end if;
 if p_staff_id is not null then
  if not exists(select 1 from public.booking_service_staff ss join public.booking_staff st on st.id=ss.staff_id and st.organization_id=ss.organization_id
   where ss.organization_id=p_organization_id and ss.service_id=p_service_id and ss.staff_id=p_staff_id and st.is_active) then
   raise exception 'BOOKING_STAFF_NOT_ELIGIBLE' using errcode='23503';
  end if;
  if exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=p_staff_id and r.weekday=v_weekday)
   and not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='staff' and r.scope_id=p_staff_id and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
   raise exception 'BOOKING_OUTSIDE_STAFF_HOURS' using errcode='22023';
  end if;
 end if;
 if p_resource_id is not null then
  if not exists(select 1 from public.booking_service_resources sr join public.booking_resources r on r.id=sr.resource_id and r.organization_id=sr.organization_id
   where sr.organization_id=p_organization_id and sr.service_id=p_service_id and sr.resource_id=p_resource_id and r.is_active) then
   raise exception 'BOOKING_RESOURCE_NOT_ELIGIBLE' using errcode='23503';
  end if;
  if exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='resource' and r.scope_id=p_resource_id and r.weekday=v_weekday)
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

create or replace function public.create_booking_v2(
 p_organization_id uuid,p_contact_id uuid,p_conversation_id uuid,p_service_id uuid,p_staff_id uuid,p_resource_id uuid,
 p_starts_at timestamptz,p_source text,p_customer_notes text default null,p_idempotency_key text default null,p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $create$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
 perform public.validate_booking_slot_v1(p_organization_id,p_service_id,p_starts_at,p_staff_id,p_resource_id,null);
 return public.create_booking_v1(p_organization_id,p_contact_id,p_conversation_id,p_service_id,p_staff_id,p_resource_id,
   p_starts_at,p_source,p_customer_notes,p_idempotency_key,p_actor_user_id);
end;
$create$;

create or replace function public.reschedule_booking_v1(
 p_organization_id uuid,p_booking_id uuid,p_starts_at timestamptz,p_staff_id uuid,p_resource_id uuid,
 p_actor_type text,p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $reschedule$
declare
 v_booking public.bookings%rowtype;
 v_service public.booking_services%rowtype;
 v_settings public.booking_settings%rowtype;
 v_ends_at timestamptz;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
 select * into v_booking from public.bookings where id=p_booking_id and organization_id=p_organization_id for update;
 if not found then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
 if v_booking.status not in ('confirmed','pending_confirmation') then raise exception 'BOOKING_CANNOT_BE_RESCHEDULED' using errcode='22023'; end if;
 if p_actor_type not in ('ai','staff','dashboard','system','customer') then raise exception 'INVALID_BOOKING_ACTOR' using errcode='22023'; end if;
 select * into v_service from public.booking_services where id=v_booking.service_id and organization_id=p_organization_id and is_active;
 if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;
 select * into v_settings from public.booking_settings where organization_id=p_organization_id and enabled;
 if not found then raise exception 'BOOKING_FEATURE_DISABLED' using errcode='42501'; end if;
 if p_starts_at<pg_catalog.now()+pg_catalog.make_interval(mins=>v_settings.min_notice_minutes)
   or p_starts_at>pg_catalog.now()+pg_catalog.make_interval(days=>v_settings.max_days_ahead) then
   raise exception 'BOOKING_OUTSIDE_ALLOWED_WINDOW' using errcode='22023';
 end if;
 perform public.validate_booking_slot_v1(p_organization_id,v_booking.service_id,p_starts_at,p_staff_id,p_resource_id,p_booking_id);
 v_ends_at:=p_starts_at+pg_catalog.make_interval(mins=>v_service.duration_minutes);
 if p_staff_id is not null and exists(select 1 from public.bookings b join public.booking_services prior_service on prior_service.id=b.service_id and prior_service.organization_id=b.organization_id where b.organization_id=p_organization_id and b.staff_id=p_staff_id and b.id<>p_booking_id
  and b.status in ('pending_confirmation','confirmed','in_progress') and tstzrange(b.starts_at-prior_service.buffer_before_minutes*interval '1 minute',b.ends_at+prior_service.buffer_after_minutes*interval '1 minute','[)') && tstzrange(p_starts_at-v_service.buffer_before_minutes*interval '1 minute',v_ends_at+v_service.buffer_after_minutes*interval '1 minute','[)')) then
  raise exception 'BOOKING_STAFF_SLOT_TAKEN' using errcode='23P01';
 end if;
 if p_resource_id is not null and exists(select 1 from public.bookings b where b.organization_id=p_organization_id and b.resource_id=p_resource_id and b.id<>p_booking_id
  and b.status in ('pending_confirmation','confirmed','in_progress') and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_ends_at,'[)')) then
  raise exception 'BOOKING_RESOURCE_SLOT_TAKEN' using errcode='23P01';
 end if;
 if (select count(*) from public.bookings b where b.organization_id=p_organization_id and b.service_id=v_booking.service_id
   and b.id<>p_booking_id and b.status in ('pending_confirmation','confirmed','in_progress')
   and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_ends_at,'[)')) >= v_service.capacity then
  raise exception 'BOOKING_SERVICE_CAPACITY_REACHED' using errcode='23P01';
 end if;
 update public.bookings set starts_at=p_starts_at,ends_at=v_ends_at,staff_id=p_staff_id,resource_id=p_resource_id,updated_at=pg_catalog.now()
 where id=p_booking_id and organization_id=p_organization_id returning * into v_booking;
 insert into public.booking_events(organization_id,booking_id,event_type,actor_type,actor_user_id,details)
 values(p_organization_id,p_booking_id,'rescheduled',p_actor_type,p_actor_user_id,pg_catalog.jsonb_build_object('starts_at',p_starts_at,'ends_at',v_ends_at));
 return pg_catalog.jsonb_build_object('booking',pg_catalog.to_jsonb(v_booking));
end;
$reschedule$;

revoke all on function public.validate_booking_slot_v1(uuid,uuid,timestamptz,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_booking_v2(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.reschedule_booking_v1(uuid,uuid,timestamptz,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.validate_booking_slot_v1(uuid,uuid,timestamptz,uuid,uuid,uuid) to service_role;
grant execute on function public.create_booking_v2(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) to service_role;
grant execute on function public.reschedule_booking_v1(uuid,uuid,timestamptz,uuid,uuid,text,uuid) to service_role;
