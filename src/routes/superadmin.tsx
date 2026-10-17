import { useEffect, useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Building2, CheckCircle2, CircleDollarSign, CreditCard, LayoutDashboard, Mail,
  LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Search, ShieldCheck,
  Smartphone, Sparkles, Users, Wallet, AlertTriangle, ArrowUpRight, Clock3, Trash2, Menu, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { superadminSupabase } from "@/lib/supabase/superadmin-client";
import { listSuperAdminGroups } from "@/lib/whatsapp.qr.functions";

export const Route = createFileRoute("/superadmin")({
  ssr: false,
  beforeLoad: async () => {
    // Auth storage may still be restoring after a hard refresh. Give Supabase one
    // chance to restore/refresh the session before deciding that the user signed out.
    let sessionResult = await superadminSupabase.auth.getSession();
    if (!sessionResult.data.session || (sessionResult.data.session.expires_at ?? 0) * 1000 < Date.now() + 30_000) {
      const refreshed = await superadminSupabase.auth.refreshSession();
      if (refreshed.data.session) sessionResult = { data: { session: refreshed.data.session }, error: null };
    }
    const { data, error } = await superadminSupabase.auth.getUser();
    if (error || !data.user || !sessionResult.data.session) throw redirect({ to: "/auth/login" });

    // Do not redirect to the regular dashboard for transient API/network errors.
    // The Edge Function remains the authority and rejects non-admin users on every action.
    try { await adminApi("dashboard"); } catch (error) {
      console.warn("Super Admin API verification failed; keep route mounted for visible error/retry.", error);
    }
  },
  head: () => ({ meta: [{ title: "Super Admin — WhappNus" }, { name: "description", content: "Painel de controlo da plataforma WhappNus." }] }),
  component: SuperAdminPage,
});

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
async function adminApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const getFreshToken = async () => {
    let session = (await superadminSupabase.auth.getSession()).data.session;
    if (!session || (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
      const refreshed = await superadminSupabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) throw new Error("A sessão expirou. Inicia sessão novamente.");
      session = refreshed.data.session;
    }
    return session.access_token;
  };
  let token = await getFreshToken();
  let response = await superadminSupabase.functions.invoke("superadmin-api", {
    body: { action, ...payload }, headers: { Authorization: `Bearer ${token}` },
  });
  const status = (response.error as { context?: Response } | null)?.context?.status;
  if (status === 401) {
    const refreshed = await superadminSupabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session) {
      token = refreshed.data.session.access_token;
      response = await superadminSupabase.functions.invoke("superadmin-api", {
        body: { action, ...payload }, headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  const { data, error } = response;
  if (error) {
    let message = error.message || "Falha ao comunicar com o serviço administrativo.";
    try {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        const body = await context.clone().json() as { error?: string };
        if (body.error) message = body.error;
      }
    } catch { /* use the SDK error message */ }
    throw new Error(message);
  }
  const result = data as ApiResult<T>;
  if (!result?.ok) throw new Error(result && "error" in result ? result.error : "Resposta inválida do servidor.");
  return result.data;
}

type Metrics = {
  organizations: number; activeOrganizations: number; suspendedOrganizations: number;
  subscriptions: number; failedPayments: number; connectedNumbers: number; aiErrors: number;
};
type Organization = {
  id: string; name: string; slug: string; status: string; management_mode: string;
  suspension_reason: string | null; created_at: string; client_name?: string | null; client_email?: string | null; contact_phone?: string | null; members_count: number; whatsapp_count: number;
  ai_agents_active: number; whatsapp_statuses: { id: string; status: string; phone_e164: string | null; display_name: string | null }[];
};
type Plan = {
  id: string; code: string; name: string; description: string; billing_interval: "monthly" | "yearly";
  price_aoa: number; trial_days: number; limits: Record<string, unknown>; features: Record<string, unknown>;
  is_active: boolean; sort_order: number;
};
const statusLabel: Record<string, string> = {
  sent: "Enviado", delivered: "Entregue", bounced: "Devolvido", complained: "Queixa", sending: "A enviar",
  active: "Ativa", trial: "Teste", setup: "Configuração", suspended: "Suspensa", blocked: "Bloqueada", cancelled: "Cancelada",
  pending: "Pendente", trialing: "Em teste", past_due: "Pagamento em atraso", expired: "Expirada",
  succeeded: "Pago", failed: "Falhou", processing: "A processar", connected: "Conectado", open: "Aberto",
};
const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" =>
  ["active", "connected", "succeeded"].includes(status) ? "default" :
  ["suspended", "blocked", "failed", "past_due", "cancelled"].includes(status) ? "destructive" :
  ["trial", "trialing", "setup", "pending", "processing"].includes(status) ? "secondary" : "outline";
const money = (value: number | string) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(Number(value) || 0);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-AO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
function auditDetails(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Sem detalhes adicionais";
  const labels: Record<string, string> = {
    code: "Código", name: "Nome", title: "Título", reason: "Motivo", from: "Antes",
    to: "Depois", active: "Activo", is_active: "Activo", is_enabled: "Ligado",
    role: "Função", status: "Estado", price_aoa: "Preço", recipient_count: "Destinatários",
    broadcast: "Envio geral", batch_size: "Organizações", queued: "Tarefas na fila",
    period_days: "Duração", billing_interval: "Periodicidade", asset_type: "Tipo de ficheiro",
    file_size: "Tamanho do ficheiro", group_jid: "Identificador do grupo", flow_id: "Funil",
    organization_ids: "Organizações destinatárias", owner_assigned: "Proprietário associado",
    whatsapp_sent: "Aviso WhatsApp enviado", reminder_days: "Dias antes do fim",
  };
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "Sem detalhes adicionais";
  return entries.map(([key, raw]) => {
    let rendered: string;
    if (key === "organization_ids" && Array.isArray(raw)) rendered = raw.length + " organização(ões)";
    else if (typeof raw === "boolean") rendered = raw ? "Sim" : "Não";
    else if (raw === null || raw === undefined || raw === "") rendered = "—";
    else if (Array.isArray(raw)) rendered = raw.length + " item(ns)";
    else if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw)) rendered = "ID " + raw.slice(0, 8);
    else if (key === "price_aoa") rendered = money(String(raw));
    else if (key === "file_size" && Number.isFinite(Number(raw))) rendered = (Number(raw) / (1024 * 1024)).toFixed(2) + " MB";
    else rendered = String(raw);
    return (labels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())) + ": " + rendered;
  }).join(" · ");
}
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function SuperAdminPage() {
  const [tab, setTab] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [emailSearch, setEmailSearch] = useState("");
  const [emailStatus, setEmailStatus] = useState("all");
  const [emailTemplate, setEmailTemplate] = useState("all");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [planInterval, setPlanInterval] = useState<"monthly" | "yearly">("monthly");
  const [planPrice, setPlanPrice] = useState("");
  const [subscriptionPlanSelections, setSubscriptionPlanSelections] = useState<Record<string, string>>({});
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [teamUserId, setTeamUserId] = useState("");
  const [teamRole, setTeamRole] = useState<"admin" | "support" | "billing" | "owner">("support");
  const [notificationOrgId, setNotificationOrgId] = useState("");
  const [notificationOrgIds, setNotificationOrgIds] = useState<string[]>([]);
  const [notificationAll, setNotificationAll] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState("Aviso de renovação da assinatura");
  const [notificationBody, setNotificationBody] = useState("");
  const [groupFlowName, setGroupFlowName] = useState("");
  const [groupFlowMode, setGroupFlowMode] = useState<"relative" | "calendar">("relative");
  const [groupLabel, setGroupLabel] = useState("");
  const [groupJid, setGroupJid] = useState("");
  const [discoveredGroups, setDiscoveredGroups] = useState<Array<{ id: string; subject: string; participants: number; announce: boolean }>>([]);
  const [groupName, setGroupName] = useState("");
  const [groupNumberId, setGroupNumberId] = useState("");
  const [groupFlowId, setGroupFlowId] = useState("");
  const [groupStepType, setGroupStepType] = useState<"text" | "ai_text" | "image" | "audio" | "video" | "document">("text");
  const [groupStepText, setGroupStepText] = useState("");
  const [groupStepAssetPath, setGroupStepAssetPath] = useState("");
  const [groupAssetFile, setGroupAssetFile] = useState<File | null>(null);
  const [groupAssetUrls, setGroupAssetUrls] = useState<Record<string, string>>({});
  const [groupAiPrompt, setGroupAiPrompt] = useState("");
  const [groupAiPublicRules, setGroupAiPublicRules] = useState("");
  const [groupAiPrivateRules, setGroupAiPrivateRules] = useState("");
  const [groupAiActive, setGroupAiActive] = useState(false);
  const [groupStepDelay, setGroupStepDelay] = useState("0");
  const [groupStepAt, setGroupStepAt] = useState("");
  const [scheduleConnectionId, setScheduleConnectionId] = useState("");
  const [scheduleStepId, setScheduleStepId] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const client = useQueryClient();

  const overview = useQuery({ queryKey: ["superadmin", "dashboard"], queryFn: () => adminApi<{ metrics: Metrics; recentAudit: any[] }>("dashboard"), retry: false });
  const organizations = useQuery({ queryKey: ["superadmin", "organizations", search], queryFn: () => adminApi<Organization[]>("organizations.list", { search }), enabled: tab === "organizations" || tab === "notifications", retry: false, staleTime: 30_000 });
  const plans = useQuery({ queryKey: ["superadmin", "plans"], queryFn: () => adminApi<Plan[]>("plans.list"), enabled: tab === "plans" || tab === "subscriptions", retry: false, staleTime: 60_000 });
  const subscriptions = useQuery({ queryKey: ["superadmin", "subscriptions"], queryFn: () => adminApi<any[]>("subscriptions.list"), enabled: tab === "subscriptions", retry: false, staleTime: 20_000, refetchInterval: 60_000 });
  const reminders = useQuery({ queryKey: ["superadmin", "reminders"], queryFn: () => adminApi<any[]>("reminders.list"), enabled: tab === "renewals", retry: false, staleTime: 20_000, refetchInterval: 60_000 });
  const payments = useQuery({ queryKey: ["superadmin", "payments"], queryFn: () => adminApi<any[]>("payments.list"), enabled: tab === "payments", retry: false });
  const health = useQuery({ queryKey: ["superadmin", "health"], queryFn: () => adminApi<any>("health"), enabled: tab === "health", retry: false });
  const audit = useQuery({ queryKey: ["superadmin", "audit"], queryFn: () => adminApi<any[]>("audit.list"), enabled: tab === "audit", retry: false });
  const emailLogs = useQuery({ queryKey: ["superadmin", "email-logs", emailSearch, emailStatus, emailTemplate], queryFn: () => adminApi<{ rows: any[]; meta: { brevo_configured: boolean; brevo_error: string | null; brevo_events: number; app_logs: number } }>("email.logs.list", { search: emailSearch, status: emailStatus, template: emailTemplate }), enabled: tab === "emails", retry: false, staleTime: 10_000, refetchInterval: 30_000 });
  const resendEmail = useMutation({
    mutationFn: (logId: string) => adminApi<any>("email.logs.resend", { log_id: logId }),
    onSuccess: (result) => {
      toast.success(`E-mail reenviado para ${result.recipient}.`);
      void client.invalidateQueries({ queryKey: ["superadmin", "email-logs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const team = useQuery({ queryKey: ["superadmin", "team"], queryFn: () => adminApi<any[]>("team.list"), enabled: tab === "team", retry: false });
  const notifications = useQuery({ queryKey: ["superadmin", "notifications"], queryFn: () => adminApi<any[]>("notifications.list"), enabled: tab === "notifications", retry: false, staleTime: 15_000 });
  const groupCommander = useQuery({ queryKey: ["superadmin", "group-commander"], queryFn: () => adminApi<any>("group.commander.list"), enabled: tab === "groups", retry: false, staleTime: 15_000 });
  const groupAi = useQuery({ queryKey: ["superadmin", "group-ai"], queryFn: () => adminApi<any>("group.ai.get"), enabled: tab === "group-ai", retry: false, staleTime: 15_000 });
  useEffect(() => { if (groupAi.data) { setGroupAiPrompt(groupAi.data.system_prompt ?? ""); setGroupAiPublicRules(groupAi.data.public_group_rules ?? ""); setGroupAiPrivateRules(groupAi.data.private_dm_rules ?? ""); setGroupAiActive(Boolean(groupAi.data.is_active)); } }, [groupAi.data]);
  useEffect(() => {
    let cancelled = false;
    async function signAssets() {
      const assets = groupCommander.data?.assets ?? [];
      const entries = await Promise.all(assets.map(async (asset: any) => {
        const { data, error } = await superadminSupabase.storage.from("superadmin-group-assets").createSignedUrl(asset.storage_path, 3600);
        return !error && data?.signedUrl ? [asset.storage_path, data.signedUrl] as const : null;
      }));
      if (!cancelled) setGroupAssetUrls(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>));
    }
    void signAssets();
    return () => { cancelled = true; };
  }, [groupCommander.data?.assets]);
  const selectedGroupAsset = (groupCommander.data?.assets ?? []).find((asset: any) => asset.storage_path === groupStepAssetPath) ?? null;
  const discoverGroupsFn = useServerFn(listSuperAdminGroups);
  const discoverGroups = useMutation({
    mutationFn: async () => { const session = (await superadminSupabase.auth.getSession()).data.session; if (!session) throw new Error("Sessão Super Admin ausente. Inicia sessão novamente."); return discoverGroupsFn({ data: { numberId: groupNumberId, accessToken: session.access_token } }); },
    onSuccess: (groups) => { setDiscoveredGroups(groups); if (!groups.length) toast.message("A sessão está ligada, mas não devolveu grupos participantes."); else toast.success(`${groups.length} grupos encontrados na sessão WhatsApp.`); },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveGroupAi = useMutation({
    mutationFn: () => adminApi<any>("group.ai.save", { system_prompt: groupAiPrompt, public_group_rules: groupAiPublicRules, private_dm_rules: groupAiPrivateRules, is_active: groupAiActive }),
    onSuccess: (result) => { toast.success(result.is_active ? "Configuração de treino guardada e activada." : "Configuração guardada; IA do funil desactivada."); void client.invalidateQueries({ queryKey: ["superadmin", "group-ai"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveGroupFlow = useMutation({ mutationFn: () => adminApi<any>("group.flow.save", { name: groupFlowName.trim(), trigger_mode: groupFlowMode, is_active: false }), onSuccess: (flow) => { toast.success("Funil criado."); setGroupFlowName(""); setGroupFlowId(flow.id); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); }, onError: (error: Error) => toast.error(error.message) });
  const saveGroupConnection = useMutation({ mutationFn: () => adminApi<any>("group.connection.save", { label: groupLabel.trim(), group_jid: groupJid.trim(), group_name: groupName.trim(), whatsapp_number_id: groupNumberId, active_flow_id: groupFlowId || null, is_enabled: false }), onSuccess: () => { toast.success("Grupo registado desactivado."); setGroupLabel(""); setGroupJid(""); setGroupName(""); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); }, onError: (error: Error) => toast.error(error.message) });
  const sendNotification = useMutation({
    mutationFn: (payload: { organization_id?: string; organization_ids?: string[]; all_organizations?: boolean; title: string; body: string }) => adminApi<any>("notifications.send", payload),
    onSuccess: () => {
      toast.success("Notificação publicada para " + (sendNotification.data?.sent_count ?? 1) + " organização(ões).");
      setNotificationOrgId(""); setNotificationOrgIds([]); setNotificationAll(false);
      setNotificationBody("");
      void client.invalidateQueries({ queryKey: ["superadmin", "notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const uploadGroupAsset = useMutation({
    mutationFn: async () => {
      const file = groupAssetFile;
      if (!file) throw new Error("Escolhe primeiro um ficheiro multimédia.");
      if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("O ficheiro deve ter até 20 MB.");
      const extension = file.name.toLowerCase().split(".").pop() ?? "";
      const inferred: Record<string, string> = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", csv: "text/csv", zip: "application/zip", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
      const mimeType = file.type.toLowerCase().split(";")[0]?.trim() || inferred[extension] || "application/octet-stream";
      const assetType = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "document";
      const signed = await adminApi<{ path: string; token: string }>("group.asset.upload-url", { file_name: file.name, mime_type: mimeType, file_size: file.size });
      const { error: uploadError } = await superadminSupabase.storage.from("superadmin-group-assets").uploadToSignedUrl(signed.path, signed.token, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw new Error("Falha ao carregar o ficheiro: " + uploadError.message);
      try {
        return await adminApi<any>("group.asset.save", { name: file.name, asset_type: assetType, storage_path: signed.path, mime_type: mimeType, file_size: file.size });
      } catch (error) {
        await superadminSupabase.storage.from("superadmin-group-assets").remove([signed.path]);
        throw error;
      }
    },
    onSuccess: (asset) => { toast.success("Asset guardado no banco multimédia."); setGroupAssetFile(null); setGroupStepAssetPath(asset.storage_path); setGroupStepType(asset.asset_type); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveGroupStep = useMutation({
    mutationFn: () => adminApi<any>("group.step.save", { flow_id: groupFlowId, position: (groupCommander.data?.steps ?? []).filter((step: any) => step.flow_id === groupFlowId).length, trigger_mode: groupFlowMode, delay_minutes: groupFlowMode === "relative" ? Number(groupStepDelay) : null, scheduled_at: groupFlowMode === "calendar" && groupStepAt ? new Date(groupStepAt).toISOString() : null, action_type: groupStepType, text_content: groupStepType === "text" || groupStepType === "ai_text" ? groupStepText.trim() : null, asset_path: groupStepType === "text" || groupStepType === "ai_text" ? null : selectedGroupAsset?.storage_path ?? null, asset_mime_type: groupStepType === "text" || groupStepType === "ai_text" ? null : selectedGroupAsset?.mime_type ?? null, asset_file_name: groupStepType === "text" || groupStepType === "ai_text" ? null : selectedGroupAsset?.name ?? null, caption: groupStepType === "text" || groupStepType === "ai_text" ? null : groupStepText.trim() || null }),
    onSuccess: () => { toast.success("Etapa guardada."); setGroupStepText(""); setGroupStepAssetPath(""); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const scheduleGroupJob = useMutation({
    mutationFn: () => adminApi<any>("group.job.schedule", { connection_id: scheduleConnectionId, step_id: scheduleStepId, due_at: new Date(scheduleAt).toISOString() }),
    onSuccess: (result) => { toast.message(result?.note || "Agendamento colocado na fila."); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const toggleGroupConnection = useMutation({ mutationFn: (payload: { id: string; is_enabled: boolean }) => adminApi<any>("group.connection.toggle", payload), onSuccess: () => void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }), onError: (error: Error) => toast.error(error.message) });
  const deleteGroupConnection = useMutation({ mutationFn: (id: string) => adminApi<any>("group.connection.delete", { id }), onSuccess: (result) => { toast.success(`Grupo removido. ${result.related_jobs_removed ?? 0} registos da fila foram removidos.`); void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }); }, onError: (error: Error) => toast.error(error.message) });
  const toggleGroupFlow = useMutation({ mutationFn: (payload: { id: string; is_active: boolean }) => adminApi<any>("group.flow.toggle", payload), onSuccess: () => void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] }), onError: (error: Error) => toast.error(error.message) });
  const assignGroupFlow = useMutation({
    mutationFn: (payload: { id: string; active_flow_id: string | null }) => adminApi<any>("group.connection.assign-flow", payload),
    onSuccess: (result) => {
      toast.success(result?.note || "Funil do grupo actualizado.");
      void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteGroupFlow = useMutation({
    mutationFn: (id: string) => adminApi<any>("group.flow.delete", { id }),
    onSuccess: (deleted: { id: string; name: string }) => {
      toast.success("Funil eliminado. Os grupos associados ficaram desactivados e sem funil.");
      if (groupFlowId === deleted.id) setGroupFlowId("");
      void client.invalidateQueries({ queryKey: ["superadmin", "group-commander"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const createOrganization = useMutation({
    mutationFn: () => adminApi<Organization>("organizations.create", { name: orgName.trim(), slug: orgSlug.trim() || slugify(orgName), owner_user_id: ownerId.trim() || undefined }),
    onSuccess: () => {
      toast.success("Organização criada.");
      setOrgName(""); setOrgSlug(""); setOwnerId(""); setShowOrgForm(false);
      void client.invalidateQueries({ queryKey: ["superadmin"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const updateStatus = useMutation({
    mutationFn: (payload: { organization_id: string; status: string; reason?: string }) => adminApi<Organization>("organizations.set_status", payload),
    onSuccess: () => { toast.success("Estado da organização atualizado."); void client.invalidateQueries({ queryKey: ["superadmin"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const reactivateSubscription = useMutation({
    mutationFn: (payload: { subscription_id: string; plan_id: string; period_days: number }) =>
      adminApi<any>("subscriptions.reactivate", payload),
    onSuccess: () => {
      toast.success("Assinatura reactivada. A organização e os recursos suspensos foram reactivados.");
      void client.invalidateQueries({ queryKey: ["superadmin"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveAdmin = useMutation({
    mutationFn: (payload: { user_id: string; role: string; is_active: boolean }) => adminApi<any>("team.save", { ...payload, permissions: {} }),
    onSuccess: () => { toast.success("Permissões administrativas atualizadas."); setTeamUserId(""); void client.invalidateQueries({ queryKey: ["superadmin", "team"] }); void client.invalidateQueries({ queryKey: ["superadmin", "audit"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const deletePlan = useMutation({
    mutationFn: (id: string) => adminApi<any>("plans.delete", { id }),
    onSuccess: () => { toast.success("Plano inactivo eliminado."); void client.invalidateQueries({ queryKey: ["superadmin", "plans"] }); void client.invalidateQueries({ queryKey: ["superadmin", "subscriptions"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const savePlan = useMutation({
    mutationFn: () => adminApi<Plan>("plans.save", {
      code: planCode.trim() || slugify(planName).replace(/-/g, "_") + (planInterval === "yearly" ? "_yearly" : "_monthly"),
      name: planName.trim(), description: "Plano WhappNus", billing_interval: planInterval,
      price_aoa: Number(planPrice), trial_days: 0, limits: { whatsapp_numbers: 1, agents: 1, team_members: 2 },
      features: { crm: true, automations: false, analytics: false }, is_active: Number(planPrice) > 0,
    }),
    onSuccess: () => {
      toast.success(Number(planPrice) > 0 ? "Plano criado." : "Plano criado como inativo porque o preço é zero.");
      setPlanName(""); setPlanCode(""); setPlanPrice(""); setShowPlanForm(false);
      void client.invalidateQueries({ queryKey: ["superadmin", "plans"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const metrics = overview.data?.metrics;
  const isLoading = overview.isLoading;
  const refreshAll = () => {
    void client.invalidateQueries({ queryKey: ["superadmin"] });
    toast.message("A atualizar dados do painel…");
  };
  const pageError = overview.error as Error | null;

  return (
    <div className="min-h-screen bg-[#07110e] text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/10 bg-[#091510] lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400 text-[#062016]"><ShieldCheck className="size-5" /></div>
          <div><div className="font-display text-lg font-bold tracking-tight">WhappNus</div><div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">Control Center</div></div>
        </div>
        <div className="px-4 pt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Plataforma</div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {[
            ["overview", LayoutDashboard, "Visão geral"], ["organizations", Building2, "Organizações"],
            ["plans", CircleDollarSign, "Planos e preços"], ["subscriptions", CreditCard, "Assinaturas"], ["renewals", Clock3, "Renovações"], ["notifications", Sparkles, "Notificações"],
            ["groups", Users, "Group Commander"], ["group-ai", Sparkles, "Treinar IA"], ["payments", Wallet, "Pagamentos"], ["health", Activity, "WhatsApp & IA"], ["team", Users, "Equipa admin"], ["emails", Mail, "E-mails automáticos"], ["audit", LockKeyhole, "Auditoria"],
          ].map(([id, Icon, label]) => {
            const I = Icon as typeof LayoutDashboard;
            return <button key={id as string} onClick={() => setTab(id as string)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${tab === id ? "bg-emerald-400/10 font-semibold text-emerald-200 ring-1 ring-emerald-300/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><I className="size-4" />{label as string}{tab === id && <span className="ml-auto size-1.5 rounded-full bg-emerald-300" />}</button>;
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3"><div className="flex size-9 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10"><LockKeyhole className="size-4 text-emerald-200" /></div><div className="min-w-0"><div className="text-xs font-semibold">Área restrita</div><div className="text-[11px] text-slate-500">Acesso validado no servidor</div></div></div>
          <Button variant="ghost" className="mt-3 w-full justify-start text-slate-400 hover:text-white" onClick={() => void superadminSupabase.auth.signOut().then(() => { window.location.href = "/auth/login"; })}><LogOut />Terminar sessão</Button>
        </div>
      </aside>

      <main className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-30 flex min-h-20 items-center justify-between gap-3 border-b border-white/10 bg-[#07110e]/90 px-3 backdrop-blur-xl sm:px-8">
          <div className="flex min-w-0 items-center gap-3"><Button type="button" variant="outline" size="icon" aria-label={mobileNavOpen ? "Fechar menu" : "Abrir menu"} className="shrink-0 border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 lg:hidden" onClick={() => setMobileNavOpen(v => !v)}>{mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}</Button><div className="min-w-0"><div className="flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.75)]" />PAINEL DE CONTROLO</div><h1 className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">{tab === "overview" ? "Visão geral" : tab === "organizations" ? "Organizações" : tab === "plans" ? "Planos e preços" : tab === "subscriptions" ? "Assinaturas" : tab === "renewals" ? "Renovações e avisos" : tab === "notifications" ? "Notificações" : tab === "groups" ? "Group Commander" : tab === "group-ai" ? "Treinar IA do funil" : tab === "payments" ? "Pagamentos" : tab === "health" ? "Saúde operacional" : tab === "team" ? "Equipa administrativa" : tab === "emails" ? "E-mails automáticos" : "Auditoria da plataforma"}</h1></div></div>
          <div className="flex shrink-0 items-center gap-2"><Badge variant="outline" className="hidden border-emerald-300/20 text-emerald-200 sm:inline-flex">AOA · Africa/Luanda</Badge><Button variant="outline" size="icon" className="border-white/10 bg-white/5 hover:bg-white/10" onClick={refreshAll} aria-label="Atualizar"><RefreshCw className="size-4" /></Button></div>
        </header>
        {mobileNavOpen && <><button type="button" aria-label="Fechar menu de navegação" className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} /><aside role="dialog" aria-modal="true" aria-label="Navegação do Super Admin" className="fixed inset-y-0 left-0 z-40 flex w-[min(84vw,20rem)] flex-col border-r border-white/10 bg-[#091510] shadow-2xl lg:hidden"><div className="flex h-20 items-center justify-between gap-3 border-b border-white/10 px-5"><div><div className="font-display text-lg font-bold tracking-tight">WhappNus</div><div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">Control Center</div></div><Button type="button" variant="ghost" size="icon" aria-label="Fechar menu" className="text-slate-300" onClick={() => setMobileNavOpen(false)}><X className="size-5" /></Button></div><div className="px-4 pt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Plataforma</div><nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-3 pb-4">{[[ "overview", LayoutDashboard, "Resumo" ],[ "organizations", Building2, "Clientes" ],[ "plans", CircleDollarSign, "Planos" ],[ "subscriptions", CreditCard, "Assinaturas" ],[ "renewals", Clock3, "Renovações" ],[ "notifications", Sparkles, "Notificações" ],[ "groups", Users, "Grupos" ],[ "group-ai", Sparkles, "Treinar IA" ],[ "payments", Wallet, "Pagamentos" ],[ "health", Activity, "Saúde" ],[ "team", Users, "Equipa" ],[ "emails", Mail, "E-mails" ],[ "audit", LockKeyhole, "Auditoria" ]].map(([id, Icon, label]) => { const I = Icon as typeof LayoutDashboard; return <button key={id as string} type="button" onClick={() => { setTab(id as string); setMobileNavOpen(false); }} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${tab === id ? "bg-emerald-400/10 font-semibold text-emerald-200 ring-1 ring-emerald-300/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><I className="size-4 shrink-0" /><span>{label as string}</span>{tab === id && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-emerald-300" />}</button>; })}</nav><div className="border-t border-white/10 p-4"><Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-white" onClick={() => void superadminSupabase.auth.signOut().then(() => { window.location.href = "/auth/login"; })}><LogOut className="mr-2 size-4" />Terminar sessão</Button></div></aside></>}

        <div className="p-3 sm:p-5 lg:p-8">
          {pageError && <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" /><div><div className="font-semibold text-amber-100">Não foi possível carregar o painel</div><p className="mt-1 text-slate-400">{pageError.message}. Confirma se a migração está aplicada e se a tua conta foi autorizada em <code>superadmin_users</code>.</p></div></div>}

          {tab === "overview" && <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-[#10251b] to-[#0b1712] p-6 sm:p-8">
              <div className="pointer-events-none absolute -right-8 -top-16 size-64 rounded-full border border-emerald-200/10" /><div className="pointer-events-none absolute -right-1 -top-9 size-48 rounded-full border border-emerald-200/10" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><Badge className="border-emerald-300/20 bg-emerald-300/10 text-emerald-200 hover:bg-emerald-300/10">Super Admin · Acesso privilegiado</Badge><h2 className="mt-4 max-w-2xl font-display text-2xl font-bold sm:text-3xl">O centro de comando da WhappNus.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Acompanha clientes, pagamentos, subscrições e o estado operacional num só lugar. As operações administrativas são autorizadas no servidor.</p></div><div className="flex items-center gap-2 text-xs text-slate-400"><CheckCircle2 className="size-4 text-emerald-300" /> Sessão protegida</div></div>
            </div>
            {isLoading ? <Loading /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={Building2} label="Organizações" value={metrics?.organizations} note={`${metrics?.activeOrganizations ?? 0} ativas`} />
              <Metric icon={LockKeyhole} label="Suspensas / bloqueadas" value={metrics?.suspendedOrganizations} note="Requerem atenção" alert />
              <Metric icon={CreditCard} label="Assinaturas ativas" value={metrics?.subscriptions} note="Planos recorrentes" />
              <Metric icon={Smartphone} label="Números WhatsApp conectados" value={metrics?.connectedNumbers} note="Estado registado na base de dados" />
              <Metric icon={Wallet} label="Pagamentos com falha" value={metrics?.failedPayments} note="Verifica a referência e o estado" alert />
              <Metric icon={Sparkles} label="Erros registados pela IA" value={metrics?.aiErrors} note="Contagem histórica" alert />
            </div>}
            <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Atividade administrativa recente</CardTitle><CardDescription className="text-slate-500">Ações registadas no histórico de auditoria.</CardDescription></CardHeader><CardContent>{overview.data?.recentAudit?.length ? <div className="space-y-4">{overview.data.recentAudit.map((item:any) => <div key={item.id} className="flex items-start gap-3 border-b border-white/[0.06] pb-3 last:border-0"><div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5"><Activity className="size-4 text-emerald-200" /></div><div className="min-w-0 flex-1"><div className="text-sm font-medium">{item.action}</div><div className="mt-1 text-xs text-slate-500">{item.target_type}{item.target_id ? ` · ${item.target_id.slice(0,8)}` : ""}</div></div><time className="whitespace-nowrap text-[11px] text-slate-500">{date(item.created_at)}</time></div>)}</div> : <Empty text="Ainda não existem ações administrativas registadas." />}</CardContent></Card>
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Acesso e segurança</CardTitle><CardDescription className="text-slate-500">Controlos da área privilegiada.</CardDescription></CardHeader><CardContent className="space-y-3"><SecurityRow title="Autorização server-side" text="Cada pedido valida sessão, função e permissões." /><SecurityRow title="Isolamento dos clientes" text="O browser não recebe acesso global às tabelas financeiras." /><SecurityRow title="Registo de auditoria" text="As operações administrativas geram eventos de auditoria." /><SecurityRow title="Segredos protegidos" text="A chave service_role permanece no ambiente do servidor." /></CardContent></Card>
            </div>
          </div>}

          {tab === "organizations" && <section className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Gestão de clientes</h2><p className="mt-1 text-sm text-slate-500">Estado da conta, equipa, WhatsApp e agentes de IA.</p></div><Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" onClick={() => setShowOrgForm(v => !v)}><Plus className="size-4" /> Nova organização</Button></div>
            {showOrgForm && <Card className="border-emerald-300/20 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Criar organização</CardTitle><CardDescription className="text-slate-500">O utilizador proprietário é opcional; se ficar vazio, a organização fica em configuração.</CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-3" onSubmit={e => { e.preventDefault(); createOrganization.mutate(); }}><div><label className="mb-1.5 block text-xs text-slate-400">Nome comercial</label><Input value={orgName} onChange={e => { setOrgName(e.target.value); if (!orgSlug) setOrgSlug(slugify(e.target.value)); }} required minLength={2} className="border-white/10 bg-black/20" placeholder="Ex.: Pastelaria Central" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Identificador (slug)</label><Input value={orgSlug} onChange={e => setOrgSlug(slugify(e.target.value))} required className="border-white/10 bg-black/20" placeholder="pastelaria-central" /></div><div><label className="mb-1.5 block text-xs text-slate-400">UUID do proprietário (opcional)</label><Input value={ownerId} onChange={e => setOwnerId(e.target.value)} className="border-white/10 bg-black/20" placeholder="UUID da conta existente" /></div><div className="flex gap-2 md:col-span-3"><Button type="submit" disabled={createOrganization.isPending || !orgName.trim()} className="bg-emerald-400 text-[#062016] hover:bg-emerald-300">{createOrganization.isPending && <LoaderCircle className="size-4 animate-spin" />}Criar organização</Button><Button type="button" variant="outline" className="border-white/10" onClick={() => setShowOrgForm(false)}>Cancelar</Button></div></form></CardContent></Card>}
            <div className="flex max-w-md items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3"><Search className="size-4 text-slate-500" /><Input value={search} onChange={e => setSearch(e.target.value)} className="border-0 bg-transparent focus-visible:ring-0" placeholder="Pesquisar por empresa ou slug…" /></div>
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]">{organizations.isLoading ? <Loading /> : organizations.error ? <ErrorText error={organizations.error as Error} /> : <Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Organização / cliente</TableHead><TableHead className="text-slate-500">Contacto</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Equipa</TableHead><TableHead className="text-slate-500">WhatsApp</TableHead><TableHead className="text-slate-500">Agentes IA</TableHead><TableHead className="text-slate-500">Criada em</TableHead><TableHead className="text-right text-slate-500">Controlo</TableHead></TableRow></TableHeader><TableBody>{(organizations.data ?? []).map(org => <TableRow key={org.id} className="border-white/[0.06]"><TableCell><div className="font-medium text-slate-100">{org.name}</div><div className="mt-1 text-xs text-slate-400">{org.client_name ?? "Cliente por identificar"}</div><div className="mt-1 text-xs text-slate-500">{org.slug}</div></TableCell><TableCell><div className="text-xs">{org.client_email ?? "Sem e-mail"}</div><div className="mt-1 text-xs text-slate-500">{org.contact_phone ?? "Sem telefone de contacto"}</div></TableCell><TableCell><Badge variant={statusVariant(org.status)}>{statusLabel[org.status] ?? org.status}</Badge></TableCell><TableCell>{org.members_count}</TableCell><TableCell><div>{org.whatsapp_count} número(s)</div><div className="mt-1 space-y-1 text-[11px] text-slate-500">{org.whatsapp_statuses.slice(0,2).map(n => <div key={n.id}>{n.phone_e164 ?? n.display_name ?? "Número não identificado"} · {statusLabel[n.status] ?? n.status}</div>)}{org.whatsapp_count === 0 && "Sem conexão"}</div></TableCell><TableCell>{org.ai_agents_active}</TableCell><TableCell className="text-xs text-slate-400">{date(org.created_at)}</TableCell><TableCell className="text-right"><select aria-label={`Estado de ${org.name}`} value={org.status} disabled={updateStatus.isPending} onChange={e => { const status = e.target.value; const reason = ["suspended","blocked"].includes(status) ? window.prompt("Motivo (registado na auditoria):", "") ?? "" : ""; updateStatus.mutate({ organization_id: org.id, status, reason }); }} className="max-w-36 rounded-lg border border-white/10 bg-[#102219] px-2 py-2 text-xs text-slate-200"><option value="active">Ativa</option><option value="trial">Teste</option><option value="setup">Configuração</option><option value="suspended">Suspender</option><option value="blocked">Bloquear</option><option value="cancelled">Cancelar</option></select></TableCell></TableRow>)}</TableBody></Table>}</div>
          </section>}

          {tab === "plans" && <section className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Catálogo comercial</h2><p className="mt-1 text-sm text-slate-500">Preços em Kwanza. Planos a zero ficam inativos para evitar vendas por engano.</p></div><Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" onClick={() => setShowPlanForm(v => !v)}><Plus className="size-4" /> Criar plano</Button></div>
            {showPlanForm && <Card className="border-emerald-300/20 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Novo plano recorrente</CardTitle></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); savePlan.mutate(); }}><div><label className="mb-1.5 block text-xs text-slate-400">Nome</label><Input required value={planName} onChange={e => { setPlanName(e.target.value); if (!planCode) setPlanCode(slugify(e.target.value).replace(/-/g,"_")); }} className="border-white/10 bg-black/20" placeholder="Pro" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Código (opcional)</label><Input value={planCode} onChange={e => setPlanCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,""))} className="border-white/10 bg-black/20" placeholder="pro_monthly" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Periodicidade</label><select value={planInterval} onChange={e => setPlanInterval(e.target.value as "monthly"|"yearly")} className="h-9 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></div><div><label className="mb-1.5 block text-xs text-slate-400">Preço (AOA)</label><Input type="number" min="0" step="1" required value={planPrice} onChange={e => setPlanPrice(e.target.value)} className="border-white/10 bg-black/20" placeholder="15000" /></div><div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={savePlan.isPending || !planName.trim() || planPrice === ""} className="bg-emerald-400 text-[#062016] hover:bg-emerald-300">{savePlan.isPending && <LoaderCircle className="size-4 animate-spin" />}Guardar plano</Button><Button type="button" variant="outline" className="border-white/10" onClick={() => setShowPlanForm(false)}>Cancelar</Button></div></form></CardContent></Card>}
            {plans.isLoading ? <Loading /> : plans.error ? <ErrorText error={plans.error as Error} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(plans.data ?? []).map(plan => <Card key={plan.id} className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{plan.name}</CardTitle><CardDescription className="mt-2 text-slate-500">{plan.code}</CardDescription></div><div className="flex items-center gap-2"><Badge variant={plan.is_active ? "default" : "secondary"}>{plan.is_active ? "Ativo" : "Inativo"}</Badge><Button size="icon" variant="ghost" title={plan.is_active ? "Desactiva o plano antes de apagar" : "Apagar plano inactivo"} aria-label={"Apagar plano " + plan.name} disabled={deletePlan.isPending} onClick={() => { if (plan.is_active) { toast.error("Desactiva primeiro este plano. O histórico de assinaturas e pagamentos nunca será apagado."); return; } if (window.confirm("Apagar definitivamente o plano inactivo " + plan.name + "? Só é permitido se não tiver assinaturas nem pagamentos associados.")) deletePlan.mutate(plan.id); }}><Trash2 className="size-4 text-red-300" /></Button></div></div></CardHeader><CardContent><div className="font-display text-2xl font-bold">{money(plan.price_aoa)}<span className="ml-1 text-xs font-normal text-slate-500">/{plan.billing_interval === "monthly" ? "mês" : "ano"}</span></div><div className="mt-4 space-y-2 text-xs text-slate-400"><div className="flex justify-between"><span>Período de teste</span><span>{plan.trial_days} dias</span></div><div className="flex justify-between"><span>Números WhatsApp</span><span>{String(plan.limits?.["whatsapp_numbers"] ?? "—")}</span></div><div className="flex justify-between"><span>Agentes IA</span><span>{String(plan.limits?.["agents"] ?? "—")}</span></div><div className="flex justify-between"><span>Membros</span><span>{String(plan.limits?.["team_members"] ?? "—")}</span></div></div>{plan.price_aoa <= 0 && <p className="mt-4 rounded-lg bg-amber-300/5 p-2 text-xs text-amber-200">Define um preço superior a zero antes de ativar este plano.</p>}</CardContent></Card>)}</div>}
          </section>}

          {tab === "subscriptions" && <section><SectionIntro title="Assinaturas" description="Estado, periodicidade, período e organização associada." />{subscriptions.isLoading ? <Loading /> : subscriptions.error ? <ErrorText error={subscriptions.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Cliente / organização</TableHead><TableHead className="text-slate-500">Plano e limites</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Valor</TableHead><TableHead className="text-slate-500">Activado em</TableHead><TableHead className="text-slate-500">Expira em</TableHead><TableHead className="text-slate-500">Dias restantes</TableHead><TableHead className="text-slate-500">Acção administrativa</TableHead></TableRow></TableHeader><TableBody>{(subscriptions.data ?? []).map((s:any) => <TableRow key={s.id} className="border-white/[0.06]"><TableCell><div className="font-medium">{s.client_name ?? "Cliente por identificar"}</div><div className="text-xs text-slate-400">{s.client_email ?? "Sem e-mail"}</div><div className="text-xs text-slate-500">{s.organizations?.name ?? "Organização"} · {s.client_phone ?? "Sem telefone"}</div></TableCell><TableCell>{s.subscription_plans?.name ?? "Plano não associado"}<div className="text-xs text-slate-500">{s.billing_interval === "yearly" ? "Anual" : "Mensal"} · {s.ai_conversations_used ?? 0}/{s.ai_conversations_limit || "—"} conversas IA no período{s.ai_conversations_limit ? " · Restam " + Math.max(0, Number(s.ai_conversations_limit) - Number(s.ai_conversations_used ?? 0)) : ""}</div><div className="mt-1 text-[11px] text-slate-500">WhatsApp: {String(s.plan_limits?.whatsapp_numbers ?? "—")} · Agentes IA: {String(s.plan_limits?.agents ?? "—")} · Equipa: {String(s.plan_limits?.team_members ?? "—")} · Automações: {String(s.plan_limits?.automations ?? "—")}</div><div className="mt-1 text-[11px] text-slate-500">Recursos: {Object.entries(s.plan_features ?? {}).filter(([,enabled]) => enabled === true).map(([feature]) => feature === "ai" ? "IA" : feature === "crm" ? "CRM" : feature === "inbox" ? "Caixa de entrada" : feature === "automations" ? "Automações" : feature === "analytics" ? "Análise" : feature === "contacts" ? "Contactos" : feature === "campaigns" ? "Campanhas" : feature === "integrations" ? "Integrações" : feature).join(", ") || "Sem recursos activos"}</div></TableCell><TableCell><Badge variant={statusVariant(s.status)}>{statusLabel[s.status] ?? s.status}</Badge></TableCell><TableCell>{money(s.amount_aoa)}</TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(s.starts_at ?? s.current_period_start)}</TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(s.current_period_end)}</TableCell><TableCell><Badge variant={s.current_period_end && new Date(s.current_period_end).getTime() < Date.now() ? "destructive" : s.current_period_end && new Date(s.current_period_end).getTime() - Date.now() <= 3 * 86400000 ? "secondary" : "default"}>{s.current_period_end ? (s.days_remaining ?? Math.max(0, Math.ceil((new Date(s.current_period_end).getTime() - Date.now()) / 86400000))) + " dia(s)" : "Sem prazo"}</Badge></TableCell><TableCell><div className="flex min-w-64 items-center gap-2"><select aria-label={"Plano para reactivar " + (s.organizations?.name ?? "organização")} value={subscriptionPlanSelections[s.id] ?? ""} onChange={e => setSubscriptionPlanSelections(v => ({ ...v, [s.id]: e.target.value }))} className="h-9 min-w-40 rounded-md border border-white/10 bg-[#102219] px-2 text-xs"><option value="">Escolher plano pago</option>{(plans.data ?? []).filter((p:Plan) => p.is_active && Number(p.price_aoa) > 0).map((p:Plan) => <option key={p.id} value={p.id}>{p.name} · {money(p.price_aoa)}</option>)}</select><Button size="sm" className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={!subscriptionPlanSelections[s.id] || reactivateSubscription.isPending} onClick={() => reactivateSubscription.mutate({ subscription_id: s.id, plan_id: subscriptionPlanSelections[s.id] ?? "", period_days: 30 })}>Activar 30 dias</Button><Button size="sm" variant="outline" className="border-white/10" disabled={sendNotification.isPending} onClick={() => { const days = s.current_period_end ? Math.max(0, Math.ceil((new Date(s.current_period_end).getTime() - Date.now()) / 86400000)) : 0; sendNotification.mutate({ organization_id: s.organization_id, title: "Aviso de renovação da assinatura", body: days > 0 ? `A sua assinatura ${s.subscription_plans?.name ?? ""} termina dentro de ${days} dia(s), em ${date(s.current_period_end)}. Contacte a equipa WhappNus para renovar e manter os serviços activos.` : "A sua assinatura WhappNus terminou. Contacte a equipa para reactivar o plano e voltar a utilizar a IA e as automações." }); }}>Avisar cliente</Button></div></TableCell></TableRow>)}</TableBody></Table></div>}</section>}

          {tab === "renewals" && <section className="space-y-5"><SectionIntro title="Renovações e avisos automáticos" description="Organizações com assinatura a expirar nos próximos 7 dias ou já expirada. O envio WhatsApp depende de contacto válido, sessão ligada e agendamento diário configurado." />{reminders.isLoading ? <Loading /> : reminders.error ? <ErrorText error={reminders.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Cliente / organização</TableHead><TableHead className="text-slate-500">Plano</TableHead><TableHead className="text-slate-500">Contacto</TableHead><TableHead className="text-slate-500">Expira em</TableHead><TableHead className="text-slate-500">Dias restantes</TableHead><TableHead className="text-slate-500">WhatsApp</TableHead><TableHead className="text-slate-500">Aviso</TableHead></TableRow></TableHeader><TableBody>{(reminders.data ?? []).map((r:any) => <TableRow key={r.id} className="border-white/[0.06]"><TableCell><div className="font-medium">{r.client_name ?? "Cliente por identificar"}</div><div className="text-xs text-slate-400">{r.client_email ?? "Sem e-mail"}</div><div className="text-xs text-slate-500">{r.organizations?.name ?? "Organização"} · {r.organizations?.slug ?? r.organization_id}</div></TableCell><TableCell>{r.subscription_plans?.name ?? "Plano não associado"}<div className="text-xs text-slate-500">{money(r.amount_aoa)}</div></TableCell><TableCell className="text-xs">{r.contact_phone ?? "Telefone por confirmar"}</TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(r.current_period_end)}</TableCell><TableCell><Badge variant={(r.days_remaining ?? 99) < 0 ? "destructive" : (r.days_remaining ?? 99) <= 4 ? "secondary" : "default"}>{r.days_remaining == null ? "Sem prazo" : r.days_remaining < 0 ? "Expirada" : r.days_remaining + " dia(s)"}</Badge></TableCell><TableCell><Badge variant={r.whatsapp_session ? "default" : "outline"}>{r.whatsapp_session ? "Ligado" : "Sem sessão ligada"}</Badge></TableCell><TableCell><Badge variant={r.reminder_status === "sent" ? "default" : r.reminder_status === "failed" ? "destructive" : "secondary"}>{r.reminder_status === "sent" ? "Enviado" : r.reminder_status === "failed" ? "Falhou" : r.reminder_status === "queued" ? "Na fila" : r.reminder_status === "skipped" && r.reminder_days === 0 ? "Aviso de expiração publicado" : r.reminder_status === "skipped" ? "Não enviado" : "A agendar"}</Badge>{r.reminder_sent_at && <div className="mt-1 text-[10px] text-slate-500">{date(r.reminder_sent_at)}</div>}{r.reminder_error && <div className="mt-1 max-w-40 text-[10px] text-red-300">{r.reminder_error}</div>}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}

          {tab === "notifications" && <section className="space-y-5">
            <SectionIntro title="Notificações aos clientes" description="Envia avisos que ficam visíveis dentro da plataforma da organização. Usa esta área para alertas de renovação e prazo de assinatura." />
            <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none">
              <CardHeader><CardTitle className="text-base">Enviar notificação</CardTitle><CardDescription className="text-slate-500">Publica uma mensagem no centro de notificações das organizações seleccionadas. Escolhe Todos ou até 10 organizações.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2 text-sm sm:col-span-2"><div className="flex items-center justify-between"><span className="font-medium">Destinatários</span><span className="text-xs text-slate-500">{notificationAll ? "Todas as organizações" : notificationOrgIds.length + " de 10 seleccionadas"}</span></div><label className="flex items-center gap-2 rounded-lg border border-white/10 p-3"><input type="checkbox" checked={notificationAll} onChange={e => { setNotificationAll(e.target.checked); setNotificationOrgIds([]); setNotificationOrgId(""); }} /><span>Todos os clientes / organizações</span></label><div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-white/10 p-3">{(organizations.data ?? []).map(org => <label key={org.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationOrgIds.includes(org.id)} disabled={notificationAll || (!notificationOrgIds.includes(org.id) && notificationOrgIds.length >= 10)} onChange={e => { setNotificationAll(false); setNotificationOrgIds(prev => e.target.checked ? [...prev, org.id].slice(0,10) : prev.filter(id => id !== org.id)); }} /><span>{org.name}</span><span className="ml-auto text-xs text-slate-500">{org.slug}</span></label>)}</div></div>
                <label className="grid gap-2 text-sm">Título
                  <Input value={notificationTitle} onChange={e => setNotificationTitle(e.target.value)} maxLength={140} className="resize-none border-white/10 bg-[#102219]" />
                </label>
                <label className="grid gap-2 text-sm sm:col-span-2">Mensagem
                  <textarea value={notificationBody} onChange={e => setNotificationBody(e.target.value)} maxLength={2000} rows={4} placeholder="Ex.: A sua assinatura WhappNus Pro termina dentro de 3 dias. Contacte a equipa para renovar e manter a IA activa." className="resize-none rounded-md border border-white/10 bg-[#102219] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400/50" />
                </label>
                <div className="sm:col-span-2"><Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={(!notificationAll && notificationOrgIds.length === 0) || notificationTitle.trim().length < 3 || notificationBody.trim().length < 3 || sendNotification.isPending} onClick={() => sendNotification.mutate({ ...(notificationAll ? { all_organizations: true } : { organization_ids: notificationOrgIds }), title: notificationTitle.trim(), body: notificationBody.trim() })}>{sendNotification.isPending ? "A enviar…" : "Enviar notificação"}</Button></div>
              </CardContent>
            </Card>
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]">
              <div className="border-b border-white/10 p-4 text-sm font-semibold">Histórico de notificações</div>
              {notifications.isLoading ? <Loading /> : notifications.error ? <ErrorText error={notifications.error as Error} /> : (notifications.data ?? []).length === 0 ? <p className="p-4 text-sm text-slate-500">Ainda não foram enviadas notificações.</p> : <Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead>Organização</TableHead><TableHead>Título e mensagem</TableHead><TableHead>Enviada em</TableHead></TableRow></TableHeader><TableBody>{(notifications.data ?? []).map((n:any) => <TableRow key={n.id} className="border-white/[0.06]"><TableCell>{n.organizations?.name ?? "Organização"}</TableCell><TableCell><div className="font-medium">{n.title}</div><p className="mt-1 max-w-xl whitespace-pre-wrap text-xs text-slate-400">{n.body}</p></TableCell><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(n.created_at)}</TableCell></TableRow>)}</TableBody></Table>}
            </div>
          </section>}
          {tab === "payments" && <section><SectionIntro title="Transações" description="Acompanhamento de pagamentos, referências do fornecedor e falhas." />{payments.isLoading ? <Loading /> : payments.error ? <ErrorText error={payments.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Cliente</TableHead><TableHead className="text-slate-500">Fornecedor / referência</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Valor</TableHead><TableHead className="text-slate-500">Pago em</TableHead><TableHead className="text-slate-500">Registado</TableHead></TableRow></TableHeader><TableBody>{(payments.data ?? []).map((p:any) => <TableRow key={p.id} className="border-white/[0.06]"><TableCell>{p.organizations?.name ?? "—"}</TableCell><TableCell><div>{p.provider}</div><div className="max-w-48 truncate text-xs text-slate-500">{p.provider_payment_id ?? "Sem referência"}</div></TableCell><TableCell><Badge variant={statusVariant(p.status)}>{statusLabel[p.status] ?? p.status}</Badge>{p.failure_code && <div className="mt-1 text-xs text-red-300">{p.failure_code}</div>}</TableCell><TableCell>{money(p.amount_aoa)}</TableCell><TableCell className="text-xs text-slate-400">{date(p.paid_at)}</TableCell><TableCell className="text-xs text-slate-400">{date(p.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}

          {tab === "health" && <section className="space-y-5"><SectionIntro title="Saúde operacional" description="Estado observado nas tabelas de sessão WhatsApp, eventos e registos da IA." />{health.isLoading ? <Loading /> : health.error ? <ErrorText error={health.error as Error} /> : <><Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Sessões WhatsApp</CardTitle><CardDescription className="text-slate-500">Esta vista lê o estado registado; não reinicia nem termina sessões.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Organização</TableHead><TableHead className="text-slate-500">Número / nome</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Última ligação</TableHead><TableHead className="text-slate-500">Erro recente</TableHead></TableRow></TableHeader><TableBody>{(health.data?.sessions ?? []).map((s:any)=><TableRow key={s.id} className="border-white/[0.06]"><TableCell><div>{s.organization?.name ?? "Organização"}</div><div className="text-xs text-slate-500">{s.organization?.slug ?? s.organization_id}</div></TableCell><TableCell><div>{s.number?.phone_e164 ?? s.phone_number ?? "Número não identificado"}</div><div className="text-xs text-slate-500">{s.number?.verified_name ?? s.number?.display_name ?? s.display_name ?? s.whatsapp_number_id ?? "—"}</div></TableCell><TableCell><Badge variant={statusVariant(s.status)}>{statusLabel[s.status] ?? s.status}</Badge></TableCell><TableCell className="text-xs text-slate-400">{date(s.last_connected_at)}</TableCell><TableCell className="max-w-56 truncate text-xs text-red-300">{s.last_error ?? "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Eventos recentes da IA</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Evento</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Modelo</TableHead><TableHead className="text-slate-500">Latência</TableHead><TableHead className="text-slate-500">Data</TableHead></TableRow></TableHeader><TableBody>{(health.data?.aiLogs ?? []).slice(0,20).map((log:any)=><TableRow key={log.id} className="border-white/[0.06]"><TableCell>{log.event_type}</TableCell><TableCell><Badge variant={statusVariant(log.status)}>{statusLabel[log.status] ?? log.status}</Badge></TableCell><TableCell className="text-xs text-slate-400">{log.model ?? "—"}</TableCell><TableCell>{log.latency_ms == null ? "—" : `${log.latency_ms} ms`}</TableCell><TableCell className="text-xs text-slate-400">{date(log.created_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></>}</section>}


          {tab === "team" && <section className="space-y-5">
            <SectionIntro title="Equipa administrativa" description="Apenas contas que já existem no Supabase Auth podem receber acesso. Usa o mínimo de permissões necessário." />
            <Card className="border-emerald-300/20 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Adicionar ou atualizar administrador</CardTitle><CardDescription className="text-slate-500">O UUID identifica a conta exata. Só o proprietário pode guardar alterações nesta área.</CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-[2fr_1fr_auto]" onSubmit={e => { e.preventDefault(); saveAdmin.mutate({ user_id: teamUserId.trim(), role: teamRole, is_active: true }); }}><div><label className="mb-1.5 block text-xs text-slate-400">UUID da conta existente</label><Input required value={teamUserId} onChange={e => setTeamUserId(e.target.value)} className="border-white/10 bg-black/20" placeholder="UUID do utilizador no Supabase Auth" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Função</label><select value={teamRole} onChange={e => setTeamRole(e.target.value as "admin"|"support"|"billing"|"owner")} className="h-9 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="support">Suporte</option><option value="billing">Financeiro</option><option value="admin">Administrador</option><option value="owner">Proprietário</option></select></div><div className="flex items-end"><Button type="submit" disabled={saveAdmin.isPending || !teamUserId.trim()} className="bg-emerald-400 text-[#062016] hover:bg-emerald-300">{saveAdmin.isPending && <LoaderCircle className="size-4 animate-spin" />}Guardar acesso</Button></div></form><p className="mt-3 text-xs leading-5 text-amber-200/80">A função Proprietário concede controlo total. Não a atribuas a contas de clientes.</p></CardContent></Card>
            {team.isLoading ? <Loading /> : team.error ? <ErrorText error={team.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Utilizador</TableHead><TableHead className="text-slate-500">Função</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Criado</TableHead><TableHead className="text-right text-slate-500">Acesso</TableHead></TableRow></TableHeader><TableBody>{(team.data ?? []).map((member:any) => <TableRow key={member.user_id} className="border-white/[0.06]"><TableCell><div className="font-medium">{member.full_name ?? member.email ?? "Conta administrativa"}</div><div className="mt-1 text-xs text-slate-500">{member.email ?? member.user_id}</div></TableCell><TableCell><Badge variant={member.role === "owner" ? "default" : "secondary"}>{({owner:"Proprietário",admin:"Administrador",support:"Suporte",billing:"Financeiro"} as Record<string,string>)[member.role] ?? member.role}</Badge></TableCell><TableCell><Badge variant={member.is_active ? "default" : "destructive"}>{member.is_active ? "Ativo" : "Desativado"}</Badge></TableCell><TableCell className="text-xs text-slate-400">{date(member.created_at)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" disabled={saveAdmin.isPending || member.role === "owner" && member.user_id === teamUserId} className="border-white/10" onClick={() => saveAdmin.mutate({ user_id: member.user_id, role: member.role, is_active: !member.is_active })}>{member.is_active ? "Desativar" : "Reativar"}</Button></TableCell></TableRow>)}</TableBody></Table></div>}
          </section>}

          {tab === "group-ai" && <section className="space-y-5">
            <SectionIntro title="Treinar IA do Group Commander" description="Define o comportamento da IA que prepara e apoia os funis de grupo. As regras públicas e privadas são separadas para evitar misturar mensagens do grupo com atendimento individual." />
            {groupAi.isLoading ? <Loading /> : groupAi.error ? <ErrorText error={groupAi.error as Error} /> : <Card className="border-emerald-300/20 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Instruções de treino</CardTitle><CardDescription className="text-slate-500">Guarda as instruções centrais, regras de transmissão para grupos e regras para conversas privadas. Mantém o envio limitado a grupos autorizados e etapas aprovadas.</CardDescription></CardHeader><CardContent className="space-y-4">
              <div className="space-y-1.5"><label className="text-sm font-medium">Instrução principal da IA</label><Textarea value={groupAiPrompt} onChange={e => setGroupAiPrompt(e.target.value)} rows={7} placeholder="Define a função da IA, tom, objectivos do funil, limites, como escrever mensagens e o que nunca deve inventar." className="resize-none border-white/10 bg-[#102219]" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Regras para grupos públicos / transmissão do funil</label><Textarea value={groupAiPublicRules} onChange={e => setGroupAiPublicRules(e.target.value)} rows={4} placeholder="Ex.: só enviar etapas aprovadas, respeitar horários e intervalos, não responder a conversas alheias nem repetir envios." className="resize-none border-white/10 bg-[#102219]" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Regras para mensagens privadas (DM)</label><Textarea value={groupAiPrivateRules} onChange={e => setGroupAiPrivateRules(e.target.value)} rows={4} placeholder="Define como distinguir um contacto privado de uma mensagem no grupo, quando encaminhar para atendimento e que dados nunca partilhar no grupo." className="resize-none border-white/10 bg-[#102219]" /></div>
              <label className="flex items-center gap-3 rounded-lg border border-white/10 p-3 text-sm"><input type="checkbox" checked={groupAiActive} onChange={e => setGroupAiActive(e.target.checked)} className="size-4 accent-emerald-400" />Activar configuração de treino para os funis do Group Commander</label>
              <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100/80">Segurança operacional: a IA não deve iniciar conversas privadas nem publicar conteúdo fora dos grupos e etapas autorizados. A configuração é guardada no servidor; a geração de texto por IA só será usada por etapas que explicitamente activem esse modo no worker.</p>
              <Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={saveGroupAi.isPending || groupAiActive && groupAiPrompt.trim().length < 20} onClick={() => saveGroupAi.mutate()}>{saveGroupAi.isPending ? "A guardar treino…" : "Guardar configuração de treino"}</Button>
            </CardContent></Card>}
          </section>}

          {tab === "groups" && <section className="space-y-6">
            <SectionIntro title="WhappNus Group Commander" description="Gestão de grupos, funis e fila de disparos. Novos grupos ficam desativados até serem validados." />
            {groupCommander.isLoading ? <Loading /> : groupCommander.error ? <ErrorText error={groupCommander.error as Error} /> : <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Criar funil</CardTitle><CardDescription className="text-slate-500">Escolhe o tipo de agendamento para as etapas.</CardDescription></CardHeader><CardContent className="space-y-3">
                  <Input value={groupFlowName} onChange={e => setGroupFlowName(e.target.value)} placeholder="Ex.: Funil de Boas-vindas" className="border-white/10 bg-[#102219]" />
                  <select value={groupFlowMode} onChange={e => setGroupFlowMode(e.target.value as "relative" | "calendar")} className="h-10 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="relative">Atraso relativo</option><option value="calendar">Calendário fixo</option></select>
                  <Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={groupFlowName.trim().length < 2 || saveGroupFlow.isPending} onClick={() => saveGroupFlow.mutate()}>Criar funil</Button>
                  <div className="space-y-2">{(groupCommander.data?.flows ?? []).map((flow: any) => <div key={flow.id} className="flex flex-wrap items-center gap-2"><button onClick={() => { setGroupFlowId(flow.id); setGroupFlowMode(flow.trigger_mode); }} className={groupFlowId === flow.id ? "flex min-w-0 flex-1 items-center justify-between rounded-lg border border-emerald-300/40 bg-emerald-300/5 p-3 text-left" : "flex min-w-0 flex-1 items-center justify-between rounded-lg border border-white/10 p-3 text-left"}><span><span className="block text-sm font-medium">{flow.name}</span><span className="text-xs text-slate-500">{flow.trigger_mode === "relative" ? "Atraso relativo" : "Calendário fixo"}</span></span><Badge variant={flow.is_active ? "default" : "secondary"}>{flow.is_active ? "Activo" : "Rascunho"}</Badge></button><Button variant="outline" size="sm" onClick={() => toggleGroupFlow.mutate({ id: flow.id, is_active: !flow.is_active })}>{flow.is_active ? "Pausar" : "Activar"}</Button><Button type="button" variant="destructive" size="icon" aria-label={"Eliminar funil " + flow.name} title="Eliminar funil" disabled={deleteGroupFlow.isPending} onClick={() => { if (window.confirm("Eliminar o funil “" + flow.name + "”? As etapas serão apagadas, os grupos associados ficarão desactivados e as tarefas pendentes serão canceladas.")) deleteGroupFlow.mutate(flow.id); }}><Trash2 className="size-4" /></Button></div>)}</div>
                </CardContent></Card>
                <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Registar grupo</CardTitle><CardDescription className="text-slate-500">Usa o JID real do grupo e um número QR/Baileys ligado.</CardDescription></CardHeader><CardContent className="space-y-3">
                  <Input value={groupLabel} onChange={e => setGroupLabel(e.target.value)} placeholder="Etiqueta interna" className="border-white/10 bg-[#102219]" />
                  <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Nome do grupo" className="border-white/10 bg-[#102219]" />
                  <div className="space-y-2">
                  <Button type="button" variant="outline" disabled={!groupNumberId || discoverGroups.isPending} onClick={() => discoverGroups.mutate()}>{discoverGroups.isPending ? "A procurar grupos reais…" : "Descobrir grupos da sessão"}</Button>
                  {discoveredGroups.length > 0 && <select value={groupJid} onChange={e => { const selected = discoveredGroups.find(g => g.id === e.target.value); setGroupJid(e.target.value); if (selected) { setGroupName(selected.subject); setGroupLabel(selected.subject); } }} className="h-10 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Seleccionar grupo descoberto</option>{discoveredGroups.map(g => <option key={g.id} value={g.id}>{g.subject} · {g.participants} participantes</option>)}</select>}
                  <Input value={groupJid} onChange={e => setGroupJid(e.target.value)} placeholder="JID do grupo terminado em @g.us (ou escolha um grupo descoberto)" className="border-white/10 bg-[#102219]" />
                  {discoveredGroups.length > 0 && <p className="text-xs text-slate-500">A lista vem directamente da sessão Baileys escolhida; se o grupo não aparecer, confirma que o WhatsApp está conectado e participa nesse grupo.</p>}
                </div>
                  <select value={groupNumberId} onChange={e => { setGroupNumberId(e.target.value); setDiscoveredGroups([]); setGroupJid(""); setGroupName(""); setGroupLabel(""); }} className="h-10 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Seleccionar número QR/Baileys</option>{(groupCommander.data?.numbers ?? []).map((n: any) => <option key={n.id} value={n.id}>{n.display_name || n.phone_e164 || n.id} · {n.status}</option>)}</select>
                  <select value={groupFlowId} onChange={e => setGroupFlowId(e.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Sem funil associado</option>{(groupCommander.data?.flows ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                  <Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={!groupNumberId || groupLabel.trim().length < 2 || groupName.trim().length < 2 || !groupJid.trim().endsWith("@g.us") || saveGroupConnection.isPending} onClick={() => saveGroupConnection.mutate()}>Guardar grupo desactivado</Button>
                </CardContent></Card>
              </div>
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Banco multimédia</CardTitle><CardDescription className="text-slate-500">Carrega imagens, áudios, vídeos e documentos até 20 MB. Os ficheiros ficam num bucket privado e só a equipa Super Admin pode gerir os assets.</CardDescription></CardHeader><CardContent className="space-y-3"><Input type="file" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={e => setGroupAssetFile(e.target.files?.[0] ?? null)} className="border-white/10 bg-[#102219]" /><div className="flex flex-wrap items-center gap-3">{groupAssetFile && <span className="text-xs text-slate-400">{groupAssetFile.name} · {(groupAssetFile.size / (1024*1024)).toFixed(2)} MB</span>}<Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={!groupAssetFile || uploadGroupAsset.isPending} onClick={() => uploadGroupAsset.mutate()}>{uploadGroupAsset.isPending ? "A carregar…" : "Guardar no banco multimédia"}</Button></div><div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">{(groupCommander.data?.assets ?? []).map((asset: any) => <button key={asset.id} type="button" onClick={() => { setGroupStepAssetPath(asset.storage_path); setGroupStepType(asset.asset_type); }} className={groupStepAssetPath === asset.storage_path ? "min-w-0 rounded-lg border border-emerald-300/50 bg-emerald-300/5 p-3 text-left" : "min-w-0 rounded-lg border border-white/10 p-3 text-left"}><div className="mb-2 flex h-36 items-center justify-center overflow-hidden rounded-md bg-black/30">{asset.asset_type === "image" && groupAssetUrls[asset.storage_path] ? <img src={groupAssetUrls[asset.storage_path]} alt={asset.name} className="h-full w-full object-contain" /> : asset.asset_type === "video" && groupAssetUrls[asset.storage_path] ? <video src={groupAssetUrls[asset.storage_path]} controls preload="metadata" className="max-h-full max-w-full" /> : asset.asset_type === "audio" && groupAssetUrls[asset.storage_path] ? <audio src={groupAssetUrls[asset.storage_path]} controls preload="metadata" className="w-full px-2" /> : <span className="text-xs text-slate-500">{asset.asset_type === "document" ? "Pré-visualização indisponível" : "A preparar pré-visualização…"}</span>}</div><span className="block truncate text-sm font-medium">{asset.name}</span><span className="mt-1 block text-xs text-slate-500">{asset.asset_type} · {asset.mime_type} · {(Number(asset.file_size)/(1024*1024)).toFixed(2)} MB</span></button>)}{(groupCommander.data?.assets ?? []).length === 0 && <p className="text-xs text-slate-500">Ainda não há assets guardados.</p>}</div></CardContent></Card>
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Construtor de etapas e agendamento</CardTitle><CardDescription className="text-slate-500">Cada etapa pode enviar texto ou um asset multimédia guardado. A fila é executada pelo worker Railway com controlo de estado.</CardDescription></CardHeader><CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2"><select value={groupFlowId} onChange={e => { const f = (groupCommander.data?.flows ?? []).find((x: any) => x.id === e.target.value); setGroupFlowId(e.target.value); if (f) setGroupFlowMode(f.trigger_mode); }} className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Seleccionar funil</option>{(groupCommander.data?.flows ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select value={groupStepType} onChange={e => setGroupStepType(e.target.value as any)} className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="text">Texto fixo</option><option value="ai_text">Texto gerado pela IA treinada</option><option value="image">Imagem (asset guardado)</option><option value="audio">Áudio (asset guardado)</option><option value="video">Vídeo (asset guardado)</option><option value="document">Documento (asset guardado)</option></select></div>
                {groupFlowMode === "relative" ? <Input type="number" min="0" value={groupStepDelay} onChange={e => setGroupStepDelay(e.target.value)} placeholder="Atraso em minutos" className="border-white/10 bg-[#102219]" /> : <Input type="datetime-local" value={groupStepAt} onChange={e => setGroupStepAt(e.target.value)} className="border-white/10 bg-[#102219]" />}
                {(groupStepType === "text" || groupStepType === "ai_text") ? <textarea value={groupStepText} onChange={e => setGroupStepText(e.target.value)} rows={3} placeholder={groupStepType === "ai_text" ? "Instrução para a IA gerar a mensagem deste passo (ex.: criar uma mensagem de boas-vindas com CTA para..." : "Mensagem de texto para esta etapa"} className="w-full resize-none rounded-md border border-white/10 bg-[#102219] px-3 py-2 text-sm" /> : <div className="space-y-2"><select value={groupStepAssetPath} onChange={e => setGroupStepAssetPath(e.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Seleccionar asset do banco multimédia</option>{(groupCommander.data?.assets ?? []).filter((asset: any) => asset.asset_type === groupStepType).map((asset: any) => <option key={asset.id} value={asset.storage_path}>{asset.name} · {asset.mime_type}</option>)}</select><textarea value={groupStepText} onChange={e => setGroupStepText(e.target.value)} rows={2} placeholder="Legenda opcional do ficheiro" className="resize-none w-full rounded-md border border-white/10 bg-[#102219] px-3 py-2 text-sm" /></div>}
                <Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" disabled={!groupFlowId || ((groupStepType === "text" || groupStepType === "ai_text") ? !groupStepText.trim() : !selectedGroupAsset || selectedGroupAsset.asset_type !== groupStepType) || saveGroupStep.isPending || (groupFlowMode === "calendar" && !groupStepAt)} onClick={() => saveGroupStep.mutate()}>{saveGroupStep.isPending ? "A guardar…" : "Guardar etapa"}</Button>
                <div className="space-y-2">{(groupCommander.data?.steps ?? []).filter((step: any) => step.flow_id === groupFlowId).map((step: any) => <div key={step.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3"><div><div className="text-sm font-medium">Etapa {step.position + 1} · {step.action_type}</div><div className="text-xs text-slate-500">{step.trigger_mode === "relative" ? "Após " + step.delay_minutes + " min" : date(step.scheduled_at)}</div><div className="mt-1 whitespace-pre-wrap text-sm">{step.text_content || step.asset_file_name || "Asset ainda não associado"}</div></div><Button size="sm" variant="outline" onClick={() => { setScheduleStepId(step.id); setScheduleAt(""); }}>Preparar agendamento</Button></div>)}</div>
                <div className="grid gap-3 sm:grid-cols-3"><select value={scheduleConnectionId} onChange={e => setScheduleConnectionId(e.target.value)} className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Grupo de destino</option>{(groupCommander.data?.connections ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.group_name} {g.is_enabled ? "" : "(desactivado)"}</option>)}</select><select value={scheduleStepId} onChange={e => setScheduleStepId(e.target.value)} className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Etapa</option>{(groupCommander.data?.steps ?? []).filter((step: any) => !groupFlowId || step.flow_id === groupFlowId).map((step: any) => <option key={step.id} value={step.id}>Etapa {step.position + 1} · {step.action_type}</option>)}</select><Input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} className="border-white/10 bg-[#102219]" /></div>
                <Button variant="outline" disabled={!scheduleConnectionId || !scheduleStepId || !scheduleAt || scheduleGroupJob.isPending} onClick={() => scheduleGroupJob.mutate()}>Agendar disparo</Button>
              </CardContent></Card>
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Grupos associados</CardTitle><CardDescription className="text-slate-500">Podes trocar o funil de cada grupo sem recriar o grupo nem alterar os outros grupos.</CardDescription></CardHeader><CardContent className="space-y-3">{(groupCommander.data?.connections ?? []).length === 0 ? <Empty text="Ainda não há grupos registados." /> : (groupCommander.data?.connections ?? []).map((g: any) => <div key={g.id} className="flex flex-col gap-3 rounded-lg border border-white/10 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="font-medium">{g.group_name}</div><div className="break-all text-xs text-slate-500">{g.group_jid} · {g.whatsapp_numbers?.display_name || g.whatsapp_number_id || "Sem número"}</div></div><div className="flex items-center gap-2"><Badge variant={g.is_enabled ? "default" : "secondary"}>{g.is_enabled ? "Activo" : "Desactivado"}</Badge><Button size="sm" variant="outline" onClick={() => toggleGroupConnection.mutate({ id: g.id, is_enabled: !g.is_enabled })}>{g.is_enabled ? "Desactivar" : "Activar"}</Button><Button type="button" size="sm" variant="destructive" disabled={deleteGroupConnection.isPending} onClick={() => { if (window.confirm(`Eliminar a associação ao grupo “${g.group_name}”? As tarefas da fila e o histórico dessa associação serão removidos. Esta acção não pode ser anulada.`)) deleteGroupConnection.mutate(g.id); }}>Eliminar grupo</Button></div></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><select aria-label={"Funil do grupo " + g.group_name} value={g.active_flow_id ?? ""} onChange={e => assignGroupFlow.mutate({ id: g.id, active_flow_id: e.target.value || null })} disabled={assignGroupFlow.isPending} className="h-10 min-w-0 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="">Sem funil associado</option>{(groupCommander.data?.flows ?? []).map((f: any) => <option key={f.id} value={f.id}>{f.name}{f.is_active ? "" : " (rascunho)"}</option>)}</select><Button type="button" variant="outline" size="sm" disabled={assignGroupFlow.isPending || (g.active_flow_id ?? "") === ""} onClick={() => assignGroupFlow.mutate({ id: g.id, active_flow_id: null })}>Remover associação</Button></div></div>)}</CardContent></Card>
              <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Fila de disparos</CardTitle><CardDescription className="text-slate-500">A fila de envio é processada pelo worker do motor WhatsApp no Railway. Confirma o estado e o erro de cada tarefa nesta tabela.</CardDescription></CardHeader><CardContent>{(groupCommander.data?.jobs ?? []).length === 0 ? <Empty text="Ainda não há disparos agendados." /> : <div className="max-h-[420px] overflow-auto"><Table><TableHeader><TableRow className="border-white/10"><TableHead>Data</TableHead><TableHead>Estado</TableHead><TableHead>Tentativas / erro</TableHead></TableRow></TableHeader><TableBody>{(groupCommander.data?.jobs ?? []).map((job: any) => <TableRow key={job.id} className="border-white/[0.06]"><TableCell>{date(job.due_at)}</TableCell><TableCell><Badge variant={job.status === "sent" ? "default" : "secondary"}>{job.status}</Badge></TableCell><TableCell className="text-xs text-slate-500">{job.attempts} · {job.last_error || "—"}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
            </>}
          </section>}
          {tab === "emails" && <section className="space-y-5">
            <SectionIntro title="Logs de e-mails automáticos" description="Envios registados pela WhappNus: confirmação de pagamento, boas-vindas, avisos de assinatura e falhas de entrega conhecidas pela aplicação. A confirmação inicial do Supabase Auth só aparece aqui se a integração de logging estiver ligada ao evento." />
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_220px_auto]">
              <Input value={emailSearch} onChange={e => setEmailSearch(e.target.value)} placeholder="Pesquisar destinatário, modelo ou referência…" className="border-white/10 bg-[#102219]" />
              <select value={emailStatus} onChange={e => setEmailStatus(e.target.value)} aria-label="Filtrar estado do e-mail" className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="all">Todos os estados</option><option value="sent">Enviado</option><option value="delivered">Entregue</option><option value="failed">Falhou</option><option value="sending">A enviar</option><option value="pending">Pendente</option><option value="bounced">Devolvido</option><option value="complained">Queixa</option></select>
              <select value={emailTemplate} onChange={e => setEmailTemplate(e.target.value)} aria-label="Filtrar modelo de e-mail" className="h-10 rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="all">Todos os modelos</option><option value="welcome">Boas-vindas</option><option value="payment_pending">Pagamento pendente</option><option value="payment_approved">Pagamento aprovado</option><option value="subscription_renewed">Renovação</option><option value="plan_changed">Mudança de plano</option><option value="payment_cancelled">Pagamento cancelado</option><option value="payment_refunded">Reembolso</option><option value="subscription_expiring">Plano a expirar</option><option value="subscription_expired">Plano expirado</option><option value="auth_confirm_signup">Confirmação de conta</option><option value="auth_reset_password">Recuperação de palavra-passe</option></select>
              <Button type="button" variant="outline" className="border-white/10" onClick={() => void emailLogs.refetch()} disabled={emailLogs.isFetching}><RefreshCw className={`mr-2 size-4 ${emailLogs.isFetching ? "animate-spin" : ""}`} />Actualizar</Button>
            </div>
            {emailLogs.data && (!emailLogs.data.meta.brevo_configured || Boolean(emailLogs.data.meta.brevo_error)) && <div role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{!emailLogs.data.meta.brevo_configured ? "Os registos locais estão disponíveis, mas a chave BREVO_API_KEY não foi encontrada nos segredos das Edge Functions do Supabase." : emailLogs.data.meta.brevo_error?.includes("401") ? "A Brevo recusou a autenticação (401). Causas prováveis: chave API inválida/revogada ou IP do servidor bloqueado. Abre a Brevo diretamente (não através dos links do e-mail), vai a Segurança > IPs autorizados e verifica a lista de IPs bloqueados. Para servidores serverless com IP de saída variável, configura autorização automática de IPs, se disponível; em alternativa, autoriza os IPs de saída estáveis de cada servidor. Se não reconheceres a atividade do alerta, não autorizes esse IP: revoga a chave e cria uma nova. Depois atualiza BREVO_API_KEY nos segredos do Supabase e nas variáveis do Netlify." : `A consulta dos eventos da Brevo falhou: ${emailLogs.data.meta.brevo_error ?? "erro desconhecido"}. Confirma a chave API, a autorização de IP e as permissões.`}</div>}
            {emailLogs.isLoading ? <Loading /> : emailLogs.error ? <ErrorText error={emailLogs.error as Error} /> : (emailLogs.data?.rows ?? []).length === 0 ? <Empty text="Ainda não há registos de e-mail para estes filtros. Depois de um envio, actualiza o painel; os eventos do fornecedor podem demorar alguns instantes a aparecer." /> :
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead>Data</TableHead><TableHead>Destinatário</TableHead><TableHead>Tipo / modelo</TableHead><TableHead>Estado</TableHead><TableHead>Fornecedor / ID</TableHead><TableHead>Erro / organização</TableHead></TableRow></TableHeader><TableBody>{(emailLogs.data?.rows ?? []).map((log: any) => <TableRow key={log.id} className="border-white/[0.06]"><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(log.sent_at ?? log.created_at)}</TableCell><TableCell><div className="max-w-56 break-all text-sm">{log.recipient_email ?? "E-mail não registado"}</div><div className="mt-1 text-[10px] text-slate-500">{log.recipient_hash ? "Hash: " + String(log.recipient_hash).slice(0, 12) + "…" : log.id.slice(0, 8)}</div></TableCell><TableCell><div className="font-medium">{(({ welcome: "Boas-vindas", payment_pending: "Pagamento pendente", payment_approved: "Pagamento aprovado", subscription_renewed: "Renovação", plan_changed: "Mudança de plano", payment_cancelled: "Pagamento cancelado", payment_refunded: "Reembolso", subscription_expiring: "Plano a expirar", subscription_expired: "Plano expirado", auth_confirm_signup: "Confirmação de conta", auth_reset_password: "Recuperação de palavra-passe", unknown: "Tipo não identificado" } as Record<string, string>)[log.template_code] ?? String(log.template_code ?? "Tipo não identificado"))}</div><div className="text-xs text-slate-500">{log.event_type ?? "Evento sem tipo"}</div>{log.metadata?.subject && <div className="mt-1 max-w-64 truncate text-[10px] text-slate-500" title={log.metadata.subject}>{log.metadata.subject}</div>}</TableCell><TableCell><Badge variant={["failed","bounced","complained"].includes(log.status) ? "destructive" : ["sent","delivered"].includes(log.status) ? "default" : "secondary"}>{statusLabel[log.status] ?? log.status}</Badge></TableCell><TableCell><div>{log.provider ?? "—"}</div><div className="max-w-40 break-all text-[10px] text-slate-500">{log.provider_message_id ?? "Sem ID do fornecedor"}</div>{["welcome", "payment_pending", "payment_approved", "subscription_renewed", "plan_changed", "payment_cancelled", "payment_refunded", "subscription_expiring", "subscription_expired"].includes(log.template_code) && log.recipient_email && (log.source !== "brevo" || log.provider_message_id) && <Button type="button" size="sm" variant="outline" className="mt-2 border-white/10" disabled={resendEmail.isPending} onClick={() => { if (window.confirm(`Reenviar o e-mail ${log.template_code} para ${log.recipient_email}? Será enviado um novo e-mail, mesmo que o anterior tenha sido entregue.`)) resendEmail.mutate(log.id); }}><Mail className="mr-1 size-3" />{resendEmail.isPending ? "A enviar…" : "Reenviar"}</Button>}</TableCell><TableCell><div className="text-xs text-slate-300">{log.organization_name ?? "Plataforma / autenticação"}</div>{log.error_message && <div className="mt-1 max-w-64 break-words text-xs text-red-300">{log.error_message}</div>}</TableCell></TableRow>)}</TableBody></Table></div>}
          </section>}
          {tab === "audit" && <section><SectionIntro title="Registo de auditoria" description="Histórico de ações privilegiadas para rastreabilidade e investigação." />{audit.isLoading ? <Loading /> : audit.error ? <ErrorText error={audit.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Data</TableHead><TableHead className="text-slate-500">Ação</TableHead><TableHead className="text-slate-500">Alvo</TableHead><TableHead className="text-slate-500">Organização</TableHead><TableHead className="text-slate-500">Detalhes</TableHead></TableRow></TableHeader><TableBody>{(audit.data ?? []).map((entry:any)=><TableRow key={entry.id} className="border-white/[0.06]"><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(entry.created_at)}</TableCell><TableCell><div className="font-medium">{entry.action_label ?? entry.action}</div><div className="text-xs text-slate-500">{entry.actor_name ?? entry.actor_user_id ?? "Sistema"}{entry.actor_email ? " · " + entry.actor_email : ""}</div></TableCell><TableCell>{entry.target_label ?? entry.target_type}<div className="text-xs text-slate-500">{entry.target_id ?? "—"}</div></TableCell><TableCell className="text-xs text-slate-400">{entry.organization_name ?? "Plataforma"}</TableCell><TableCell className="max-w-72 truncate text-xs text-slate-400">{auditDetails(entry.details)}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}
        </div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, alert = false }: { icon: typeof Building2; label: string; value?: number | undefined; note: string; alert?: boolean }) {
  return <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className={`flex size-10 items-center justify-center rounded-xl ${alert ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}><Icon className="size-5" /></div><ArrowUpRight className="size-4 text-slate-600" /></div><div className="mt-5 text-sm text-slate-400">{label}</div><div className="mt-1 font-display text-3xl font-bold tracking-tight">{value == null ? "—" : value.toLocaleString("pt-AO")}</div><div className="mt-2 text-xs text-slate-500">{note}</div></CardContent></Card>;
}
function Loading() { return <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#0b1912] p-10 text-sm text-slate-400"><LoaderCircle className="size-4 animate-spin" />A carregar dados autorizados…</div>; }
function ErrorText({ error }: { error: Error }) { return <div className="rounded-xl border border-red-300/20 bg-red-300/5 p-4 text-sm text-red-200">{error.message}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">{text}</div>; }
function SecurityRow({ title, text }: { title: string; text: string }) { return <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><div><div className="text-sm font-medium">{title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{text}</div></div></div>; }
function SectionIntro({ title, description }: { title: string; description: string }) { return <div className="mb-5"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>; }
