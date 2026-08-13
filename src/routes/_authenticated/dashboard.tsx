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
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const id = orgId!;
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
