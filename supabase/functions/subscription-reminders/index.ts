import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8" },
});
const hour = 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-reminder-secret",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  }});
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ ok: false, error: "Configuração Supabase incompleta." }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const suppliedSecret = req.headers.get("x-reminder-secret") ?? "";
  const { data: reminderConfig, error: configError } = await db.from("subscription_reminder_config")
    .select("secret_hash").eq("id", true).maybeSingle();
  if (configError || !reminderConfig?.secret_hash) return json({ ok: false, error: "Configuração segura dos avisos não encontrada." }, 500);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(suppliedSecret));
  const suppliedHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!suppliedSecret || suppliedHash !== reminderConfig.secret_hash) return json({ ok: false, error: "Não autorizado." }, 401);

  const engineUrl = "https://whappnus-whatsapp-engine-production.up.railway.app";

  const now = new Date();
  const lower = new Date(now.getTime() + 48 * hour).toISOString();
  const upper = new Date(now.getTime() + 96 * hour).toISOString();
  const result = { scanned: 0, whatsapp_sent: 0, queued_or_failed: 0, expired_notices: 0, skipped_duplicates: 0, errors: [] as string[] };

  const { data: expiring, error: expiringError } = await db.from("organization_subscriptions")
    .select("id,organization_id,status,current_period_end,subscription_plans(name,price_aoa)")
    .in("status", ["active", "trialing"]).gte("current_period_end", lower).lte("current_period_end", upper)
    .order("current_period_end", { ascending: true }).limit(500);
  if (expiringError) return json({ ok: false, error: expiringError.message }, 500);

  const templates = [
    (org: string, plan: string, end: string) => `Olá! Aqui é a equipa WhappNus. A assinatura ${plan} da organização ${org} termina em ${end}, dentro de poucos dias. Para manter o atendimento com IA e as automações sem interrupção, renove antes da data indicada. Estamos disponíveis para ajudar.`,
    (org: string, plan: string, end: string) => `Lembrete WhappNus: o plano ${plan} de ${org} está perto de terminar (${end}). Renove a sua assinatura atempadamente para continuar a usar os recursos contratados. Se precisar de apoio, responda a esta mensagem.`,
    (org: string, plan: string, end: string) => `Prezado cliente WhappNus, a sua assinatura ${plan} termina no dia ${end}. Recomendamos que trate da renovação antes dessa data para evitar uma pausa nos recursos do plano. A nossa equipa está disponível para esclarecer qualquer dúvida.`,
    (org: string, plan: string, end: string) => `Atenção, ${org}: faltam poucos dias para terminar a sua assinatura WhappNus ${plan} (${end}). Para manter o serviço activo, planeie a renovação com antecedência. Obrigado por confiar na WhappNus!`,
  ];

  for (const sub of expiring ?? []) {
    result.scanned += 1;
    const orgResult = await db.from("organizations").select("id,name,contact_phone").eq("id", sub.organization_id).maybeSingle();
    if (orgResult.error || !orgResult.data) { result.errors.push(`Organização ${sub.organization_id}: não foi possível obter os dados.`); continue; }
    const org = orgResult.data;
    const endDate = new Date(sub.current_period_end).toLocaleDateString("pt-AO", { timeZone: "Africa/Luanda" });
    const planName = (sub.subscription_plans as any)?.name ?? "WhappNus";
    const hoursRemaining = (new Date(sub.current_period_end).getTime() - now.getTime()) / hour;
    const reminderDays = hoursRemaining <= 72 ? 3 : 4;
    if (reminderDays === 3) {
      const { data: dayFour } = await db.from("subscription_reminder_logs").select("status")
        .eq("subscription_id", sub.id).eq("reminder_days", 4).maybeSingle();
      if (dayFour?.status === "sent") { result.skipped_duplicates += 1; continue; }
    }
    const templateIndex = (now.getUTCDate() + org.name.length + reminderDays) % templates.length;
    const message = templates[templateIndex](org.name, planName, endDate);

    const { data: inserted, error: logError } = await db.from("subscription_reminder_logs").upsert({
      organization_id: org.id, subscription_id: sub.id, reminder_days: reminderDays, status: "queued",
      message, updated_at: now.toISOString(),
    }, { onConflict: "subscription_id,reminder_days", ignoreDuplicates: true }).select("id").maybeSingle();
    if (logError) { result.errors.push(`Registo de aviso ${sub.id}: ${logError.message}`); continue; }
    if (!inserted?.id) { result.skipped_duplicates += 1; continue; }

    const ownerResult = await db.from("memberships").select("user_id").eq("organization_id", org.id).eq("role", "OWNER").limit(1).maybeSingle();
    let owner: any = null;
    if (ownerResult.data?.user_id) {
      const { data } = await db.auth.admin.getUserById(ownerResult.data.user_id);
      owner = data.user;
    }
    const metadata = owner?.user_metadata ?? {};
    const recipientPhone = String(org.contact_phone ?? metadata.phone ?? metadata.phone_number ?? owner?.phone ?? "").trim();
    const sessionResult = await db.from("whatsapp_sessions")
      .select("whatsapp_number_id,phone_number,display_name").eq("organization_id", org.id)
      .eq("status", "connected").not("whatsapp_number_id", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const session = sessionResult.data;
    if (!recipientPhone || !session?.whatsapp_number_id) {
      const reason = !recipientPhone ? "Falta o WhatsApp de contacto do proprietário." : "Não existe sessão WhatsApp ligada para esta organização.";
      await db.from("subscription_reminder_logs").update({ status: "failed", recipient_phone: recipientPhone || null, whatsapp_number_id: session?.whatsapp_number_id ?? null, error_message: reason, updated_at: new Date().toISOString() }).eq("id", inserted.id);
      await db.from("organization_notifications").insert({ organization_id: org.id, title: "A sua assinatura está perto de terminar", body: message, notification_type: "subscription", metadata: { source: "subscription-reminder", reminder_days: reminderDays } });
      result.queued_or_failed += 1;
      continue;
    }

    try {
      const sessionId = `${org.id}:${session.whatsapp_number_id}`;
      const response = await fetch(`${engineUrl}/internal/subscription-reminder`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ sessionId, to: recipientPhone, body: message }),
        signal: AbortSignal.timeout(20000),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok || responseBody?.ok !== true) throw new Error(`WhatsApp Engine HTTP ${response.status}: ${String(responseBody?.error ?? "envio não confirmado").slice(0, 240)}`);
      await db.from("subscription_reminder_logs").update({ status: "sent", recipient_phone: recipientPhone, whatsapp_number_id: session.whatsapp_number_id, sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq("id", inserted.id);
      await db.from("organization_notifications").insert({ organization_id: org.id, title: "A sua assinatura está perto de terminar", body: message, notification_type: "subscription", metadata: { source: "subscription-reminder", reminder_days: reminderDays, whatsapp_sent: true } });
      result.whatsapp_sent += 1;
    } catch (error) {
      const messageError = error instanceof Error ? error.message : String(error);
      await db.from("subscription_reminder_logs").update({ status: "failed", recipient_phone: recipientPhone, whatsapp_number_id: session.whatsapp_number_id, error_message: messageError.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", inserted.id);
      await db.from("organization_notifications").insert({ organization_id: org.id, title: "A sua assinatura está perto de terminar", body: message, notification_type: "subscription", metadata: { source: "subscription-reminder", reminder_days: reminderDays, whatsapp_sent: false } });
      result.queued_or_failed += 1;
      result.errors.push(`${org.name}: ${messageError}`);
    }
  }

  // Notificar uma única vez quando a assinatura já expirou. Não envia WhatsApp depois do prazo.
  const { data: expired, error: expiredError } = await db.from("organization_subscriptions")
    .select("id,organization_id,status,current_period_end,subscription_plans(name)")
    .in("status", ["active", "trialing", "expired"]).lt("current_period_end", now.toISOString()).limit(500);
  if (expiredError) result.errors.push("Consulta de assinaturas expiradas: " + expiredError.message);
  for (const sub of expired ?? []) {
    const orgResult = await db.from("organizations").select("id,name").eq("id", sub.organization_id).maybeSingle();
    if (!orgResult.data) continue;
    const message = `A assinatura da organização ${orgResult.data.name} expirou. Os dados continuam guardados, mas os recursos sujeitos ao plano podem ficar limitados. Renove a assinatura para voltar a utilizar os recursos contratados.`;
    const { data: inserted } = await db.from("subscription_reminder_logs").upsert({
      organization_id: sub.organization_id, subscription_id: sub.id, reminder_days: 0,
      status: "skipped", message, error_message: "Aviso de expiração publicado apenas no centro de notificações.",
      updated_at: now.toISOString(),
    }, { onConflict: "subscription_id,reminder_days", ignoreDuplicates: true }).select("id").maybeSingle();
    if (!inserted?.id) continue;
    await db.from("organization_subscriptions").update({ status: "expired", updated_at: now.toISOString() }).eq("id", sub.id).in("status", ["active", "trialing"]);
    await db.from("organization_notifications").insert({ organization_id: sub.organization_id, title: "A sua assinatura WhappNus expirou", body: message, notification_type: "subscription", metadata: { source: "subscription-reminder", expired: true } });
    result.expired_notices += 1;
  }

  return json({ ok: true, data: result });
});
