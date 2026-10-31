-- WHAPPNUS intelligent bookings foundation (additive, multi-tenant).
-- All mutations are performed by authenticated server functions / service-role RPCs.
create extension if not exists btree_gist with schema extensions;

create table if not exists public.booking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  confirmation_mode text not null default 'automatic' check (confirmation_mode in ('automatic','manual')),
  min_notice_minutes integer not null default 60 check (min_notice_minutes between 0 and 43200),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 730),
  pending_expiry_minutes integer not null default 30 check (pending_expiry_minutes between 5 and 1440),
  allow_customer_cancel boolean not null default true,
  allow_customer_reschedule boolean not null default true,
  reminder_24h boolean not null default true,
  reminder_2h boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  description text,
  category text,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
  capacity integer not null default 1 check (capacity between 1 and 1000),
  confirmation_mode text check (confirmation_mode is null or confirmation_mode in ('automatic','manual')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.booking_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.booking_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  resource_type text not null default 'other' check (resource_type in ('room','table','equipment','vehicle','space','other')),
  capacity integer not null default 1 check (capacity between 1 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table if not exists public.booking_service_staff (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  staff_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (service_id, staff_id),
  foreign key (service_id, organization_id) references public.booking_services(id, organization_id) on delete cascade,
  foreign key (staff_id, organization_id) references public.booking_staff(id, organization_id) on delete cascade
);

create table if not exists public.booking_service_resources (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  resource_id uuid not null,
  quantity integer not null default 1 check (quantity between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (service_id, resource_id),
  foreign key (service_id, organization_id) references public.booking_services(id, organization_id) on delete cascade,
  foreign key (resource_id, organization_id) references public.booking_resources(id, organization_id) on delete cascade
);

create table if not exists public.booking_availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type text not null default 'organization' check (scope_type in ('organization','staff','resource')),
  scope_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope_type = 'organization' and scope_id is null) or (scope_type <> 'organization' and scope_id is not null))
);

create table if not exists public.booking_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type text not null default 'organization' check (scope_type in ('organization','staff','resource')),
  scope_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  exception_type text not null default 'unavailable' check (exception_type in ('unavailable','available')),
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope_type = 'organization' and scope_id is null) or (scope_type <> 'organization' and scope_id is not null))
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  conversation_id uuid,
  service_id uuid not null,
  staff_id uuid,
  resource_id uuid,
  booking_code text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('pending_confirmation','confirmed','in_progress','completed','cancelled','no_show','expired')),
  source text not null default 'dashboard' check (source in ('ai','staff','dashboard','system')),
  customer_notes text,
  internal_notes text,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (organization_id, booking_code),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (service_id, organization_id) references public.booking_services(id, organization_id),
  foreign key (staff_id, organization_id) references public.booking_staff(id, organization_id),
  foreign key (resource_id, organization_id) references public.booking_resources(id, organization_id),
  foreign key (contact_id, organization_id) references public.contacts(id, organization_id),
  foreign key (conversation_id, organization_id) references public.conversations(id, organization_id)
);

create index if not exists bookings_org_start_idx on public.bookings(organization_id, starts_at);
create index if not exists bookings_org_status_start_idx on public.bookings(organization_id, status, starts_at);
create index if not exists bookings_contact_idx on public.bookings(organization_id, contact_id, starts_at desc);
create index if not exists booking_services_org_active_idx on public.booking_services(organization_id, is_active);
create index if not exists booking_staff_org_active_idx on public.booking_staff(organization_id, is_active);
create index if not exists booking_resources_org_active_idx on public.booking_resources(organization_id, is_active);
create index if not exists booking_rules_lookup_idx on public.booking_availability_rules(organization_id, scope_type, scope_id, weekday);

create table if not exists public.booking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid not null,
  event_type text not null check (event_type in ('created','approved','rejected','cancelled','rescheduled','started','completed','no_show','expired','updated')),
  actor_type text not null default 'system' check (actor_type in ('ai','staff','dashboard','system','customer')),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (booking_id, organization_id) references public.bookings(id, organization_id) on delete cascade
);
create index if not exists booking_events_booking_idx on public.booking_events(organization_id, booking_id, created_at);

-- Every exposed table is tenant-scoped. Mutations go through server-side functions.
do $$
declare t text;
begin
  foreach t in array array[
    'booking_settings','booking_services','booking_staff','booking_resources',
    'booking_service_staff','booking_service_resources','booking_availability_rules',
    'booking_availability_exceptions','bookings','booking_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(organization_id))', t || '_member_read', t);
  end loop;
end $$;

-- Prevent direct client writes. Service-role server functions perform validated writes.
revoke all on public.booking_settings, public.booking_services, public.booking_staff,
  public.booking_resources, public.booking_service_staff, public.booking_service_resources,
  public.booking_availability_rules, public.booking_availability_exceptions,
  public.bookings, public.booking_events from anon, authenticated;
grant select on public.booking_settings, public.booking_services, public.booking_staff,
  public.booking_resources, public.booking_service_staff, public.booking_service_resources,
  public.booking_availability_rules, public.booking_availability_exceptions,
  public.bookings, public.booking_events to authenticated;
grant all on public.booking_settings, public.booking_services, public.booking_staff,
  public.booking_resources, public.booking_service_staff, public.booking_service_resources,
  public.booking_availability_rules, public.booking_availability_exceptions,
  public.bookings, public.booking_events to service_role;

create or replace function public.create_booking_v1(
  p_organization_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_source text,
  p_customer_notes text default null,
  p_idempotency_key text default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.booking_services%rowtype;
  v_settings public.booking_settings%rowtype;
  v_ends_at timestamptz;
  v_status text;
  v_booking public.bookings%rowtype;
  v_capacity_count integer;
begin
  if p_organization_id is null or p_service_id is null or p_starts_at is null then
    raise exception 'MISSING_BOOKING_FIELDS' using errcode = '22023';
  end if;
  if p_source not in ('ai','staff','dashboard','system') then
    raise exception 'INVALID_BOOKING_SOURCE' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));

  if p_idempotency_key is not null then
    select * into v_booking from public.bookings
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
    if found then
      return pg_catalog.jsonb_build_object('booking', pg_catalog.to_jsonb(v_booking), 'already_created', true);
    end if;
  end if;

  select * into v_service from public.booking_services
  where id = p_service_id and organization_id = p_organization_id and is_active = true;
  if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode = 'P0002'; end if;

  select * into v_settings from public.booking_settings where organization_id = p_organization_id;
  if not found or not v_settings.enabled then
    raise exception 'BOOKING_FEATURE_DISABLED' using errcode = '42501';
  end if;

  if p_starts_at < pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.min_notice_minutes)
     or p_starts_at > pg_catalog.now() + pg_catalog.make_interval(days => v_settings.max_days_ahead) then
    raise exception 'BOOKING_OUTSIDE_ALLOWED_WINDOW' using errcode = '22023';
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.contacts c where c.id = p_contact_id and c.organization_id = p_organization_id
  ) then raise exception 'BOOKING_CONTACT_NOT_FOUND' using errcode = '23503'; end if;

  if p_conversation_id is not null and not exists (
    select 1 from public.conversations c where c.id = p_conversation_id and c.organization_id = p_organization_id
  ) then raise exception 'BOOKING_CONVERSATION_NOT_FOUND' using errcode = '23503'; end if;

  if p_staff_id is not null and not exists (
    select 1 from public.booking_service_staff ss
    join public.booking_staff st on st.id = ss.staff_id and st.organization_id = ss.organization_id
    where ss.organization_id = p_organization_id and ss.service_id = p_service_id
      and ss.staff_id = p_staff_id and st.is_active
  ) then raise exception 'BOOKING_STAFF_NOT_ELIGIBLE' using errcode = '23503'; end if;

  if p_resource_id is not null and not exists (
    select 1 from public.booking_service_resources sr
    join public.booking_resources r on r.id = sr.resource_id and r.organization_id = sr.organization_id
    where sr.organization_id = p_organization_id and sr.service_id = p_service_id
      and sr.resource_id = p_resource_id and r.is_active
  ) then raise exception 'BOOKING_RESOURCE_NOT_ELIGIBLE' using errcode = '23503'; end if;

  v_ends_at := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  if p_staff_id is not null and exists (
    select 1 from public.bookings b
      join public.booking_services prior_service on prior_service.id = b.service_id and prior_service.organization_id = b.organization_id
    where b.organization_id = p_organization_id
      and b.staff_id = p_staff_id and b.status in ('pending_confirmation','confirmed','in_progress')
      and tstzrange(b.starts_at - pg_catalog.make_interval(mins => prior_service.buffer_before_minutes),
                    b.ends_at + pg_catalog.make_interval(mins => prior_service.buffer_after_minutes), '[)')
          && tstzrange(p_starts_at - pg_catalog.make_interval(mins => v_service.buffer_before_minutes),
                       v_ends_at + pg_catalog.make_interval(mins => v_service.buffer_after_minutes), '[)')
  ) then raise exception 'BOOKING_STAFF_SLOT_TAKEN' using errcode = '23P01'; end if;

  if p_resource_id is not null and exists (
    select 1 from public.bookings b where b.organization_id = p_organization_id
      and b.resource_id = p_resource_id and b.status in ('pending_confirmation','confirmed','in_progress')
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then raise exception 'BOOKING_RESOURCE_SLOT_TAKEN' using errcode = '23P01'; end if;

  select count(*) into v_capacity_count from public.bookings b
  where b.organization_id = p_organization_id and b.service_id = p_service_id
    and b.status in ('pending_confirmation','confirmed','in_progress')
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');
  if v_capacity_count >= v_service.capacity then
    raise exception 'BOOKING_SERVICE_CAPACITY_REACHED' using errcode = '23P01';
  end if;

  v_status := case when coalesce(v_service.confirmation_mode, v_settings.confirmation_mode) = 'manual'
    then 'pending_confirmation' else 'confirmed' end;

  insert into public.bookings(
    organization_id, contact_id, conversation_id, service_id, staff_id, resource_id,
    booking_code, starts_at, ends_at, status, source, customer_notes, created_by,
    expires_at, idempotency_key
  ) values (
    p_organization_id, p_contact_id, p_conversation_id, p_service_id, p_staff_id, p_resource_id,
    'BK-' || upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    p_starts_at, v_ends_at, v_status, p_source, nullif(pg_catalog.left(coalesce(p_customer_notes,''),2000),''),
    p_actor_user_id,
    case when v_status = 'pending_confirmation'
      then pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.pending_expiry_minutes) else null end,
    p_idempotency_key
  ) returning * into v_booking;

  insert into public.booking_events(organization_id, booking_id, event_type, actor_type, actor_user_id, details)
  values (p_organization_id, v_booking.id, 'created',
    case when p_source = 'ai' then 'ai' when p_source in ('staff','dashboard') then 'staff' else 'system' end,
    p_actor_user_id,
    pg_catalog.jsonb_build_object('service_id',p_service_id,'staff_id',p_staff_id,'resource_id',p_resource_id,'status',v_status));

  return pg_catalog.jsonb_build_object('booking', pg_catalog.to_jsonb(v_booking), 'already_created', false);
end;
$$;

create or replace function public.update_booking_status_v1(
  p_organization_id uuid,
  p_booking_id uuid,
  p_status text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_event text;
begin
  if p_status not in ('confirmed','in_progress','completed','cancelled','no_show','expired')
     or p_actor_type not in ('ai','staff','dashboard','system','customer') then
    raise exception 'INVALID_BOOKING_TRANSITION' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text, 0));
  select * into v_booking from public.bookings
  where id = p_booking_id and organization_id = p_organization_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_booking.status in ('completed','cancelled','no_show','expired') then
    raise exception 'BOOKING_ALREADY_FINAL' using errcode = '22023';
  end if;
  if p_status = 'in_progress' and v_booking.status <> 'confirmed' then
    raise exception 'BOOKING_MUST_BE_CONFIRMED' using errcode = '22023';
  end if;

  v_event := case p_status
    when 'confirmed' then 'approved'
    when 'cancelled' then 'cancelled'
    when 'in_progress' then 'started'
    when 'completed' then 'completed'
    when 'no_show' then 'no_show'
    else 'expired' end;

  update public.bookings set status = p_status,
    approved_by = case when p_status = 'confirmed' then p_actor_user_id else approved_by end,
    expires_at = null,
    internal_notes = case when p_reason is not null then coalesce(internal_notes || E'\n','') || pg_catalog.left(p_reason,1000) else internal_notes end,
    updated_at = pg_catalog.now()
  where id = p_booking_id and organization_id = p_organization_id
  returning * into v_booking;

  insert into public.booking_events(organization_id, booking_id, event_type, actor_type, actor_user_id, details)
  values (p_organization_id, p_booking_id, v_event, p_actor_type, p_actor_user_id,
    pg_catalog.jsonb_build_object('status',p_status,'reason',p_reason));

  return pg_catalog.jsonb_build_object('booking', pg_catalog.to_jsonb(v_booking));
end;
$$;


create or replace function public.reschedule_booking_v1(
  p_organization_id uuid,
  p_booking_id uuid,
  p_starts_at timestamptz,
  p_staff_id uuid,
  p_resource_id uuid,
  p_actor_type text,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_service public.booking_services%rowtype;
  v_settings public.booking_settings%rowtype;
  v_timezone text;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_weekday integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
  select * into v_booking from public.bookings where id=p_booking_id and organization_id=p_organization_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  if v_booking.status not in ('confirmed','pending_confirmation') then raise exception 'BOOKING_CANNOT_BE_RESCHEDULED' using errcode='22023'; end if;
  select * into v_service from public.booking_services where id=v_booking.service_id and organization_id=p_organization_id and is_active;
  if not found then raise exception 'BOOKING_SERVICE_NOT_AVAILABLE' using errcode='P0002'; end if;
  select * into v_settings from public.booking_settings where organization_id=p_organization_id and enabled;
  if not found then raise exception 'BOOKING_FEATURE_DISABLED' using errcode='42501'; end if;
  if p_starts_at < pg_catalog.now()+pg_catalog.make_interval(mins=>v_settings.min_notice_minutes)
    or p_starts_at > pg_catalog.now()+pg_catalog.make_interval(days=>v_settings.max_days_ahead) then
    raise exception 'BOOKING_OUTSIDE_ALLOWED_WINDOW' using errcode='22023';
  end if;
  v_ends_at:=p_starts_at+pg_catalog.make_interval(mins=>v_service.duration_minutes);
  select coalesce(timezone,'Africa/Luanda') into v_timezone from public.organizations where id=p_organization_id;
  v_local_start:=p_starts_at at time zone v_timezone;
  v_local_end:=v_ends_at at time zone v_timezone;
  v_weekday:=extract(dow from v_local_start)::integer;
  if not exists(select 1 from public.booking_availability_rules r where r.organization_id=p_organization_id and r.scope_type='organization' and r.scope_id is null and r.weekday=v_weekday and r.is_available and r.starts_at<=v_local_start::time and r.ends_at>=v_local_end::time) then
    raise exception 'BOOKING_OUTSIDE_BUSINESS_HOURS' using errcode='22023';
  end if;
  if p_staff_id is not null and exists(select 1 from public.bookings b where b.organization_id=p_organization_id and b.staff_id=p_staff_id and b.id<>p_booking_id and b.status in ('pending_confirmation','confirmed','in_progress') and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at-v_service.buffer_before_minutes*interval '1 minute',v_ends_at+v_service.buffer_after_minutes*interval '1 minute','[)')) then
    raise exception 'BOOKING_STAFF_SLOT_TAKEN' using errcode='23P01';
  end if;
  if p_resource_id is not null and exists(select 1 from public.bookings b where b.organization_id=p_organization_id and b.resource_id=p_resource_id and b.id<>p_booking_id and b.status in ('pending_confirmation','confirmed','in_progress') and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_starts_at,v_ends_at,'[)')) then
    raise exception 'BOOKING_RESOURCE_SLOT_TAKEN' using errcode='23P01';
  end if;
  update public.bookings set starts_at=p_starts_at,ends_at=v_ends_at,staff_id=p_staff_id,resource_id=p_resource_id,
    status=case when status='pending_confirmation' then status else 'confirmed' end,
    expires_at=case when status='pending_confirmation' then expires_at else null end,updated_at=pg_catalog.now()
  where id=p_booking_id and organization_id=p_organization_id returning * into v_booking;
  insert into public.booking_events(organization_id,booking_id,event_type,actor_type,actor_user_id,details)
  values(p_organization_id,p_booking_id,'rescheduled',p_actor_type,p_actor_user_id,
    pg_catalog.jsonb_build_object('starts_at',p_starts_at,'ends_at',v_ends_at));
  return pg_catalog.jsonb_build_object('booking',pg_catalog.to_jsonb(v_booking));
end;
$$;

revoke all on function public.reschedule_booking_v1(uuid,uuid,timestamptz,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.reschedule_booking_v1(uuid,uuid,timestamptz,uuid,uuid,text,uuid) to service_role;

revoke all on function public.create_booking_v1(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.update_booking_status_v1(uuid,uuid,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_booking_v1(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) to service_role;
grant execute on function public.update_booking_status_v1(uuid,uuid,text,text,uuid,text) to service_role;

comment on table public.bookings is 'Multi-tenant bookings created by authorized dashboard users or the WHAPPNUS AI booking tools.';
comment on function public.create_booking_v1(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid) is 'Atomic, tenant-scoped booking creation with idempotency and collision checks. Service role only.';
