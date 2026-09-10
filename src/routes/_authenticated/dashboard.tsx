import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  MessagesSquare,
  Clock,
  Headphones,
  Users,
  Target,
  UserCheck,
  Workflow,
  Sparkles,
  Smartphone,
} from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { countRows } from "@/lib/metrics";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Wappy Nus" },
      { name: "description", content: "Visão geral do atendimento, contactos e automações da sua organização." },
      { property: "og:title", content: "Dashboard — Wappy Nus" },
      { property: "og:description", content: "Métricas de atendimento em tempo real." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { membership, membershipLoading, membershipError } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("Membership sem organization_id.");
      const id = orgId;
      const [open, pending, active, contacts, deals, automations, numbers] = await Promise.all([
        countRows("conversations", id, { status: "open" }),
        countRows("conversations", id, { status: "pending" }),
        countRows("conversations", id, { status: "in_progress" }),
        countRows("contacts", id),
        countRows("deals", id),
        countRows("automation_rules", id, { is_active: "true" }),
        countRows("whatsapp_numbers", id),
      ]);
      return { open, pending, active, contacts, deals, automations, numbers };
    },
  });

  // Fase 5: estado real da ligação WhatsApp (Cloud API oficial ou QR Code).
  const { data: waNumbers } = useQuery({
    queryKey: ["dashboard-wa-numbers", orgId],
    enabled: Boolean(orgId),
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .select("id, display_name, phone_e164, provider, status")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as {
        id: string;
        display_name: string | null;
        phone_e164: string;
        provider: string | null;
        status: string;
      }[];
    },
  });

  const cards = [
    { icon: MessagesSquare, label: "Conversas abertas", value: data?.open },
    { icon: Clock, label: "Conversas pendentes", value: data?.pending },
    { icon: Headphones, label: "Em atendimento", value: data?.active },
    { icon: Users, label: "Contactos", value: data?.contacts },
    { icon: Target, label: "Leads / oportunidades", value: data?.deals },
    { icon: UserCheck, label: "Agentes online", value: null },
    { icon: Workflow, label: "Automações activas", value: data?.automations },
    { icon: Sparkles, label: "Utilização da IA", value: null },
  ];

  if (membershipLoading) {
    return <AppShell title="Dashboard" description="A carregar organização…"><p className="text-sm text-muted-foreground">A confirmar o acesso à organização…</p></AppShell>;
  }

  if (!membership) {
    return (
      <AppShell title="Dashboard" description="Sem organização associada">
        <div className="max-w-xl border-l-4 border-primary bg-card p-6">
          <h2 className="font-display text-base font-semibold">Organização ainda não configurada</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {membershipError
              ? "Não foi possível consultar a associação à organização. Tente novamente."
              : "Conclua o onboarding para criar a organização e o acesso OWNER."}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/onboarding">Ir para o onboarding</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Dashboard" description={membership?.organizations?.name ?? "Organização"}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <c.icon className="size-4 text-primary" />
            </div>
            <p className="mt-3 font-display text-3xl font-semibold">
              {isLoading ? "…" : c.value === null || c.value === undefined ? "—" : c.value}
            </p>
          </div>
        ))}
      </div>

      {waNumbers && waNumbers.length > 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-soft">
          <h2 className="font-display text-base font-semibold">Ligações WhatsApp</h2>
          <ul className="mt-3 space-y-2">
            {waNumbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{n.display_name ?? n.phone_e164}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.phone_e164} · {n.provider === "qr" ? "QR Code (não oficial)" : "Meta Cloud API"}
                  </p>
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    n.status === "connected"
                      ? "bg-primary/10 text-primary"
                      : n.status === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {n.status === "connected"
                    ? "Conectado"
                    : n.status === "qr_pending"
                      ? "À espera do QR"
                      : n.status === "connecting" || n.status === "reconnecting"
                        ? "A ligar…"
                        : n.status === "error"
                          ? "Erro"
                          : "Desconectado"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!data?.numbers ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Smartphone className="size-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-display text-base font-semibold">Ligue o seu número WhatsApp</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhum número está configurado. As métricas ficam vazias até registar um número da WhatsApp Cloud
                API oficial da Meta.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link to="/whatsapp">Configurar WhatsApp</Link>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        Valores em branco (—) significam que a métrica ainda não tem fonte de dados configurada. Nenhum número é
        simulado.
      </p>
    </AppShell>
  );
}
