create or replace function public.expire_pending_bookings_v1(p_organization_id uuid)
returns integer
language plpgsql security definer set search_path=''
as $expire$
declare v_count integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
 with expired as (
  update public.bookings set status='expired',updated_at=pg_catalog.now()
  where organization_id=p_organization_id and status='pending_confirmation' and expires_at is not null and expires_at<=pg_catalog.now()
  returning id,organization_id
 )
 insert into public.booking_events(organization_id,booking_id,event_type,actor_type,details)
 select organization_id,id,'expired','system',pg_catalog.jsonb_build_object('reason','approval_window_elapsed') from expired;
 get diagnostics v_count = row_count;
 return v_count;
end;
$expire$;

create or replace function public.create_booking_v2(
 p_organization_id uuid,p_contact_id uuid,p_conversation_id uuid,p_service_id uuid,p_staff_id uuid,p_resource_id uuid,
 p_starts_at timestamptz,p_source text,p_customer_notes text default null,p_idempotency_key text default null,p_actor_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=''
as $create$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
 perform public.expire_pending_bookings_v1(p_organization_id);
 perform public.validate_booking_slot_v1(p_organization_id,p_service_id,p_starts_at,p_staff_id,p_resource_id,null);
 return public.create_booking_v1(p_organization_id,p_contact_id,p_conversation_id,p_service_id,p_staff_id,p_resource_id,
  p_starts_at,p_source,p_customer_notes,p_idempotency_key,p_actor_user_id);
end;
$create$;

revoke all on function public.expire_pending_bookings_v1(uuid) from public,anon,authenticated;
grant execute on function public.expire_pending_bookings_v1(uuid) to service_role;
revoke all on function public.create_booking_v2(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_booking_v2(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) to service_role;
