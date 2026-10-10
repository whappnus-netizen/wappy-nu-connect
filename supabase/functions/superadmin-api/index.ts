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
      admin.role === "billing" && ["plans.list", "plans.save", "subscriptions.list", "payments.list", "dashboard"].includes(permission) ||
      admin.role === "support" && ["organizations.list", "plans.list", "subscriptions.list", "payments.list", "health", "dashboard"].includes(permission) ||
      permissions[permission] === true;
  };
  if (!action) return fail("Ação não especificada.");
  if (!can(action)) return fail("Não tens permissão para esta operação.", 403);
  if (action === "team.save" && admin.role !== "owner") return fail("Só o proprietário da plataforma pode alterar administradores.", 403);

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
        .select("id,name,slug,status,management_mode,suspension_reason,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(200);
      if (search) query = query.or(`name.ilike.%${search.replace(/[,%()]/g, "")}%,slug.ilike.%${search.replace(/[,%()]/g, "")}%`);
      const { data, error } = await query;
      if (error) throw error;
      const ids = (data ?? []).map((row: any) => row.id);
      if (!ids.length) return json({ ok: true, data: [] });
      const [members, numbers, agents] = await Promise.all([
        db.from("memberships").select("organization_id").in("organization_id", ids),
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
      return json({ ok: true, data: (data ?? []).map((row: any) => ({
        ...row, members_count: memberCounts[row.id] ?? 0, whatsapp_count: numberCounts[row.id] ?? 0,
        ai_agents_active: activeAgents[row.id] ?? 0,
        whatsapp_statuses: (numbers.data ?? []).filter((n: any) => n.organization_id === row.id).map((n: any) => ({ status: n.status, phone_e164: n.phone_e164, display_name: n.display_name })),
      })) });
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
        .select("id,organization_id,plan_id,status,billing_interval,amount_aoa,currency,starts_at,current_period_start,current_period_end,cancel_at_period_end,provider,created_at,organizations(name,slug),subscription_plans(name,code)")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
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
      if (sessions.error) throw sessions.error;
      if (aiLogs.error) throw aiLogs.error;
      if (events.error) throw events.error;
      return json({ ok: true, data: { sessions: sessions.data ?? [], aiLogs: aiLogs.data ?? [], events: events.data ?? [] } });
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
      const { data, error } = await db.from("superadmin_audit_logs")
        .select("id,actor_user_id,action,target_type,target_id,organization_id,request_id,details,created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    return fail("Ação desconhecida.");
  } catch (error) {
    console.error("superadmin-api failure", { action, message: error instanceof Error ? error.message : "unknown" });
    return fail(error instanceof Error ? error.message : "Erro interno ao processar o pedido.", 500);
  }
});
