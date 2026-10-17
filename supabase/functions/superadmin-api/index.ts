import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type Admin = { user_id: string; role: "owner" | "admin" | "support" | "billing"; permissions: Record<string, unknown>; is_active: boolean };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const fail = (message: string, status = 400) => json({ ok: false, error: message }, status);
const str = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
// Long-form training text is stored without an application-level character cap.
const longText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Método não permitido.", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return fail("Configuração segura do servidor incompleta.", 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("Sessão necessária.", 401);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return fail("Sessão inválida ou expirada.", 401);
  const actor = authData.user;

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow, error: adminError } = await db
    .from("superadmin_users")
    .select("user_id,role,permissions,is_active")
    .eq("user_id", actor.id)
    .eq("is_active", true)
    .maybeSingle();
  if (adminError) return fail("Não foi possível validar as permissões administrativas.", 500);
  if (!adminRow) return fail("Acesso restrito à equipa autorizada do Super Admin.", 403);
  const admin = adminRow as Admin;

  let input: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!isObject(parsed)) return fail("Corpo do pedido inválido.");
    input = parsed;
  } catch {
    return fail("JSON inválido.");
  }

  const action = str(input.action, 80);
  const can = (permission: string) => {
    const permissions = admin.permissions ?? {};
    return admin.role === "owner" ||
      (admin.role === "admin" && !["team.promote_owner"].includes(permission)) ||
      admin.role === "billing" && ["plans.list", "plans.save", "subscriptions.list", "payments.list", "notifications.list", "dashboard"].includes(permission) ||
      admin.role === "support" && ["organizations.list", "plans.list", "subscriptions.list", "payments.list", "notifications.list", "health", "dashboard"].includes(permission) ||
      permissions[permission] === true;
  };
  if (!action) return fail("Ação não especificada.");
  if (!can(action)) return fail("Não tens permissão para esta operação.", 403);
  if (action === "team.save" && admin.role !== "owner") return fail("Só o proprietário da plataforma pode alterar administradores.", 403);
  if (action === "subscriptions.reactivate" && !["owner", "admin"].includes(admin.role)) return fail("Só o proprietário ou administrador da plataforma pode reativar assinaturas.", 403);

  const audit = async (name: string, targetType: string, targetId: string | null, organizationId: string | null, details: Record<string, unknown> = {}) => {
    const { error } = await db.from("superadmin_audit_logs").insert({
      actor_user_id: actor.id, action: name, target_type: targetType, target_id: targetId,
      organization_id: organizationId, request_id: req.headers.get("x-request-id"),
      user_agent: req.headers.get("user-agent"), details,
    });
    if (error) console.error("superadmin audit insert failed", error.message);
  };
  const count = async (table: string, filters?: (query: any) => any) => {
    let query = db.from(table).select("*", { count: "exact", head: true });
    if (filters) query = filters(query);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  };

  try {
    if (action === "dashboard") {
      const [organizations, activeOrganizations, suspendedOrganizations, subscriptions, failedPayments, connectedNumbers, aiErrors] = await Promise.all([
        count("organizations"),
        count("organizations", q => q.eq("status", "active")),
        count("organizations", q => q.in("status", ["suspended", "blocked"])),
        count("organization_subscriptions", q => q.eq("status", "active")),
        count("payment_transactions", q => q.in("status", ["failed", "partially_refunded"])),
        count("whatsapp_numbers", q => q.eq("status", "connected")),
        count("ai_logs", q => q.eq("status", "error")),
      ]);
      const { data: recentAudit, error } = await db.from("superadmin_audit_logs")
        .select("id,action,target_type,target_id,created_at,actor_user_id")
        .order("created_at", { ascending: false }).limit(8);
      if (error) throw error;
      return json({ ok: true, data: { metrics: { organizations, activeOrganizations, suspendedOrganizations, subscriptions, failedPayments, connectedNumbers, aiErrors }, recentAudit: recentAudit ?? [] } });
    }

    if (action === "organizations.list") {
      const search = str(input.search, 100);
      let query = db.from("organizations")
        .select("id,name,slug,status,management_mode,suspension_reason,contact_phone,created_by,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(200);
      if (search) query = query.or(`name.ilike.%${search.replace(/[,%()]/g, "")}%,slug.ilike.%${search.replace(/[,%()]/g, "")}%`);
      const { data, error } = await query;
      if (error) throw error;
      const ids = (data ?? []).map((row: any) => row.id);
      if (!ids.length) return json({ ok: true, data: [] });
      const [members, numbers, agents] = await Promise.all([
        db.from("memberships").select("organization_id,user_id,role").in("organization_id", ids),
        db.from("whatsapp_numbers").select("organization_id,status,phone_e164,display_name").in("organization_id", ids).is("deleted_at", null),
        db.from("ai_agents").select("organization_id,is_active").in("organization_id", ids),
      ]);
      if (members.error) throw members.error;
      if (numbers.error) throw numbers.error;
      if (agents.error) throw agents.error;
      const counts = (rows: any[], key: string) => rows.reduce((acc: Record<string, number>, row: any) => { acc[row[key]] = (acc[row[key]] ?? 0) + 1; return acc; }, {});
      const memberCounts = counts(members.data ?? [], "organization_id");
      const numberCounts = counts(numbers.data ?? [], "organization_id");
      const activeAgents = (agents.data ?? []).reduce((acc: Record<string, number>, row: any) => { if (row.is_active) acc[row.organization_id] = (acc[row.organization_id] ?? 0) + 1; return acc; }, {});
      const ownerByOrg = new Map<string, string>();
      for (const membership of members.data ?? []) if (membership.role === "OWNER" || membership.role === "owner") ownerByOrg.set(membership.organization_id, membership.user_id);
      const ownerIds = [...new Set([...ownerByOrg.values()])];
      const profileResult = ownerIds.length ? await db.from("profiles").select("id,full_name,email").in("id", ownerIds) : { data: [], error: null };
      if (profileResult.error) throw profileResult.error;
      const profilesById = new Map((profileResult.data ?? []).map((p: any) => [p.id, p]));
      const owners = await Promise.all(ownerIds.map(async (id) => { const { data: result } = await db.auth.admin.getUserById(id); return [id, result.user ?? null] as const; }));
      const authById = new Map(owners);
      return json({ ok: true, data: (data ?? []).map((row: any) => {
        const ownerId = ownerByOrg.get(row.id);
        const profile = ownerId ? profilesById.get(ownerId) : null;
        const owner = ownerId ? authById.get(ownerId) : null;
        const metadata = owner?.user_metadata ?? {};
        const orgNumbers = (numbers.data ?? []).filter((n: any) => n.organization_id === row.id);
        return { ...row, client_name: profile?.full_name ?? metadata.full_name ?? metadata.name ?? null,
          client_email: profile?.email ?? owner?.email ?? null,
          contact_phone: row.contact_phone ?? metadata.phone ?? metadata.phone_number ?? owner?.phone ?? null,
          members_count: memberCounts[row.id] ?? 0, whatsapp_count: numberCounts[row.id] ?? 0,
          ai_agents_active: activeAgents[row.id] ?? 0,
          whatsapp_statuses: orgNumbers.map((n: any) => ({ id: n.id, status: n.status, phone_e164: n.phone_e164, display_name: n.display_name })),
        };
      }) });
    }

    if (action === "organizations.create") {
      const name = str(input.name, 120);
      const slug = str(input.slug, 80).toLowerCase();
      const ownerUserId = str(input.owner_user_id, 60);
      if (name.length < 2) return fail("O nome da organização deve ter pelo menos 2 caracteres.");
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return fail("O identificador deve conter letras minúsculas, números e hífen.");
      if (ownerUserId) {
        const { data: ownerData, error: ownerError } = await db.auth.admin.getUserById(ownerUserId);
        if (ownerError || !ownerData.user) return fail("O UUID do utilizador proprietário não corresponde a uma conta existente.");
      }
      const { data: org, error } = await db.from("organizations").insert({
        name, slug, created_by: actor.id, status: "setup", management_mode: "managed",
      }).select("id,name,slug,status,management_mode,created_at").single();
      if (error) {
        if (error.code === "23505") return fail("Este identificador já está em uso.");
        throw error;
      }
      if (ownerUserId) {
        const { error: membershipError } = await db.from("memberships").upsert({
          organization_id: org.id, user_id: ownerUserId, role: "OWNER",
        }, { onConflict: "organization_id,user_id" });
        if (membershipError) {
          await db.from("organizations").update({ status: "setup", platform_notes: "Criada pelo Super Admin; associação do proprietário pendente." }).eq("id", org.id);
          await audit("organization.create.membership_failed", "organization", org.id, org.id, { error: membershipError.message });
          throw new Error("Organização criada, mas não foi possível associar o proprietário. Verifica as permissões da equipa.");
        }
      }
      await db.from("ai_settings").upsert({ organization_id: org.id }, { onConflict: "organization_id", ignoreDuplicates: true });
      await audit("organization.created", "organization", org.id, org.id, { slug, owner_assigned: Boolean(ownerUserId) });
      return json({ ok: true, data: { ...org, owner_assigned: Boolean(ownerUserId) } }, 201);
    }

    if (action === "organizations.set_status") {
      const id = str(input.organization_id, 60);
      const status = str(input.status, 30);
      const reason = str(input.reason, 500);
      if (!id || !["active", "trial", "setup", "suspended", "blocked", "cancelled"].includes(status)) return fail("Estado ou organização inválidos.");
      const { data: before, error: readError } = await db.from("organizations").select("id,status,name").eq("id", id).maybeSingle();
      if (readError) throw readError;
      if (!before) return fail("Organização não encontrada.", 404);
      if (["active", "trial"].includes(status)) {
        const { data: subscription, error: subscriptionError } = await db.from("organization_subscriptions")
          .select("status,current_period_end").eq("organization_id", id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (subscriptionError) throw subscriptionError;
        const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : null;
        if (!subscription || !["active", "trialing"].includes(subscription.status) || (periodEnd !== null && periodEnd <= Date.now())) {
          return fail("A organização só pode ser activada com uma assinatura válida. Usa a aba Assinaturas para escolher um plano pago e reactivar.", 409);
        }
      }
      const patch: Record<string, unknown> = { status, suspension_reason: ["suspended", "blocked"].includes(status) ? reason || null : null };
      patch.suspended_at = ["suspended", "blocked"].includes(status) ? new Date().toISOString() : null;
      const { data, error } = await db.from("organizations").update(patch).eq("id", id)
        .select("id,name,slug,status,management_mode,suspension_reason,created_at,updated_at").single();
      if (error) throw error;
      await audit("organization.status_changed", "organization", id, id, { from: before.status, to: status, reason });
      return json({ ok: true, data });
    }

    if (action === "plans.list") {
      const { data, error } = await db.from("subscription_plans")
        .select("id,code,name,description,billing_interval,price_aoa,trial_days,limits,features,is_active,sort_order,created_at,updated_at")
        .order("sort_order", { ascending: true }).limit(100);
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (action === "plans.delete") {
      const id = str(input.id, 60);
      if (!id) return fail("Plano inválido.");
      const { data: plan, error: planError } = await db.from("subscription_plans").select("id,code,name,is_active").eq("id", id).maybeSingle();
      if (planError) throw planError;
      if (!plan) return fail("Plano não encontrado.", 404);
      if (plan.is_active) return fail("Desactiva o plano antes de o apagar.", 409);
      const [subs, mappings, sales] = await Promise.all([
        db.from("organization_subscriptions").select("id", { count: "exact", head: true }).eq("plan_id", id),
        db.from("kursinha_product_mappings").select("product_id", { count: "exact", head: true }).eq("plan_id", id),
        db.from("kursinha_sales").select("sale_id", { count: "exact", head: true }).eq("plan_id", id),
      ]);
      if (subs.error) throw subs.error; if (mappings.error) throw mappings.error; if (sales.error) throw sales.error;
      if ((subs.count ?? 0) + (mappings.count ?? 0) + (sales.count ?? 0) > 0) return fail("Este plano tem histórico associado e não pode ser eliminado com segurança.", 409);
      const { error } = await db.from("subscription_plans").delete().eq("id", id);
      if (error) throw error;
      await audit("plan.deleted", "subscription_plan", id, null, { code: plan.code, name: plan.name });
      return json({ ok: true, data: { id, deleted: true } });
    }

    if (action === "plans.save") {
      const id = str(input.id, 60);
      const code = str(input.code, 50).toLowerCase();
      const name = str(input.name, 100);
      const description = str(input.description, 500);
      const interval = str(input.billing_interval, 20);
      const price = Number(input.price_aoa);
      const trialDays = Number(input.trial_days ?? 0);
      const limits = isObject(input.limits) ? input.limits : {};
      const features = isObject(input.features) ? input.features : {};
      const requestedActive = input.is_active === true;
      if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(code) || name.length < 2 || !["monthly", "yearly"].includes(interval)) return fail("Código, nome ou periodicidade do plano inválidos.");
      if (!Number.isFinite(price) || price < 0 || !Number.isInteger(trialDays) || trialDays < 0 || trialDays > 90) return fail("Preço ou período de teste inválido.");
      const patch = { code, name, description, billing_interval: interval, price_aoa: price, trial_days: trialDays, limits, features, is_active: requestedActive && price > 0, sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0 };
      const result = id
        ? await db.from("subscription_plans").update(patch).eq("id", id).select("*").single()
        : await db.from("subscription_plans").insert(patch).select("*").single();
      if (result.error) {
        if (result.error.code === "23505") return fail("Já existe um plano com este código.");
        throw result.error;
      }
      await audit(id ? "plan.updated" : "plan.created", "subscription_plan", result.data.id, null, { code, active: result.data.is_active, price_aoa: price });
      return json({ ok: true, data: result.data });
    }

    if (action === "subscriptions.list") {
      const { data, error } = await db.from("organization_subscriptions")
        .select("id,organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,cancel_at_period_end,provider,created_at,organizations(id,name,slug,contact_phone,created_by),subscription_plans(name,code,limits,features)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const rows = data ?? [];
      const orgIds = [...new Set(rows.map((s: any) => s.organization_id))];
      const ownerMemberships = orgIds.length ? await db.from("memberships").select("organization_id,user_id,role").in("organization_id", orgIds) : { data: [], error: null };
      if (ownerMemberships.error) throw ownerMemberships.error;
      const owners = new Map<string, string>();
      for (const m of ownerMemberships.data ?? []) if (m.role === "OWNER" || m.role === "owner") owners.set(m.organization_id, m.user_id);
      const ownerIds = [...new Set([...owners.values()])];
      const profileResult = ownerIds.length ? await db.from("profiles").select("id,full_name,email").in("id", ownerIds) : { data: [], error: null };
      if (profileResult.error) throw profileResult.error;
      const profiles = new Map((profileResult.data ?? []).map((p: any) => [p.id, p]));
      const authRows = await Promise.all(ownerIds.map(async (id) => { const { data: result } = await db.auth.admin.getUserById(id); return [id, result.user ?? null] as const; }));
      const authUsers = new Map(authRows);
      const enriched = await Promise.all(rows.map(async (s: any) => {
        const ownerId = owners.get(s.organization_id) ?? s.organizations?.created_by ?? null;
        const profile = ownerId ? profiles.get(ownerId) : null;
        const authUser = ownerId ? authUsers.get(ownerId) : null;
        const metadata = authUser?.user_metadata ?? {};
        const periodStart = s.current_period_start ?? s.starts_at ?? s.created_at;
        let usageQuery = db.from("ai_credit_ledger").select("id", { count: "exact", head: true })
          .eq("organization_id", s.organization_id).eq("reason", "ai_conversation");
        if (periodStart) usageQuery = usageQuery.gte("created_at", periodStart);
        if (s.current_period_end) usageQuery = usageQuery.lt("created_at", s.current_period_end);
        const { count: aiUsed, error: usageError } = await usageQuery;
        if (usageError) throw usageError;
        const endMs = s.current_period_end ? new Date(s.current_period_end).getTime() : null;
        return { ...s, client_name: profile?.full_name ?? metadata.full_name ?? metadata.name ?? null,
          client_email: profile?.email ?? authUser?.email ?? null,
          client_phone: s.organizations?.contact_phone ?? metadata.phone ?? metadata.phone_number ?? authUser?.phone ?? null,
          days_remaining: endMs === null ? null : Math.max(0, Math.ceil((endMs - Date.now()) / 86400000)),
          ai_conversations_used: aiUsed ?? 0,
          ai_conversations_limit: Number(s.subscription_plans?.limits?.ai_conversations_monthly ?? 0),
          plan_limits: s.subscription_plans?.limits ?? {}, plan_features: s.subscription_plans?.features ?? {},
        };
      }));
      return json({ ok: true, data: enriched });
    }

    if (action === "reminders.list") {
      const cutoff = new Date(Date.now() + 7 * 86400000).toISOString();
      const { data, error } = await db.from("organization_subscriptions")
        .select("id,organization_id,plan_id,status,starts_at,current_period_start,current_period_end,amount_aoa,organizations(id,name,slug,contact_phone),subscription_plans(name,code,limits)")
        .lte("current_period_end", cutoff)
        .order("current_period_end", { ascending: true }).limit(300);
      if (error) throw error;
      const rows = data ?? [];
      const ids = rows.map((row: any) => row.id);
      const orgIds = [...new Set(rows.map((row: any) => row.organization_id))];
      const [logs, sessions, memberships] = await Promise.all([
        ids.length ? db.from("subscription_reminder_logs").select("id,subscription_id,reminder_days,status,recipient_phone,whatsapp_number_id,error_message,sent_at,created_at").in("subscription_id", ids).order("created_at", { ascending: false }) : { data: [], error: null },
        orgIds.length ? db.from("whatsapp_sessions").select("organization_id,whatsapp_number_id,status,phone_number,display_name").in("organization_id", orgIds).eq("status", "connected") : { data: [], error: null },
        orgIds.length ? db.from("memberships").select("organization_id,user_id,role").in("organization_id", orgIds) : { data: [], error: null },
      ]);
      if (logs.error) throw logs.error; if (sessions.error) throw sessions.error; if (memberships.error) throw memberships.error;
      const ownerByOrg = new Map<string, string>();
      for (const member of memberships.data ?? []) if (member.role === "OWNER" || member.role === "owner") ownerByOrg.set(member.organization_id, member.user_id);
      const ownerIds = [...new Set([...ownerByOrg.values()])];
      const authRows = await Promise.all(ownerIds.map(async (id) => { const { data: result } = await db.auth.admin.getUserById(id); return [id, result.user ?? null] as const; }));
      const authById = new Map(authRows);
      const logsBySubscription = new Map<string, any>();
      for (const log of logs.data ?? []) if (!logsBySubscription.has(log.subscription_id)) logsBySubscription.set(log.subscription_id, log);
      const sessionsByOrg = new Map((sessions.data ?? []).map((row: any) => [row.organization_id, row]));
      return json({ ok: true, data: rows.map((row: any) => {
        const end = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
        const reminder = logsBySubscription.get(row.id);
        const owner = authById.get(ownerByOrg.get(row.organization_id) ?? "");
        const metadata = owner?.user_metadata ?? {};
        return { ...row, contact_phone: row.organizations?.contact_phone ?? metadata.phone ?? metadata.phone_number ?? owner?.phone ?? null,
          client_name: metadata.full_name ?? metadata.name ?? null, client_email: owner?.email ?? null,
          days_remaining: end === null ? null : Math.ceil((end - Date.now()) / 86400000),
          reminder_status: reminder?.status ?? "A agendar", reminder_days: reminder?.reminder_days ?? null,
          reminder_sent_at: reminder?.sent_at ?? null, reminder_error: reminder?.error_message ?? null,
          whatsapp_session: sessionsByOrg.get(row.organization_id) ?? null };
      }) });
    }

    if (action === "notifications.list") {
      const { data, error } = await db.from("organization_notifications")
        .select("id,organization_id,title,body,notification_type,created_at,organizations(name,slug)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (action === "notifications.send") {
      if (!["owner", "admin"].includes(admin.role)) return fail("Só o proprietário ou administrador pode enviar notificações.", 403);
      const title = str(input.title, 140);
      const body = str(input.body, 2000);
      const allOrganizations = input.all_organizations === true || input.organization_id === "all";
      const requestedIds = Array.isArray(input.organization_ids) ? [...new Set(input.organization_ids.map((v: unknown) => str(v, 60)).filter(Boolean))] : [];
      const singleId = str(input.organization_id, 60);
      const ids = allOrganizations ? [] : requestedIds.length ? requestedIds : singleId ? [singleId] : [];
      if (title.length < 3 || body.length < 3) return fail("Preenche um título e uma mensagem válidos.");
      if (!allOrganizations && (!ids.length || ids.length > 10)) return fail("Selecciona uma organização, até 10 organizações, ou escolhe Todos.");
      let orgQuery = db.from("organizations").select("id,name");
      if (!allOrganizations) orgQuery = orgQuery.in("id", ids);
      const { data: targetOrganizations, error: orgError } = await orgQuery.order("name", { ascending: true });
      if (orgError) throw orgError;
      if (!targetOrganizations?.length) return fail("Não foram encontradas organizações para receber a notificação.", 404);
      const records = targetOrganizations.map((org: any) => ({ organization_id: org.id, title, body,
        notification_type: "platform_update", created_by: actor.id,
        metadata: { source: "superadmin", broadcast: allOrganizations, batch_size: targetOrganizations.length },
      }));
      const { data, error } = await db.from("organization_notifications").insert(records)
        .select("id,organization_id,title,body,notification_type,created_at");
      if (error) throw error;
      await audit("notification.sent", "organization_notification_batch", null, null, { title, recipient_count: data?.length ?? 0, broadcast: allOrganizations, organization_ids: targetOrganizations.map((o: any) => o.id) });
      return json({ ok: true, data: { sent_count: data?.length ?? 0, notifications: data ?? [] } });
    }

    if (action === "subscriptions.reactivate") {
      const subscriptionId = str(input.subscription_id, 60);
      const planId = str(input.plan_id, 60);
      const periodDays = Number(input.period_days ?? 30);
      if (!subscriptionId || !planId || !Number.isInteger(periodDays) || periodDays < 1 || periodDays > 365) {
        return fail("Assinatura, plano ou período de reativação inválido.");
      }
      const { data: before, error: beforeError } = await db.from("organization_subscriptions")
        .select("id,organization_id,status,metadata").eq("id", subscriptionId).maybeSingle();
      if (beforeError) throw beforeError;
      if (!before) return fail("Assinatura não encontrada.", 404);
      const { data: plan, error: planError } = await db.from("subscription_plans")
        .select("id,code,name,billing_interval,price_aoa,limits,is_active")
        .eq("id", planId).maybeSingle();
      if (planError) throw planError;
      if (!plan || !plan.is_active || Number(plan.price_aoa) <= 0) {
        return fail("Escolhe um plano pago activo. Confirma o pagamento antes de reactivar a conta.");
      }
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
      const { data, error } = await db.from("organization_subscriptions").update({
        plan_id: plan.id,
        status: "active",
        billing_interval: plan.billing_interval,
        amount_aoa: Number(plan.price_aoa),
        currency: "AOA",
        starts_at: startsAt.toISOString(),
        current_period_start: startsAt.toISOString(),
        current_period_end: endsAt.toISOString(),
        cancel_at_period_end: false,
        cancelled_at: null,
        provider: "manual",
        metadata: { ...(isObject(before.metadata) ? before.metadata : {}), source: "superadmin_manual_activation", activated_by: actor.id, period_days: periodDays },
        updated_at: startsAt.toISOString(),
      }).eq("id", subscriptionId).select("id,organization_id,plan_id,status,current_period_start,current_period_end,amount_aoa").single();
      if (error) throw error;
      const conversationLimit = Number((plan.limits as Record<string, unknown> | null)?.["ai_conversations_monthly"] ?? 0);
      const { error: creditError } = await db.from("ai_credit_accounts").upsert({
        organization_id: before.organization_id,
        balance: conversationLimit,
        monthly_limit: conversationLimit,
        updated_at: startsAt.toISOString(),
      }, { onConflict: "organization_id" });
      if (creditError) throw creditError;
      const { error: organizationError } = await db.from("organizations").update({
        status: "active", suspended_at: null, suspension_reason: null, updated_at: startsAt.toISOString(),
      }).eq("id", before.organization_id);
      if (organizationError) throw organizationError;
      await audit("subscription.manually_reactivated", "subscription", subscriptionId, before.organization_id, {
        plan_id: plan.id, plan_code: plan.code, period_days: periodDays, amount_aoa: Number(plan.price_aoa),
      });
      return json({ ok: true, data: { ...data, plan_name: plan.name } });
    }


    if (action === "group.commander.list") {
      const [flows, connections, assets, jobs, numbers, steps] = await Promise.all([
        db.from("superadmin_group_flows").select("id,name,description,trigger_mode,is_active,created_at,updated_at").order("created_at", { ascending: false }).limit(200),
        db.from("superadmin_group_connections").select("id,label,whatsapp_number_id,group_jid,group_name,active_flow_id,is_enabled,created_at,whatsapp_numbers(display_name,phone_e164)").order("created_at", { ascending: false }).limit(300),
        db.from("superadmin_group_assets").select("id,name,asset_type,storage_path,mime_type,file_size,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("superadmin_group_jobs").select("id,connection_id,flow_id,step_id,due_at,status,attempts,last_error,created_at,sent_at").order("due_at", { ascending: true }).limit(300),
        db.from("whatsapp_numbers").select("id,organization_id,display_name,phone_e164,provider,status").eq("provider", "qr").is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
        db.from("superadmin_group_flow_steps").select("id,flow_id,position,trigger_mode,delay_minutes,scheduled_at,action_type,text_content,asset_path,asset_mime_type,asset_file_name,caption,status").order("position", { ascending: true }).limit(500),
      ]);
      for (const result of [flows, connections, assets, jobs, numbers, steps]) if (result.error) throw result.error;
      return json({ ok: true, data: { flows: flows.data ?? [], connections: connections.data ?? [], assets: assets.data ?? [], jobs: jobs.data ?? [], numbers: numbers.data ?? [], steps: steps.data ?? [] } });
    }

    if (action === "group.ai.get") {
      const { data, error } = await db.from("superadmin_group_ai_settings")
        .select("id,system_prompt,public_group_rules,private_dm_rules,is_active,updated_by,updated_at").eq("id", 1).maybeSingle();
      if (error) throw error;
      return json({ ok: true, data: data ?? { id: 1, system_prompt: "", public_group_rules: "", private_dm_rules: "", is_active: false, updated_at: null } });
    }

    if (action === "group.ai.save") {
      const systemPrompt = longText(input.system_prompt);
      const publicRules = longText(input.public_group_rules);
      const privateRules = longText(input.private_dm_rules);
      const isActive = input.is_active === true;
      if (isActive && systemPrompt.trim().length < 20) return fail("Para activar a IA do funil, escreve primeiro uma instrução de treino com pelo menos 20 caracteres.");
      const { data, error } = await db.from("superadmin_group_ai_settings").upsert({
        id: 1, system_prompt: systemPrompt, public_group_rules: publicRules,
        private_dm_rules: privateRules, is_active: isActive, updated_by: actor.id, updated_at: new Date().toISOString(),
      }, { onConflict: "id" }).select("id,system_prompt,public_group_rules,private_dm_rules,is_active,updated_by,updated_at").single();
      if (error) throw error;
      await audit("group_ai.settings_saved", "group_ai_settings", "1", null, { is_active: isActive, prompt_length: systemPrompt.length });
      return json({ ok: true, data });
    }

    if (action === "group.asset.upload-url") {
      const fileName = str(input.file_name, 180);
      const mimeType = str(input.mime_type, 120).toLowerCase();
      const fileSize = Number(input.file_size);
      if (!fileName || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024) return fail("O ficheiro deve ter entre 1 byte e 20 MB.");
      const allowed = new Set(["image/jpeg","image/png","image/webp","image/gif","audio/ogg","audio/mpeg","audio/wav","audio/mp4","video/mp4","video/quicktime","video/webm","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation","text/plain","text/csv","application/zip","application/octet-stream"]);
      if (!allowed.has(mimeType)) return fail("Formato de ficheiro não permitido para assets de grupo.");
      const bucket = "superadmin-group-assets";
      const { data: buckets, error: bucketListError } = await db.storage.listBuckets();
      if (bucketListError) throw bucketListError;
      if (!(buckets ?? []).some((item: any) => item.name === bucket)) {
        const { error: createBucketError } = await db.storage.createBucket(bucket, { public: false, fileSizeLimit: 20 * 1024 * 1024, allowedMimeTypes: [...allowed] });
        if (createBucketError && !createBucketError.message.toLowerCase().includes("already exists")) throw createBucketError;
      }
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "asset";
      const storagePath = crypto.randomUUID() + "-" + safeName;
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(storagePath);
      if (error) throw error;
      await audit("group_asset.upload_authorized", "group_asset", null, null, { file_name: fileName, mime_type: mimeType, file_size: fileSize });
      return json({ ok: true, data: { path: storagePath, token: data.token, signedUrl: data.signedUrl } });
    }

    if (action === "group.asset.save") {
      const name = str(input.name, 180);
      const assetType = str(input.asset_type, 20);
      const storagePath = str(input.storage_path, 500);
      const mimeType = str(input.mime_type, 120).toLowerCase();
      const fileSize = Number(input.file_size);
      if (!name || !storagePath || !mimeType || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 20 * 1024 * 1024) return fail("Metadados do asset inválidos.");
      if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) return fail("Caminho do asset inválido.");
      if (!["image","audio","video","document"].includes(assetType)) return fail("Tipo de asset inválido.");
      const { data, error } = await db.from("superadmin_group_assets").insert({ name, asset_type: assetType, storage_path: storagePath, mime_type: mimeType, file_size: fileSize, created_by: actor.id }).select("id,name,asset_type,storage_path,mime_type,file_size,created_at").single();
      if (error) throw error;
      await audit("group_asset.created", "group_asset", data.id, null, { asset_type: assetType, file_size: fileSize });
      return json({ ok: true, data });
    }

    if (action === "group.asset.delete") {
      const id = str(input.id, 60);
      if (!id) return fail("ID do asset inválido.");
      const { data: asset, error: assetError } = await db.from("superadmin_group_assets").select("id,storage_path").eq("id", id).maybeSingle();
      if (assetError) throw assetError;
      if (!asset) return fail("Asset não encontrado.", 404);
      const { error: removeError } = await db.storage.from("superadmin-group-assets").remove([asset.storage_path]);
      if (removeError) throw removeError;
      const { error } = await db.from("superadmin_group_assets").delete().eq("id", id);
      if (error) throw error;
      await audit("group_asset.deleted", "group_asset", id, null, {});
      return json({ ok: true, data: { id } });
    }

    if (action === "group.flow.save") {
      const id = str(input.id, 60);
      const name = str(input.name, 120);
      const description = str(input.description, 1000);
      const triggerMode = str(input.trigger_mode, 20);
      if (name.length < 2 || !["relative", "calendar"].includes(triggerMode)) return fail("Nome ou tipo de gatilho inválido.");
      const patch = { name, description: description || null, trigger_mode: triggerMode, is_active: input.is_active === true, updated_at: new Date().toISOString(), created_by: actor.id };
      const result = id
        ? await db.from("superadmin_group_flows").update({ ...patch, created_by: undefined }).eq("id", id).select("*").single()
        : await db.from("superadmin_group_flows").insert(patch).select("*").single();
      if (result.error) throw result.error;
      await audit(id ? "group_flow.updated" : "group_flow.created", "group_flow", result.data.id, null, { name, trigger_mode: triggerMode });
      return json({ ok: true, data: result.data });
    }

    if (action === "group.connection.save") {
      const id = str(input.id, 60);
      const label = str(input.label, 120);
      const groupJid = str(input.group_jid, 180);
      const groupName = str(input.group_name, 180);
      const numberId = str(input.whatsapp_number_id, 60);
      const flowId = str(input.active_flow_id, 60) || null;
      if (label.length < 2 || !groupJid.endsWith("@g.us") || groupName.length < 2) return fail("Informe um nome e um JID de grupo válido terminado em @g.us.");
      if (numberId) {
        const { data: number, error: numberError } = await db.from("whatsapp_numbers").select("id,provider,status").eq("id", numberId).maybeSingle();
        if (numberError) throw numberError;
        if (!number) return fail("Número WhatsApp não encontrado.");
        if (number.provider !== "qr") return fail("A descoberta e gestão de grupos só está disponível para números ligados por QR/Baileys.");
      }
      if (flowId) {
        const { data: flow, error: flowError } = await db.from("superadmin_group_flows").select("id").eq("id", flowId).maybeSingle();
        if (flowError) throw flowError;
        if (!flow) return fail("Funil não encontrado.");
      }
      const patch = { label, group_jid: groupJid, group_name: groupName, whatsapp_number_id: numberId || null, active_flow_id: flowId, is_enabled: input.is_enabled === true, updated_at: new Date().toISOString(), created_by: actor.id };
      const result = id
        ? await db.from("superadmin_group_connections").update({ ...patch, created_by: undefined }).eq("id", id).select("*").single()
        : await db.from("superadmin_group_connections").insert(patch).select("*").single();
      if (result.error) throw result.error;
      await audit(id ? "group_connection.updated" : "group_connection.created", "group_connection", result.data.id, null, { group_jid: groupJid, enabled: result.data.is_enabled });
      return json({ ok: true, data: result.data });
    }

    if (action === "group.connection.toggle") {
      const id = str(input.id, 60); const enabled = input.is_enabled === true;
      if (!id) return fail("ID do grupo inválido.");
      const { data: before, error: beforeError } = await db.from("superadmin_group_connections")
        .select("id,active_flow_id,whatsapp_number_id,is_enabled").eq("id", id).maybeSingle();
      if (beforeError) throw beforeError;
      if (!before) return fail("Grupo não encontrado.", 404);
      const { data, error } = await db.from("superadmin_group_connections")
        .update({ is_enabled: enabled, updated_at: new Date().toISOString() }).eq("id", id)
        .select("id,group_jid,is_enabled,active_flow_id").single();
      if (error) throw error;
      let queued = 0;
      if (!enabled) {
        const { error: cancelError } = await db.from("superadmin_group_jobs").update({ status: "cancelled", last_error: "Cancelado porque a ligação ao grupo foi desactivada.", updated_at: new Date().toISOString() }).eq("connection_id", id).eq("status", "queued");
        if (cancelError) throw cancelError;
      } else if (data.active_flow_id) {
        const { data: flow, error: flowError } = await db.from("superadmin_group_flows").select("id,is_active,trigger_mode").eq("id", data.active_flow_id).maybeSingle();
        if (flowError) throw flowError;
        if (!flow?.is_active) {
          await db.from("superadmin_group_connections").update({ is_enabled: false, updated_at: new Date().toISOString() }).eq("id", id);
          return fail("Activa primeiro o funil associado; a ligação ao grupo foi mantida desactivada.");
        }
        const { data: steps, error: stepsError } = await db.from("superadmin_group_flow_steps")
          .select("id,flow_id,position,trigger_mode,delay_minutes,scheduled_at,action_type,text_content,asset_path,asset_mime_type,asset_file_name,caption")
          .eq("flow_id", flow.id).order("position", { ascending: true });
        if (stepsError) throw stepsError;
        let cumulativeDelay = 0;
        const now = Date.now();
        for (const step of steps ?? []) {
          let dueAt: Date;
          if (step.trigger_mode === "relative") {
            cumulativeDelay += Math.max(0, Number(step.delay_minutes ?? 0));
            dueAt = new Date(now + cumulativeDelay * 60_000);
          } else {
            if (!step.scheduled_at || !Number.isFinite(Date.parse(step.scheduled_at))) continue;
            dueAt = new Date(step.scheduled_at);
            if (dueAt.getTime() <= now) continue;
          }
          const idempotencyKey = id + ":" + step.id + ":" + dueAt.toISOString();
          const { error: queueError } = await db.from("superadmin_group_jobs").upsert({
            connection_id: id, flow_id: flow.id, step_id: step.id, due_at: dueAt.toISOString(),
            status: "queued", idempotency_key: idempotencyKey,
            payload: { action_type: step.action_type, text_content: step.text_content, asset_path: step.asset_path, asset_mime_type: step.asset_mime_type, asset_file_name: step.asset_file_name, caption: step.caption },
          }, { onConflict: "idempotency_key", ignoreDuplicates: true });
          if (queueError) throw queueError;
          queued += 1;
        }
      }
      await audit("group_connection.toggled", "group_connection", id, null, { enabled, queued });
      return json({ ok: true, data, queued, note: enabled ? (queued ? `Ligação activada e ${queued} etapas colocadas na fila.` : "Ligação activada. Associa um funil activo com etapas para iniciar o calendário.") : "Ligação desactivada; tarefas pendentes canceladas." });
    }

    if (action === "group.flow.delete") {
      const id = str(input.id, 60);
      if (!id) return fail("ID do funil inválido.");
      const { data: flow, error: flowReadError } = await db.from("superadmin_group_flows")
        .select("id,name").eq("id", id).maybeSingle();
      if (flowReadError) throw flowReadError;
      if (!flow) return fail("Funil não encontrado.", 404);
      const { count: processingCount, error: processingError } = await db.from("superadmin_group_jobs")
        .select("id", { count: "exact", head: true }).eq("flow_id", id).eq("status", "processing");
      if (processingError) throw processingError;
      if ((processingCount ?? 0) > 0) return fail("Este funil tem disparos em processamento. Aguarda que terminem antes de o eliminar.");

      // Stop this flow from being used by any group and cancel jobs that could still send its content.
      const { error: disableError } = await db.from("superadmin_group_connections")
        .update({ active_flow_id: null, is_enabled: false, updated_at: new Date().toISOString() })
        .eq("active_flow_id", id);
      if (disableError) throw disableError;
      const { error: cancelError } = await db.from("superadmin_group_jobs")
        .update({ status: "cancelled", last_error: "Cancelado porque o funil foi eliminado.", updated_at: new Date().toISOString() })
        .eq("flow_id", id).eq("status", "queued");
      if (cancelError) throw cancelError;

      const { error: deleteError } = await db.from("superadmin_group_flows").delete().eq("id", id);
      if (deleteError) throw deleteError;
      await audit("group_flow.deleted", "group_flow", id, null, { name: flow.name });
      return json({ ok: true, data: { id, name: flow.name } });
    }

    if (action === "group.connection.assign-flow") {
      const id = str(input.id, 60);
      const flowId = str(input.active_flow_id, 60) || null;
      if (!id) return fail("ID do grupo inválido.");
      const { data: connection, error: connectionError } = await db.from("superadmin_group_connections")
        .select("id,group_name,active_flow_id,is_enabled,whatsapp_number_id")
        .eq("id", id).maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) return fail("Grupo não encontrado.", 404);

      let flow: any = null;
      if (flowId) {
        const { data, error } = await db.from("superadmin_group_flows")
          .select("id,name,is_active,trigger_mode").eq("id", flowId).maybeSingle();
        if (error) throw error;
        if (!data) return fail("Funil não encontrado.", 404);
        flow = data;
      }

      // Cancel queued jobs from the previous assignment before changing the target flow.
      const { error: cancelError } = await db.from("superadmin_group_jobs")
        .update({ status: "cancelled", last_error: "Cancelado porque o funil associado ao grupo foi alterado.", updated_at: new Date().toISOString() })
        .eq("connection_id", id).eq("status", "queued");
      if (cancelError) throw cancelError;

      const keepEnabled = Boolean(connection.is_enabled && flow?.is_active);
      const { data: updated, error: updateError } = await db.from("superadmin_group_connections")
        .update({ active_flow_id: flowId, is_enabled: keepEnabled, updated_at: new Date().toISOString() })
        .eq("id", id).select("id,group_name,active_flow_id,is_enabled").single();
      if (updateError) throw updateError;

      let queued = 0;
      if (keepEnabled && flow) {
        const { data: steps, error: stepsError } = await db.from("superadmin_group_flow_steps")
          .select("id,flow_id,position,trigger_mode,delay_minutes,scheduled_at,action_type,text_content,asset_path,asset_mime_type,asset_file_name,caption")
          .eq("flow_id", flow.id).order("position", { ascending: true });
        if (stepsError) throw stepsError;
        let cumulativeDelay = 0;
        const now = Date.now();
        for (const step of steps ?? []) {
          let dueAt: Date;
          if (step.trigger_mode === "relative") {
            cumulativeDelay += Math.max(0, Number(step.delay_minutes ?? 0));
            dueAt = new Date(now + cumulativeDelay * 60_000);
          } else {
            if (!step.scheduled_at || !Number.isFinite(Date.parse(step.scheduled_at))) continue;
            dueAt = new Date(step.scheduled_at);
            if (dueAt.getTime() <= now) continue;
          }
          const idempotencyKey = id + ":" + step.id + ":" + dueAt.toISOString();
          const { error: queueError } = await db.from("superadmin_group_jobs").upsert({
            connection_id: id, flow_id: flow.id, step_id: step.id, due_at: dueAt.toISOString(),
            status: "queued", idempotency_key: idempotencyKey,
            payload: { action_type: step.action_type, text_content: step.text_content, asset_path: step.asset_path, asset_mime_type: step.asset_mime_type, asset_file_name: step.asset_file_name, caption: step.caption },
            updated_at: new Date().toISOString(),
          }, { onConflict: "idempotency_key", ignoreDuplicates: true });
          if (queueError) throw queueError;
          queued += 1;
        }
      }

      await audit("group_connection.flow_assigned", "group_connection", id, null, {
        group_name: connection.group_name, from_flow_id: connection.active_flow_id,
        to_flow_id: flowId, enabled: keepEnabled, queued,
      });
      return json({
        ok: true,
        data: updated,
        queued,
        note: !flowId ? "Associação removida; o grupo ficou desactivado e as tarefas pendentes foram canceladas."
          : !flow?.is_active ? "Funil associado. Como está em rascunho, o grupo ficou desactivado até o funil ser activado."
          : connection.is_enabled ? "Funil alterado e tarefas do novo funil colocadas na fila."
          : "Funil associado. O grupo continua desactivado; activa-o quando estiver pronto.",
      });
    }

    if (action === "group.flow.toggle") {
      const id = str(input.id, 60); const active = input.is_active === true;
      if (!id) return fail("ID do funil inválido.");
      const { data, error } = await db.from("superadmin_group_flows").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).select("id,name,is_active").single();
      if (error) throw error;
      if (!active) {
        const { error: cancelError } = await db.from("superadmin_group_jobs").update({ status: "cancelled", last_error: "Cancelado porque o funil foi pausado.", updated_at: new Date().toISOString() }).eq("flow_id", id).eq("status", "queued");
        if (cancelError) throw cancelError;
      }
      await audit("group_flow.toggled", "group_flow", id, null, { active });
      return json({ ok: true, data });
    }
    if (action === "group.step.save") {
      const id = str(input.id, 60);
      const flowId = str(input.flow_id, 60);
      const position = Number(input.position);
      const triggerMode = str(input.trigger_mode, 20);
      const actionType = str(input.action_type, 20);
      const delayMinutes = input.delay_minutes === null || input.delay_minutes === undefined || input.delay_minutes === "" ? null : Number(input.delay_minutes);
      const scheduledAt = str(input.scheduled_at, 80) || null;
      const textContent = str(input.text_content, 4000);
      const assetPath = str(input.asset_path, 500) || null;
      const mimeType = str(input.asset_mime_type, 120) || null;
      const fileName = str(input.asset_file_name, 180) || null;
      const caption = str(input.caption, 2000) || null;
      if (!flowId || !Number.isInteger(position) || position < 0 || !["relative", "calendar"].includes(triggerMode) || !["text", "ai_text", "image", "audio", "video", "document"].includes(actionType)) return fail("Configuração da etapa inválida.");
      if (triggerMode === "relative" && (!Number.isInteger(delayMinutes) || Number(delayMinutes) < 0)) return fail("O atraso deve ser um número de minutos igual ou superior a zero.");
      if (triggerMode === "calendar" && (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt)))) return fail("Escolha uma data e hora válidas.");
      if ((actionType === "text" || actionType === "ai_text") && !textContent) return fail("A etapa precisa de texto ou de uma instrução para a IA.");
      if (actionType !== "text" && actionType !== "ai_text" && (!assetPath || !mimeType)) return fail("As etapas multimédia precisam de um ficheiro guardado e MIME type.");
      const patch = { flow_id: flowId, position, trigger_mode: triggerMode, delay_minutes: delayMinutes, scheduled_at: scheduledAt, action_type: actionType, text_content: textContent || null, asset_path: assetPath, asset_mime_type: mimeType, asset_file_name: fileName, caption, status: "draft", updated_at: new Date().toISOString() };
      const result = id
        ? await db.from("superadmin_group_flow_steps").update(patch).eq("id", id).select("*").single()
        : await db.from("superadmin_group_flow_steps").insert(patch).select("*").single();
      if (result.error) throw result.error;
      await audit(id ? "group_flow_step.updated" : "group_flow_step.created", "group_flow_step", result.data.id, null, { flow_id: flowId, action_type: actionType });
      return json({ ok: true, data: result.data });
    }

    if (action === "group.job.schedule") {
      const connectionId = str(input.connection_id, 60);
      const stepId = str(input.step_id, 60);
      const dueAt = str(input.due_at, 80);
      if (!connectionId || !stepId || !Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.now()) return fail("Escolha um grupo, uma etapa e uma data futura.");
      const [connection, step] = await Promise.all([
        db.from("superadmin_group_connections").select("id,active_flow_id,is_enabled").eq("id", connectionId).maybeSingle(),
        db.from("superadmin_group_flow_steps").select("*").eq("id", stepId).maybeSingle(),
      ]);
      if (connection.error) throw connection.error;
      if (step.error) throw step.error;
      if (!connection.data || !step.data) return fail("Grupo ou etapa não encontrado.");
      if (!connection.data.is_enabled) return fail("Ative explicitamente a ligação ao grupo antes de agendar.");
      if (connection.data.active_flow_id !== step.data.flow_id) return fail("A etapa não pertence ao funil activo deste grupo.");
      const key = connectionId + ":" + stepId + ":" + new Date(dueAt).toISOString();
      const result = await db.from("superadmin_group_jobs").upsert({
        connection_id: connectionId, flow_id: step.data.flow_id, step_id: stepId, due_at: new Date(dueAt).toISOString(),
        status: "queued", idempotency_key: key, payload: { action_type: step.data.action_type, text_content: step.data.text_content, asset_path: step.data.asset_path, asset_mime_type: step.data.asset_mime_type, asset_file_name: step.data.asset_file_name, caption: step.data.caption },
      }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("*").maybeSingle();
      if (result.error) throw result.error;
      await audit("group_job.scheduled", "group_job", result.data?.id ?? null, null, { connection_id: connectionId, step_id: stepId, due_at: dueAt });
      return json({ ok: true, data: result.data, queued: true, note: "A tarefa foi colocada na fila de envio do motor WhatsApp no Railway." });
    }

    if (action === "email.logs.resend") {
      const logId = str(input.log_id, 100);
      if (!logId) return fail("Identificador do e-mail em falta.", 400);
      let log: any = null;
      if (logId.startsWith("brevo:")) {
        // A Brevo event by itself is not enough to reconstruct a safe transactional email.
        // Match it to the original WhappNus delivery record using the provider's message ID.
        const providerMessageId = logId.slice("brevo:".length);
        if (!providerMessageId) return fail("O evento da Brevo não contém um identificador de mensagem reenviável.", 400);
        const { data: localLog, error: localError } = await db.from("email_delivery_logs")
          .select("id,recipient_email,template_code,status,metadata,provider,organization_id,provider_message_id")
          .eq("provider_message_id", providerMessageId).maybeSingle();
        if (localError) throw localError;
        log = localLog;
        if (!log) return fail("Este evento da Brevo não tem um registo original WhappNus associado. Por segurança, não é possível reconstruir o conteúdo correcto para reenviar.", 404);
      } else {
        const { data: localLog, error: logError } = await db.from("email_delivery_logs")
          .select("id,recipient_email,template_code,status,metadata,provider,organization_id,provider_message_id")
          .eq("id", logId).maybeSingle();
        if (logError) throw logError;
        log = localLog;
      }
      if (!log) return fail("O registo local deste e-mail não foi encontrado.", 404);
      const template = str(log.template_code, 80);
      const allowedTemplates = ["welcome", "payment_pending", "payment_approved", "subscription_renewed", "plan_changed", "payment_cancelled", "payment_refunded", "subscription_expiring", "subscription_expired"];
      if (!allowedTemplates.includes(template)) return fail("Este tipo de e-mail não pode ser reenviado por esta ação. As confirmações e recuperações de conta exigem um link seguro novo.", 400);
      const recipient = str(log.recipient_email, 320);
      if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return fail("O destinatário não está disponível neste registo.", 400);
      const dispatchSecret = Deno.env.get("EMAIL_DISPATCH_SECRET") ?? "";
      if (!dispatchSecret) return fail("Falta configurar EMAIL_DISPATCH_SECRET nos segredos do Supabase para autorizar o envio seguro.", 503);
      const metadata = isObject(log.metadata) ? log.metadata : {};
      const vars = isObject(metadata.template_vars) ? metadata.template_vars : isObject(metadata.vars) ? metadata.vars : {};
      const name = str(metadata.name ?? metadata.customer_name, 200);
      const dispatch = await fetch("https://whappnus.online/api/public/email/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-email-secret": dispatchSecret },
        body: JSON.stringify({ template, to: recipient, ...(name ? { name } : {}), vars, idempotency_key: `manual-resend-${log.id}-${Date.now()}` }),
        signal: AbortSignal.timeout(20000),
      });
      const dispatchBody = await dispatch.json().catch(() => ({}));
      if (!dispatch.ok || dispatchBody?.ok !== true) {
        const message = str(dispatchBody?.error, 200) || `O serviço de envio respondeu ${dispatch.status}.`;
        await db.from("email_delivery_logs").update({ status: "failed", error_message: `Reenvio manual falhou: ${message}`, updated_at: new Date().toISOString() }).eq("id", log.id);
        await audit("email.logs.resend_failed", "email", log.id, log.organization_id ?? null, { template, recipient, error: message });
        return fail(`Não foi possível reenviar: ${message}`, 502);
      }
      await audit("email.logs.resend", "email", log.id, log.organization_id ?? null, { template, recipient, new_message_id: dispatchBody.messageId ?? null });
      return json({ ok: true, data: { messageId: dispatchBody.messageId ?? null, recipient, template } });
    }

    if (action === "email.logs.list") {
      const search = str(input.search, 160).toLowerCase();
      const status = str(input.status, 30);
      const template = str(input.template, 80);
      let query = db.from("email_delivery_logs")
        .select("id,provider,provider_message_id,recipient_hash,recipient_email,template_code,event_type,status,error_message,metadata,organization_id,created_at,sent_at,updated_at")
        .order("created_at", { ascending: false }).limit(300);
      if (status && status !== "all") query = query.eq("status", status);
      if (template && template !== "all") query = query.eq("template_code", template);
      if (search) query = query.or(`recipient_email.ilike.%${search.replace(/[,%()]/g, "")}%,template_code.ilike.%${search.replace(/[,%()]/g, "")}%,event_type.ilike.%${search.replace(/[,%()]/g, "")}%,provider_message_id.ilike.%${search.replace(/[,%()]/g, "")}%`);
      const { data, error } = await query;
      if (error) throw error;
      const orgIds = [...new Set((data ?? []).map((row: any) => row.organization_id).filter(Boolean))];
      const orgResult = orgIds.length ? await db.from("organizations").select("id,name").in("id", orgIds) : { data: [], error: null };
      if (orgResult.error) throw orgResult.error;
      const orgNames = new Map((orgResult.data ?? []).map((row: any) => [row.id, row.name]));
      const logged = (data ?? []).map((row: any) => ({
        ...row, organization_name: orgNames.get(row.organization_id) ?? null, source: "whappnus",
      }));

      // Brevo is the source of truth for actual provider events, including messages sent by Supabase Auth over Brevo SMTP.
      // Keep the API key only in Supabase Edge Function secrets; never return it to the browser.
      const brevoKey = Deno.env.get("BREVO_API_KEY") ?? "";
      let providerEvents: any[] = [];
      let providerError: string | null = null;
      if (brevoKey) {
        try {
          const url = new URL("https://api.brevo.com/v3/smtp/statistics/events");
          url.searchParams.set("limit", "100");
          url.searchParams.set("sort", "desc");
          const response = await fetch(url, { headers: { "api-key": brevoKey, "accept": "application/json" }, signal: AbortSignal.timeout(12000) });
          if (response.ok) {
            const body: any = await response.json();
            const events = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];
            providerEvents = events.map((event: any, i: number) => {
              const raw = String(event.event ?? event.type ?? "unknown").toLowerCase();
              const subject = String(event.subject ?? "");
              const rawTags = Array.isArray(event.tags) ? event.tags.map((tag: unknown) => String(tag)) : [];
              const tagText = [event.tag, ...rawTags].filter(Boolean).join(" ").toLowerCase();
              // Prefer explicit application tags; use the subject only as a fallback.
              const subjectCode = /auth_confirm_signup|confirm.?signup|confirmation/i.test(tagText) || /confirm|confirmar|bem-vindo|welcome/i.test(subject) ? "auth_confirm_signup" :
                /auth_reset_password|reset.?password/i.test(tagText) || /password|palavra-passe|recuperar/i.test(subject) ? "auth_reset_password" :
                /payment_pending/i.test(tagText) || /pagamento pendente|payment pending/i.test(subject) ? "payment_pending" :
                /payment_approved/i.test(tagText) || /pagamento confirmado|payment approved/i.test(subject) ? "payment_approved" :
                /subscription_renewed/i.test(tagText) || /renova/i.test(subject) ? "subscription_renewed" :
                /plan_changed/i.test(tagText) || /plano.*alterado/i.test(subject) ? "plan_changed" :
                /payment_cancelled/i.test(tagText) || /pagamento cancelado/i.test(subject) ? "payment_cancelled" :
                /payment_refunded/i.test(tagText) || /reembolso|refunded/i.test(subject) ? "payment_refunded" :
                /subscription_expiring/i.test(tagText) || /a expirar|expiring/i.test(subject) ? "subscription_expiring" :
                /subscription_expired/i.test(tagText) || /plano expirado|subscription expired/i.test(subject) ? "subscription_expired" :
                /welcome/i.test(tagText) ? "welcome" : "unknown";
              const mappedStatus = raw === "delivered" ? "delivered" :
                ["hardbounce","softbounce","blocked","invalid","deferred","error"].includes(raw.replace(/[^a-z]/g, "")) ? "bounced" :
                ["spam","complaint"].includes(raw) ? "complained" :
                ["request","sent","click","opened","unique_opened"].includes(raw) ? "sent" : raw;
              return {
                id: `brevo:${event.messageId ?? event.message_id ?? event.id ?? i}`,
                provider: "brevo",
                provider_message_id: event.messageId ?? event.message_id ?? null,
                recipient_email: event.email ?? event.recipient ?? null,
                template_code: subjectCode !== "unknown" ? subjectCode : (event.tag ?? event.tags?.[0] ?? "unknown"),
                event_type: event.event ?? event.type ?? "unknown",
                status: mappedStatus,
                error_message: event.reason ?? event.error ?? null,
                organization_id: null,
                organization_name: "Brevo",
                created_at: event.date ?? event.ts ?? event.timestamp ?? null,
                sent_at: event.date ?? event.ts ?? event.timestamp ?? null,
                source: "brevo",
                metadata: { subject: event.subject ?? null, link: event.link ?? null, tag: event.tag ?? null, tags: rawTags },
              };
            });
          } else {
            providerError = `Brevo API respondeu ${response.status}`;
            console.warn("[superadmin-api] Brevo events unavailable", providerError);
          }
        } catch (e) {
          providerError = "Não foi possível consultar os eventos da Brevo.";
          console.warn("[superadmin-api] Brevo events request failed");
        }
      } else {
        providerError = "Falta configurar BREVO_API_KEY nos segredos das Edge Functions do Supabase.";
      }
      const merged = [...providerEvents, ...logged]
        .filter((row: any) => !search || [row.recipient_email, row.template_code, row.event_type, row.provider_message_id].some((value) => String(value ?? "").toLowerCase().includes(search)))
        .filter((row: any) => !status || status === "all" || row.status === status)
        .filter((row: any) => !template || template === "all" || row.template_code === template)
        .sort((a: any, b: any) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""));
      return json({ ok: true, data: { rows: merged.slice(0, 300), meta: { brevo_configured: Boolean(brevoKey), brevo_error: providerError, brevo_events: providerEvents.length, app_logs: logged.length } } });
    }

    if (action === "payments.list") {
      const { data, error } = await db.from("payment_transactions")
        .select("id,organization_id,subscription_id,provider,provider_payment_id,status,amount_aoa,currency,description,paid_at,failure_code,created_at,organizations(name,slug)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (action === "health") {
      const [sessions, aiLogs, events] = await Promise.all([
        db.from("whatsapp_sessions").select("id,organization_id,whatsapp_number_id,provider,status,phone_number,display_name,last_connected_at,last_disconnected_at,last_error,updated_at").order("updated_at", { ascending: false }).limit(50),
        db.from("ai_logs").select("id,organization_id,event_type,status,provider,model,latency_ms,created_at").order("created_at", { ascending: false }).limit(50),
        db.from("whatsapp_events").select("id,organization_id,provider,event_type,created_at").order("created_at", { ascending: false }).limit(30),
      ]);
      if (sessions.error) throw sessions.error; if (aiLogs.error) throw aiLogs.error; if (events.error) throw events.error;
      const orgIds = [...new Set((sessions.data ?? []).map((row: any) => row.organization_id).filter(Boolean))];
      const [orgs, numbers] = await Promise.all([
        orgIds.length ? db.from("organizations").select("id,name,slug").in("id", orgIds) : { data: [], error: null },
        orgIds.length ? db.from("whatsapp_numbers").select("id,organization_id,phone_e164,display_name,verified_name").in("organization_id", orgIds) : { data: [], error: null },
      ]);
      if (orgs.error) throw orgs.error; if (numbers.error) throw numbers.error;
      const orgById = new Map((orgs.data ?? []).map((o: any) => [o.id, o]));
      const numberById = new Map((numbers.data ?? []).map((n: any) => [n.id, n]));
      const orgNames = new Map((orgs.data ?? []).map((o: any) => [o.id, o.name]));
      return json({ ok: true, data: {
        sessions: (sessions.data ?? []).map((row: any) => ({ ...row, organization: orgById.get(row.organization_id) ?? null, number: numberById.get(row.whatsapp_number_id) ?? null })),
        aiLogs: (aiLogs.data ?? []).map((row: any) => ({ ...row, organization_name: orgNames.get(row.organization_id) ?? null })),
        events: (events.data ?? []).map((row: any) => ({ ...row, organization_name: orgNames.get(row.organization_id) ?? null })),
      } });
    }


    if (action === "team.list") {
      const { data, error } = await db.from("superadmin_users")
        .select("user_id,role,permissions,is_active,created_at,updated_at,created_by")
        .order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      const users = await Promise.all((data ?? []).map(async (row: any) => {
        const { data: result } = await db.auth.admin.getUserById(row.user_id);
        return { ...row, email: result.user?.email ?? null, full_name: result.user?.user_metadata?.full_name ?? null };
      }));
      return json({ ok: true, data: users });
    }

    if (action === "team.save") {
      const userId = str(input.user_id, 60);
      const role = str(input.role, 30);
      const isActive = input.is_active !== false;
      const permissions = isObject(input.permissions) ? input.permissions : {};
      if (role !== "owner" && permissions["*"] === true) return fail("A permissão global só pode ser atribuída ao proprietário.");
      if (!userId || !/^[0-9a-fA-F-]{36}$/.test(userId)) return fail("UUID do utilizador inválido.");
      if (!["owner", "admin", "support", "billing"].includes(role)) return fail("Função administrativa inválida.");
      const { data: target, error: targetError } = await db.auth.admin.getUserById(userId);
      if (targetError || !target.user) return fail("Não foi encontrada uma conta com esse UUID.");
      if (userId === actor.id && (!isActive || role !== "owner")) return fail("Não podes remover nem despromover a tua própria conta de proprietário.");
      const { data: current, error: currentError } = await db.from("superadmin_users")
        .select("user_id,role,is_active").eq("user_id", userId).maybeSingle();
      if (currentError) throw currentError;
      if (current?.role === "owner" && current.is_active && (role !== "owner" || !isActive)) {
        const { count: ownerCount, error: countError } = await db.from("superadmin_users")
          .select("user_id", { count: "exact", head: true }).eq("role", "owner").eq("is_active", true);
        if (countError) throw countError;
        if ((ownerCount ?? 0) <= 1) return fail("A plataforma precisa de manter pelo menos um proprietário ativo.");
      }
      const { data, error } = await db.from("superadmin_users").upsert({
        user_id: userId, role, permissions, is_active: isActive, created_by: current ? undefined : actor.id,
      }, { onConflict: "user_id" }).select("user_id,role,permissions,is_active,created_at,updated_at,created_by").single();
      if (error) throw error;
      await audit(current ? "admin.updated" : "admin.created", "platform_admin", userId, null, { role, is_active: isActive });
      return json({ ok: true, data: { ...data, email: target.user.email ?? null, full_name: target.user.user_metadata?.full_name ?? null } });
    }

    if (action === "audit.list") {
      const { data, error } = await db.from("superadmin_audit_logs").select("id,actor_user_id,action,target_type,target_id,organization_id,request_id,details,created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const actorIds = [...new Set((data ?? []).map((r: any) => r.actor_user_id).filter(Boolean))];
      const orgIds = [...new Set((data ?? []).map((r: any) => r.organization_id).filter(Boolean))];
      const [profiles, orgs] = await Promise.all([
        actorIds.length ? db.from("profiles").select("id,full_name,email").in("id", actorIds) : { data: [], error: null },
        orgIds.length ? db.from("organizations").select("id,name").in("id", orgIds) : { data: [], error: null },
      ]);
      if (profiles.error) throw profiles.error; if (orgs.error) throw orgs.error;
      const profileById = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
      const orgById = new Map((orgs.data ?? []).map((o: any) => [o.id, o.name]));
      const authRows = await Promise.all(actorIds.map(async (id) => { const { data: result } = await db.auth.admin.getUserById(id); return [id, result.user ?? null] as const; }));
      const authById = new Map(authRows);
      const actionLabels: Record<string, string> = {
        "group_job.scheduled": "Agendou uma mensagem de grupo", "group_connection.toggled": "Alterou a ligação de um grupo",
        "group_flow.created": "Criou um funil de mensagens", "group_flow.updated": "Editou um funil de mensagens",
        "group_flow.toggled": "Activou ou pausou um funil", "group_flow_step.created": "Criou uma etapa do funil",
        "group_flow_step.updated": "Editou uma etapa do funil", "admin.created": "Adicionou um administrador",
        "admin.updated": "Actualizou as permissões de um administrador", "organization.created": "Criou uma organização",
        "organization.status_changed": "Alterou o estado de uma organização", "plan.created": "Criou um plano",
        "plan.updated": "Actualizou um plano", "plan.deleted": "Eliminou um plano",
        "notification.sent": "Enviou uma notificação", "subscription.reactivated": "Reactivou uma assinatura",
        "group_asset.created": "Adicionou um ficheiro ao banco multimédia", "group_asset.deleted": "Eliminou um ficheiro do banco multimédia",
      };
      return json({ ok: true, data: (data ?? []).map((row: any) => {
        const profile = profileById.get(row.actor_user_id); const authUser = authById.get(row.actor_user_id);
        return { ...row, action_label: actionLabels[row.action] ?? row.action.replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          actor_name: profile?.full_name ?? authUser?.user_metadata?.full_name ?? authUser?.email ?? "Sistema",
          actor_email: profile?.email ?? authUser?.email ?? null, organization_name: orgById.get(row.organization_id) ?? null,
          target_label: row.target_type === "group_job" ? "Mensagem agendada" : row.target_type === "platform_admin" ? "Administrador" : row.target_type === "subscription_plan" ? "Plano" : row.target_type === "organization" ? "Organização" : row.target_type.replace(/_/g, " "),
        };
      }) });
    }

    return fail("Ação desconhecida.");
  } catch (error) {
    console.error("superadmin-api failure", { action, message: error instanceof Error ? error.message : "unknown" });
    return fail(error instanceof Error ? error.message : "Erro interno ao processar o pedido.", 500);
  }
});
