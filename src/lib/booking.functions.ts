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
