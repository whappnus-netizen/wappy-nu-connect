import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/definicoes")({
  head: () => ({
    meta: [
      { title: "Definições — Wappy Nus" },
      { name: "description", content: "Dados da organização, plano, fuso horário e preferências da conta." },
      { property: "og:title", content: "Definições — Wappy Nus" },
      { property: "og:description", content: "Configurações da organização e da conta." },
    ],
  }),
  component: SettingsPage,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function SettingsPage() {
  const { user, membership } = useAuth();

  return (
    <AppShell title="Definições" description="Organização e conta">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Organização</h2>
          <div className="mt-2">
            <Row label="Nome" value={membership?.organizations?.name ?? "—"} />
            <Row label="Identificador" value={membership?.organizations?.slug ?? "—"} />
            <Row label="A sua função" value={membership?.role ?? "—"} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Conta</h2>
          <div className="mt-2">
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="Nome" value={(user?.user_metadata?.["full_name"] as string) ?? "—"} />
            <Row label="Fuso horário" value="Africa/Luanda (WAT)" />
            <Row label="Moeda" value="AOA — Kwanza" />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-semibold">Módulos</h2>
            <Badge variant="secondary">Fase 1</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            WhatsApp Cloud API, multiatendimento, CRM, automações e IA. Campanhas, webhooks, integrações e
            analytics avançados chegam na Fase 2 sem alterar a estrutura actual.
          </p>
        </section>
      </div>
    </AppShell>
  );
}