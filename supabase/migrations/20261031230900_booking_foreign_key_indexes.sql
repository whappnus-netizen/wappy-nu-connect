-- Cover the booking module's foreign keys with indexes in the FK column order.
-- This keeps deletes/updates on parent rows efficient and avoids sequential scans at scale.
create index if not exists booking_availability_exceptions_org_window_idx
  on public.booking_availability_exceptions(organization_id, starts_at, ends_at);

create index if not exists booking_events_actor_user_idx
  on public.booking_events(actor_user_id);
create index if not exists booking_events_booking_org_fk_idx
  on public.booking_events(booking_id, organization_id);

create index if not exists booking_service_resources_org_idx
  on public.booking_service_resources(organization_id);
create index if not exists booking_service_resources_service_org_fk_idx
  on public.booking_service_resources(service_id, organization_id);
create index if not exists booking_service_resources_resource_org_fk_idx
  on public.booking_service_resources(resource_id, organization_id);

create index if not exists booking_service_staff_org_idx
  on public.booking_service_staff(organization_id);
create index if not exists booking_service_staff_service_org_fk_idx
  on public.booking_service_staff(service_id, organization_id);
create index if not exists booking_service_staff_staff_org_fk_idx
  on public.booking_service_staff(staff_id, organization_id);

create index if not exists booking_staff_user_idx
  on public.booking_staff(user_id);

create index if not exists bookings_approved_by_idx
  on public.bookings(approved_by);
create index if not exists bookings_contact_org_fk_idx
  on public.bookings(contact_id, organization_id);
create index if not exists bookings_conversation_org_fk_idx
  on public.bookings(conversation_id, organization_id);
create index if not exists bookings_created_by_idx
  on public.bookings(created_by);
create index if not exists bookings_resource_org_fk_idx
  on public.bookings(resource_id, organization_id);
create index if not exists bookings_service_org_fk_idx
  on public.bookings(service_id, organization_id);
create index if not exists bookings_staff_org_fk_idx
  on public.bookings(staff_id, organization_id);
