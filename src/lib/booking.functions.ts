import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function bookingContext(organizationId: string, roles: ("OWNER"|"ADMIN"|"SUPERVISOR"|"AGENT")[]) {
  const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
  const actor = await requireOrgRole(organizationId, roles);
  return { actor, admin: serviceClient() };
}

export const getBookingWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN","SUPERVISOR","AGENT"]);
    const { error: expiryError } = await admin.rpc("expire_pending_bookings_v1", { p_organization_id: data.organizationId });
    if (expiryError) throw new Error(expiryError.message);
    const from = data.from ?? new Date(Date.now() - 7 * 86400000).toISOString();
    const to = data.to ?? new Date(Date.now() + 45 * 86400000).toISOString();
    const [org, settings, services, staff, resources, rules, bookings, contacts] = await Promise.all([
      admin.from("organizations").select("id,name,timezone,currency").eq("id", data.organizationId).single(),
      admin.from("booking_settings").select("*").eq("organization_id", data.organizationId).maybeSingle(),
      admin.from("booking_services").select("*").eq("organization_id", data.organizationId).order("name"),
      admin.from("booking_staff").select("*").eq("organization_id", data.organizationId).order("display_name"),
      admin.from("booking_resources").select("*").eq("organization_id", data.organizationId).order("name"),
      admin.from("booking_availability_rules").select("*").eq("organization_id", data.organizationId).order("weekday"),
      admin.from("bookings").select("*").eq("organization_id", data.organizationId).gte("starts_at", from).lt("starts_at", to).order("starts_at"),
      admin.from("contacts").select("id,full_name,phone_e164").eq("organization_id", data.organizationId).order("full_name").limit(500),
    ]);
    for (const q of [org,settings,services,staff,resources,rules,bookings,contacts]) if (q.error) throw new Error(q.error.message);
    const sm = new Map((services.data ?? []).map(x => [x.id,x]));
    const tm = new Map((staff.data ?? []).map(x => [x.id,x]));
    const rm = new Map((resources.data ?? []).map(x => [x.id,x]));
    const cm = new Map((contacts.data ?? []).map(x => [x.id,x]));
    return {
      organization: org.data,
      settings: settings.data ?? { organization_id:data.organizationId,enabled:false,confirmation_mode:"automatic",min_notice_minutes:60,max_days_ahead:60,pending_expiry_minutes:30,allow_customer_cancel:true,allow_customer_reschedule:true,reminder_24h:true,reminder_2h:true },
      services: services.data ?? [], staff: staff.data ?? [], resources: resources.data ?? [], rules: rules.data ?? [], contacts: contacts.data ?? [],
      bookings: (bookings.data ?? []).map(b => ({...b,service:sm.get(b.service_id)??null,staff:b.staff_id?tm.get(b.staff_id)??null:null,resource:b.resource_id?rm.get(b.resource_id)??null:null,contact:b.contact_id?cm.get(b.contact_id)??null:null})),
    };
  });

export const saveBookingSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),enabled:z.boolean(),confirmationMode:z.enum(["automatic","manual"]),
    minNoticeMinutes:z.number().int().min(0).max(43200),maxDaysAhead:z.number().int().min(1).max(730),
    pendingExpiryMinutes:z.number().int().min(5).max(1440),allowCustomerCancel:z.boolean(),
    allowCustomerReschedule:z.boolean(),reminder24h:z.boolean(),reminder2h:z.boolean(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN"]);
    if (data.enabled) {
      const [{ count: serviceCount, error: serviceError }, { count: ruleCount, error: ruleError }] = await Promise.all([
        admin.from("booking_services").select("id", { count: "exact", head: true }).eq("organization_id", data.organizationId).eq("is_active", true),
        admin.from("booking_availability_rules").select("id", { count: "exact", head: true }).eq("organization_id", data.organizationId).eq("scope_type", "organization").eq("is_available", true),
      ]);
      if (serviceError || ruleError) throw new Error("Não foi possível validar os serviços e horários.");
      if (!serviceCount || !ruleCount) throw new Error("Antes de activar, cadastra pelo menos um serviço activo e define os horários de funcionamento.");
    }
    const { error } = await admin.from("booking_settings").upsert({
      organization_id:data.organizationId,enabled:data.enabled,confirmation_mode:data.confirmationMode,
      min_notice_minutes:data.minNoticeMinutes,max_days_ahead:data.maxDaysAhead,pending_expiry_minutes:data.pendingExpiryMinutes,
      allow_customer_cancel:data.allowCustomerCancel,allow_customer_reschedule:data.allowCustomerReschedule,
      reminder_24h:data.reminder24h,reminder_2h:data.reminder2h,updated_at:new Date().toISOString(),
    }, { onConflict:"organization_id" });
    if (error) throw new Error(error.message);
    return { ok:true };
  });

export const saveBookingService = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),id:z.string().uuid().optional(),name:z.string().trim().min(2).max(120),
    description:z.string().max(2000).optional(),category:z.string().max(80).optional(),
    durationMinutes:z.number().int().min(5).max(1440),bufferBeforeMinutes:z.number().int().min(0).max(1440),
    bufferAfterMinutes:z.number().int().min(0).max(1440),priceAmount:z.number().min(0).nullable().optional(),
    capacity:z.number().int().min(1).max(1000),confirmationMode:z.enum(["automatic","manual"]).nullable().optional(),isActive:z.boolean(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN"]);
    const values = { organization_id:data.organizationId,name:data.name,description:data.description??null,category:data.category??null,
      duration_minutes:data.durationMinutes,buffer_before_minutes:data.bufferBeforeMinutes,buffer_after_minutes:data.bufferAfterMinutes,
      price_amount:data.priceAmount??null,capacity:data.capacity,confirmation_mode:data.confirmationMode??null,is_active:data.isActive,updated_at:new Date().toISOString() };
    const result = data.id
      ? await admin.from("booking_services").update(values).eq("organization_id",data.organizationId).eq("id",data.id).select("id").single()
      : await admin.from("booking_services").insert(values).select("id").single();
    if (result.error) throw new Error(result.error.message);
    return { id:result.data.id };
  });

export const saveBookingStaff = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),id:z.string().uuid().optional(),displayName:z.string().trim().min(2).max(120),
    description:z.string().max(1000).optional(),userId:z.string().uuid().nullable().optional(),
    serviceIds:z.array(z.string().uuid()).max(100),isActive:z.boolean(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN"]);
    const values = { organization_id:data.organizationId,display_name:data.displayName,description:data.description??null,
      user_id:data.userId??null,is_active:data.isActive,updated_at:new Date().toISOString() };
    const result = data.id
      ? await admin.from("booking_staff").update(values).eq("organization_id",data.organizationId).eq("id",data.id).select("id").single()
      : await admin.from("booking_staff").insert(values).select("id").single();
    if (result.error) throw new Error(result.error.message);
    const staffId=result.data.id;
    const { error:delError } = await admin.from("booking_service_staff").delete().eq("organization_id",data.organizationId).eq("staff_id",staffId);
    if (delError) throw new Error(delError.message);
    if (data.serviceIds.length) {
      const { error } = await admin.from("booking_service_staff").insert(data.serviceIds.map(serviceId=>({organization_id:data.organizationId,staff_id:staffId,service_id:serviceId})));
      if (error) throw new Error(error.message);
    }
    return { id:staffId };
  });

export const saveBookingResource = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),id:z.string().uuid().optional(),name:z.string().trim().min(2).max(120),
    resourceType:z.enum(["room","table","equipment","vehicle","space","other"]),capacity:z.number().int().min(1).max(1000),
    serviceIds:z.array(z.string().uuid()).max(100),isActive:z.boolean(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN"]);
    const values={organization_id:data.organizationId,name:data.name,resource_type:data.resourceType,capacity:data.capacity,is_active:data.isActive,updated_at:new Date().toISOString()};
    const result=data.id
      ? await admin.from("booking_resources").update(values).eq("organization_id",data.organizationId).eq("id",data.id).select("id").single()
      : await admin.from("booking_resources").insert(values).select("id").single();
    if(result.error) throw new Error(result.error.message);
    const resourceId=result.data.id;
    const {error:delError}=await admin.from("booking_service_resources").delete().eq("organization_id",data.organizationId).eq("resource_id",resourceId);
    if(delError) throw new Error(delError.message);
    if(data.serviceIds.length){
      const {error}=await admin.from("booking_service_resources").insert(data.serviceIds.map(serviceId=>({organization_id:data.organizationId,resource_id:resourceId,service_id:serviceId})));
      if(error) throw new Error(error.message);
    }
    return {id:resourceId};
  });

export const saveBookingSchedule = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),
    days:z.array(z.object({weekday:z.number().int().min(0).max(6),enabled:z.boolean(),
      startsAt:z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/),endsAt:z.string().regex(/^([01]\\d|2[0-3]):[0-5]\\d$/)})).length(7),
  }).parse(input))
  .handler(async ({ data }) => {
    const { admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN"]);
    const days=data.days.filter(d=>d.enabled);
    if(days.some(d=>d.endsAt<=d.startsAt)) throw new Error("O horário de fecho deve ser posterior à abertura.");
    const {error:delError}=await admin.from("booking_availability_rules").delete().eq("organization_id",data.organizationId).eq("scope_type","organization");
    if(delError) throw new Error(delError.message);
    if(days.length){
      const {error}=await admin.from("booking_availability_rules").insert(days.map(d=>({organization_id:data.organizationId,scope_type:"organization",scope_id:null,
        weekday:d.weekday,starts_at:d.startsAt+":00",ends_at:d.endsAt+":00",is_available:true})));
      if(error) throw new Error(error.message);
    }
    return {ok:true};
  });

function localDateTimeToUtc(local: string, timezone: string): string {
  const match=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/.exec(local);
  if(!match) throw new Error("Data e hora inválidas.");
  const [,y,m,d,h,minute]=match;
  const desired=Date.UTC(Number(y),Number(m)-1,Number(d),Number(h),Number(minute));
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(desired));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const represented=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));
  return new Date(desired-(represented-desired)).toISOString();
}

export const createDashboardBooking = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),contactId:z.string().uuid().nullable(),serviceId:z.string().uuid(),
    staffId:z.string().uuid().nullable(),resourceId:z.string().uuid().nullable(),startsAtLocal:z.string(),
    customerNotes:z.string().max(2000).optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { actor, admin } = await bookingContext(data.organizationId, ["OWNER","ADMIN","SUPERVISOR"]);
    const [{data:org,error:orgError},{data:service,error:serviceError}] = await Promise.all([
      admin.from("organizations").select("timezone").eq("id",data.organizationId).single(),
      admin.from("booking_services").select("id,is_active").eq("organization_id",data.organizationId).eq("id",data.serviceId).single(),
    ]);
    if(orgError||!org) throw new Error("Não foi possível identificar o fuso horário da organização.");
    if(serviceError||!service?.is_active) throw new Error("Serviço indisponível.");
    const startsAt=localDateTimeToUtc(data.startsAtLocal,org.timezone||"Africa/Luanda");
    const {data:result,error}=await admin.rpc("create_booking_v2",{
      p_organization_id:data.organizationId,p_contact_id:data.contactId,p_conversation_id:null,p_service_id:data.serviceId,
      p_staff_id:data.staffId,p_resource_id:data.resourceId,p_starts_at:startsAt,p_source:"dashboard",
      p_customer_notes:data.customerNotes??null,p_idempotency_key:crypto.randomUUID(),p_actor_user_id:actor.userId,
    });
    if(error) throw new Error(error.message);
    return result;
  });

export const updateDashboardBookingStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    organizationId:z.string().uuid(),bookingId:z.string().uuid(),
    status:z.enum(["confirmed","in_progress","completed","cancelled","no_show"]),reason:z.string().max(1000).optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const {actor,admin}=await bookingContext(data.organizationId,["OWNER","ADMIN","SUPERVISOR"]);
    const {data:result,error}=await admin.rpc("update_booking_status_v1",{
      p_organization_id:data.organizationId,p_booking_id:data.bookingId,p_status:data.status,
      p_actor_type:"dashboard",p_actor_user_id:actor.userId,p_reason:data.reason??null,
    });
    if(error) throw new Error(error.message);
    return result;
  });
