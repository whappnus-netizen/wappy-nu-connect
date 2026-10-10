import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Building2, CheckCircle2, CircleDollarSign, CreditCard, LayoutDashboard,
  LoaderCircle, LockKeyhole, LogOut, Plus, RefreshCw, Search, ShieldCheck,
  Smartphone, Sparkles, Users, Wallet, AlertTriangle, ArrowUpRight, Clock3,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/superadmin")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth/login" });
  },
  head: () => ({ meta: [{ title: "Super Admin — Wapnus" }, { name: "description", content: "Painel de controlo da plataforma Wapnus." }] }),
  component: SuperAdminPage,
});

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
async function adminApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("superadmin-api", { body: { action, ...payload } });
  if (error) {
    let message = error.message || "Falha ao comunicar com o serviço administrativo.";
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === "function") {
        const body = await response.clone().json() as { error?: string };
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
  suspension_reason: string | null; created_at: string; members_count: number; whatsapp_count: number;
  ai_agents_active: number; whatsapp_statuses: { status: string; phone_e164: string | null; display_name: string | null }[];
};
type Plan = {
  id: string; code: string; name: string; description: string; billing_interval: "monthly" | "yearly";
  price_aoa: number; trial_days: number; limits: Record<string, unknown>; features: Record<string, unknown>;
  is_active: boolean; sort_order: number;
};
const statusLabel: Record<string, string> = {
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
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function SuperAdminPage() {
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [planInterval, setPlanInterval] = useState<"monthly" | "yearly">("monthly");
  const [planPrice, setPlanPrice] = useState("");
  const [showPlanForm, setShowPlanForm] = useState(false);
  const client = useQueryClient();

  const overview = useQuery({ queryKey: ["superadmin", "dashboard"], queryFn: () => adminApi<{ metrics: Metrics; recentAudit: any[] }>("dashboard"), retry: false });
  const organizations = useQuery({ queryKey: ["superadmin", "organizations", search], queryFn: () => adminApi<Organization[]>("organizations.list", { search }), enabled: tab === "organizations", retry: false });
  const plans = useQuery({ queryKey: ["superadmin", "plans"], queryFn: () => adminApi<Plan[]>("plans.list"), enabled: tab === "plans", retry: false });
  const subscriptions = useQuery({ queryKey: ["superadmin", "subscriptions"], queryFn: () => adminApi<any[]>("subscriptions.list"), enabled: tab === "subscriptions", retry: false });
  const payments = useQuery({ queryKey: ["superadmin", "payments"], queryFn: () => adminApi<any[]>("payments.list"), enabled: tab === "payments", retry: false });
  const health = useQuery({ queryKey: ["superadmin", "health"], queryFn: () => adminApi<any>("health"), enabled: tab === "health", retry: false });
  const audit = useQuery({ queryKey: ["superadmin", "audit"], queryFn: () => adminApi<any[]>("audit.list"), enabled: tab === "audit", retry: false });

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
  const savePlan = useMutation({
    mutationFn: () => adminApi<Plan>("plans.save", {
      code: planCode.trim() || slugify(planName).replace(/-/g, "_") + (planInterval === "yearly" ? "_yearly" : "_monthly"),
      name: planName.trim(), description: "Plano Wapnus", billing_interval: planInterval,
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
          <div><div className="font-display text-lg font-bold tracking-tight">Wapnus</div><div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300">Control Center</div></div>
        </div>
        <div className="px-4 pt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Plataforma</div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {[
            ["overview", LayoutDashboard, "Visão geral"], ["organizations", Building2, "Organizações"],
            ["plans", CircleDollarSign, "Planos e preços"], ["subscriptions", CreditCard, "Assinaturas"],
            ["payments", Wallet, "Pagamentos"], ["health", Activity, "WhatsApp & IA"], ["audit", LockKeyhole, "Auditoria"],
          ].map(([id, Icon, label]) => {
            const I = Icon as typeof LayoutDashboard;
            return <button key={id as string} onClick={() => setTab(id as string)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${tab === id ? "bg-emerald-400/10 font-semibold text-emerald-200 ring-1 ring-emerald-300/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><I className="size-4" />{label as string}{tab === id && <span className="ml-auto size-1.5 rounded-full bg-emerald-300" />}</button>;
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3"><div className="flex size-9 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/10"><LockKeyhole className="size-4 text-emerald-200" /></div><div className="min-w-0"><div className="text-xs font-semibold">Área restrita</div><div className="text-[11px] text-slate-500">Acesso validado no servidor</div></div></div>
          <Button variant="ghost" className="mt-3 w-full justify-start text-slate-400 hover:text-white" onClick={() => void supabase.auth.signOut().then(() => { window.location.href = "/auth/login"; })}><LogOut />Terminar sessão</Button>
        </div>
      </aside>

      <main className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between gap-4 border-b border-white/10 bg-[#07110e]/90 px-5 backdrop-blur-xl sm:px-8">
          <div><div className="flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.75)]" />PAINEL DE CONTROLO</div><h1 className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">{tab === "overview" ? "Visão geral" : tab === "organizations" ? "Organizações" : tab === "plans" ? "Planos e preços" : tab === "subscriptions" ? "Assinaturas" : tab === "payments" ? "Pagamentos" : tab === "health" ? "Saúde operacional" : "Auditoria da plataforma"}</h1></div>
          <div className="flex items-center gap-2"><Badge variant="outline" className="hidden border-emerald-300/20 text-emerald-200 sm:inline-flex">AOA · Africa/Luanda</Badge><Button variant="outline" size="icon" className="border-white/10 bg-white/5 hover:bg-white/10" onClick={refreshAll} aria-label="Atualizar"><RefreshCw className="size-4" /></Button></div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 lg:hidden">
          {[
            ["overview", "Resumo"], ["organizations", "Clientes"], ["plans", "Planos"],
            ["subscriptions", "Assinaturas"], ["payments", "Pagamentos"], ["health", "Saúde"], ["audit", "Auditoria"],
          ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${tab === id ? "bg-emerald-300/10 text-emerald-200" : "text-slate-400 hover:bg-white/5"}`}>{label}</button>)}
        </nav>

        <div className="p-4 sm:p-8">
          {pageError && <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" /><div><div className="font-semibold text-amber-100">Não foi possível carregar o painel</div><p className="mt-1 text-slate-400">{pageError.message}. Confirma se a migração está aplicada e se a tua conta foi autorizada em <code>superadmin_users</code>.</p></div></div>}

          {tab === "overview" && <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-[#10251b] to-[#0b1712] p-6 sm:p-8">
              <div className="pointer-events-none absolute -right-8 -top-16 size-64 rounded-full border border-emerald-200/10" /><div className="pointer-events-none absolute -right-1 -top-9 size-48 rounded-full border border-emerald-200/10" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><Badge className="border-emerald-300/20 bg-emerald-300/10 text-emerald-200 hover:bg-emerald-300/10">Super Admin · Acesso privilegiado</Badge><h2 className="mt-4 max-w-2xl font-display text-2xl font-bold sm:text-3xl">O centro de comando da Wapnus.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Acompanha clientes, pagamentos, subscrições e o estado operacional num só lugar. As operações administrativas são autorizadas no servidor.</p></div><div className="flex items-center gap-2 text-xs text-slate-400"><CheckCircle2 className="size-4 text-emerald-300" /> Sessão protegida</div></div>
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
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]">{organizations.isLoading ? <Loading /> : organizations.error ? <ErrorText error={organizations.error as Error} /> : <Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Organização</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Equipa</TableHead><TableHead className="text-slate-500">WhatsApp</TableHead><TableHead className="text-slate-500">Agentes IA</TableHead><TableHead className="text-slate-500">Criada em</TableHead><TableHead className="text-right text-slate-500">Controlo</TableHead></TableRow></TableHeader><TableBody>{(organizations.data ?? []).map(org => <TableRow key={org.id} className="border-white/[0.06]"><TableCell><div className="font-medium text-slate-100">{org.name}</div><div className="mt-1 text-xs text-slate-500">{org.slug}</div></TableCell><TableCell><Badge variant={statusVariant(org.status)}>{statusLabel[org.status] ?? org.status}</Badge></TableCell><TableCell>{org.members_count}</TableCell><TableCell><div>{org.whatsapp_count} número(s)</div><div className="mt-1 text-[11px] text-slate-500">{org.whatsapp_statuses.slice(0,1).map(n => n.status).join("") || "Sem conexão"}</div></TableCell><TableCell>{org.ai_agents_active}</TableCell><TableCell className="text-xs text-slate-400">{date(org.created_at)}</TableCell><TableCell className="text-right"><select aria-label={`Estado de ${org.name}`} value={org.status} disabled={updateStatus.isPending} onChange={e => { const status = e.target.value; const reason = ["suspended","blocked"].includes(status) ? window.prompt("Motivo (registado na auditoria):", "") ?? "" : ""; updateStatus.mutate({ organization_id: org.id, status, reason }); }} className="max-w-36 rounded-lg border border-white/10 bg-[#102219] px-2 py-2 text-xs text-slate-200"><option value="active">Ativa</option><option value="trial">Teste</option><option value="setup">Configuração</option><option value="suspended">Suspender</option><option value="blocked">Bloquear</option><option value="cancelled">Cancelar</option></select></TableCell></TableRow>)}</TableBody></Table>}</div>
          </section>}

          {tab === "plans" && <section className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Catálogo comercial</h2><p className="mt-1 text-sm text-slate-500">Preços em Kwanza. Planos a zero ficam inativos para evitar vendas por engano.</p></div><Button className="bg-emerald-400 text-[#062016] hover:bg-emerald-300" onClick={() => setShowPlanForm(v => !v)}><Plus className="size-4" /> Criar plano</Button></div>
            {showPlanForm && <Card className="border-emerald-300/20 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Novo plano recorrente</CardTitle></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); savePlan.mutate(); }}><div><label className="mb-1.5 block text-xs text-slate-400">Nome</label><Input required value={planName} onChange={e => { setPlanName(e.target.value); if (!planCode) setPlanCode(slugify(e.target.value).replace(/-/g,"_")); }} className="border-white/10 bg-black/20" placeholder="Pro" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Código (opcional)</label><Input value={planCode} onChange={e => setPlanCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,""))} className="border-white/10 bg-black/20" placeholder="pro_monthly" /></div><div><label className="mb-1.5 block text-xs text-slate-400">Periodicidade</label><select value={planInterval} onChange={e => setPlanInterval(e.target.value as "monthly"|"yearly")} className="h-9 w-full rounded-md border border-white/10 bg-[#102219] px-3 text-sm"><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></div><div><label className="mb-1.5 block text-xs text-slate-400">Preço (AOA)</label><Input type="number" min="0" step="1" required value={planPrice} onChange={e => setPlanPrice(e.target.value)} className="border-white/10 bg-black/20" placeholder="15000" /></div><div className="flex gap-2 sm:col-span-2 lg:col-span-4"><Button type="submit" disabled={savePlan.isPending || !planName.trim() || planPrice === ""} className="bg-emerald-400 text-[#062016] hover:bg-emerald-300">{savePlan.isPending && <LoaderCircle className="size-4 animate-spin" />}Guardar plano</Button><Button type="button" variant="outline" className="border-white/10" onClick={() => setShowPlanForm(false)}>Cancelar</Button></div></form></CardContent></Card>}
            {plans.isLoading ? <Loading /> : plans.error ? <ErrorText error={plans.error as Error} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(plans.data ?? []).map(plan => <Card key={plan.id} className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{plan.name}</CardTitle><CardDescription className="mt-2 text-slate-500">{plan.code}</CardDescription></div><Badge variant={plan.is_active ? "default" : "secondary"}>{plan.is_active ? "Ativo" : "Inativo"}</Badge></div></CardHeader><CardContent><div className="font-display text-2xl font-bold">{money(plan.price_aoa)}<span className="ml-1 text-xs font-normal text-slate-500">/{plan.billing_interval === "monthly" ? "mês" : "ano"}</span></div><div className="mt-4 space-y-2 text-xs text-slate-400"><div className="flex justify-between"><span>Período de teste</span><span>{plan.trial_days} dias</span></div><div className="flex justify-between"><span>Números WhatsApp</span><span>{String(plan.limits?.whatsapp_numbers ?? "—")}</span></div><div className="flex justify-between"><span>Agentes IA</span><span>{String(plan.limits?.agents ?? "—")}</span></div><div className="flex justify-between"><span>Membros</span><span>{String(plan.limits?.team_members ?? "—")}</span></div></div>{plan.price_aoa <= 0 && <p className="mt-4 rounded-lg bg-amber-300/5 p-2 text-xs text-amber-200">Define um preço superior a zero antes de ativar este plano.</p>}</CardContent></Card>)}</div>}
          </section>}

          {tab === "subscriptions" && <section><SectionIntro title="Assinaturas" description="Estado, periodicidade, período e organização associada." />{subscriptions.isLoading ? <Loading /> : subscriptions.error ? <ErrorText error={subscriptions.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Cliente</TableHead><TableHead className="text-slate-500">Plano</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Valor</TableHead><TableHead className="text-slate-500">Renovação / fim</TableHead><TableHead className="text-slate-500">Criada</TableHead></TableRow></TableHeader><TableBody>{(subscriptions.data ?? []).map((s:any) => <TableRow key={s.id} className="border-white/[0.06]"><TableCell><div className="font-medium">{s.organizations?.name ?? "Organização"}</div><div className="text-xs text-slate-500">{s.organizations?.slug ?? s.organization_id}</div></TableCell><TableCell>{s.subscription_plans?.name ?? "Plano não associado"}<div className="text-xs text-slate-500">{s.billing_interval === "yearly" ? "Anual" : "Mensal"}</div></TableCell><TableCell><Badge variant={statusVariant(s.status)}>{statusLabel[s.status] ?? s.status}</Badge></TableCell><TableCell>{money(s.amount_aoa)}</TableCell><TableCell className="text-xs text-slate-400">{date(s.current_period_end)}</TableCell><TableCell className="text-xs text-slate-400">{date(s.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}

          {tab === "payments" && <section><SectionIntro title="Transações" description="Acompanhamento de pagamentos, referências do fornecedor e falhas." />{payments.isLoading ? <Loading /> : payments.error ? <ErrorText error={payments.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Cliente</TableHead><TableHead className="text-slate-500">Fornecedor / referência</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Valor</TableHead><TableHead className="text-slate-500">Pago em</TableHead><TableHead className="text-slate-500">Registado</TableHead></TableRow></TableHeader><TableBody>{(payments.data ?? []).map((p:any) => <TableRow key={p.id} className="border-white/[0.06]"><TableCell>{p.organizations?.name ?? "—"}</TableCell><TableCell><div>{p.provider}</div><div className="max-w-48 truncate text-xs text-slate-500">{p.provider_payment_id ?? "Sem referência"}</div></TableCell><TableCell><Badge variant={statusVariant(p.status)}>{statusLabel[p.status] ?? p.status}</Badge>{p.failure_code && <div className="mt-1 text-xs text-red-300">{p.failure_code}</div>}</TableCell><TableCell>{money(p.amount_aoa)}</TableCell><TableCell className="text-xs text-slate-400">{date(p.paid_at)}</TableCell><TableCell className="text-xs text-slate-400">{date(p.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}

          {tab === "health" && <section className="space-y-5"><SectionIntro title="Saúde operacional" description="Estado observado nas tabelas de sessão WhatsApp, eventos e registos da IA." />{health.isLoading ? <Loading /> : health.error ? <ErrorText error={health.error as Error} /> : <><Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Sessões WhatsApp</CardTitle><CardDescription className="text-slate-500">Esta vista lê o estado registado; não reinicia nem termina sessões.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Número / nome</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Última ligação</TableHead><TableHead className="text-slate-500">Erro recente</TableHead></TableRow></TableHeader><TableBody>{(health.data?.sessions ?? []).map((s:any)=><TableRow key={s.id} className="border-white/[0.06]"><TableCell>{s.phone_number ?? s.display_name ?? s.whatsapp_number_id ?? "—"}</TableCell><TableCell><Badge variant={statusVariant(s.status)}>{statusLabel[s.status] ?? s.status}</Badge></TableCell><TableCell className="text-xs text-slate-400">{date(s.last_connected_at)}</TableCell><TableCell className="max-w-56 truncate text-xs text-red-300">{s.last_error ?? "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardHeader><CardTitle className="text-base">Eventos recentes da IA</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Evento</TableHead><TableHead className="text-slate-500">Estado</TableHead><TableHead className="text-slate-500">Modelo</TableHead><TableHead className="text-slate-500">Latência</TableHead><TableHead className="text-slate-500">Data</TableHead></TableRow></TableHeader><TableBody>{(health.data?.aiLogs ?? []).slice(0,20).map((log:any)=><TableRow key={log.id} className="border-white/[0.06]"><TableCell>{log.event_type}</TableCell><TableCell><Badge variant={statusVariant(log.status)}>{statusLabel[log.status] ?? log.status}</Badge></TableCell><TableCell className="text-xs text-slate-400">{log.model ?? "—"}</TableCell><TableCell>{log.latency_ms == null ? "—" : `${log.latency_ms} ms`}</TableCell><TableCell className="text-xs text-slate-400">{date(log.created_at)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></>}</section>}

          {tab === "audit" && <section><SectionIntro title="Registo de auditoria" description="Histórico de ações privilegiadas para rastreabilidade e investigação." />{audit.isLoading ? <Loading /> : audit.error ? <ErrorText error={audit.error as Error} /> : <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1912]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="text-slate-500">Data</TableHead><TableHead className="text-slate-500">Ação</TableHead><TableHead className="text-slate-500">Alvo</TableHead><TableHead className="text-slate-500">Organização</TableHead><TableHead className="text-slate-500">Detalhes</TableHead></TableRow></TableHeader><TableBody>{(audit.data ?? []).map((entry:any)=><TableRow key={entry.id} className="border-white/[0.06]"><TableCell className="whitespace-nowrap text-xs text-slate-400">{date(entry.created_at)}</TableCell><TableCell className="font-medium">{entry.action}</TableCell><TableCell>{entry.target_type}<div className="text-xs text-slate-500">{entry.target_id ?? "—"}</div></TableCell><TableCell className="text-xs text-slate-400">{entry.organization_id ?? "—"}</TableCell><TableCell className="max-w-72 truncate text-xs text-slate-400">{JSON.stringify(entry.details ?? {})}</TableCell></TableRow>)}</TableBody></Table></div>}</section>}
        </div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, alert = false }: { icon: typeof Building2; label: string; value?: number; note: string; alert?: boolean }) {
  return <Card className="border-white/10 bg-[#0b1912] text-slate-100 shadow-none"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div className={`flex size-10 items-center justify-center rounded-xl ${alert ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}><Icon className="size-5" /></div><ArrowUpRight className="size-4 text-slate-600" /></div><div className="mt-5 text-sm text-slate-400">{label}</div><div className="mt-1 font-display text-3xl font-bold tracking-tight">{value == null ? "—" : value.toLocaleString("pt-AO")}</div><div className="mt-2 text-xs text-slate-500">{note}</div></CardContent></Card>;
}
function Loading() { return <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#0b1912] p-10 text-sm text-slate-400"><LoaderCircle className="size-4 animate-spin" />A carregar dados autorizados…</div>; }
function ErrorText({ error }: { error: Error }) { return <div className="rounded-xl border border-red-300/20 bg-red-300/5 p-4 text-sm text-red-200">{error.message}</div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">{text}</div>; }
function SecurityRow({ title, text }: { title: string; text: string }) { return <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" /><div><div className="text-sm font-medium">{title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{text}</div></div></div>; }
function SectionIntro({ title, description }: { title: string; description: string }) { return <div className="mb-5"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>; }
