import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({
    meta: [
      { title: "Automações — Wappy Nus" },
      { name: "description", content: "Regras automáticas de resposta, distribuição e follow-up no WhatsApp." },
      { property: "og:title", content: "Automações — Wappy Nus" },
      { property: "og:description", content: "Fluxos automáticos de atendimento." },
    ],
  }),
  component: AutomationsPage,
});

type Rule = {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  description: string | null;
};

function AutomationsPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["automations", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data } = await supabase
        .from("automation_rules")
        .select("id, name, trigger_type, is_active, description")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      return (data ?? []) as Rule[];
    },
  });

  const rules = data ?? [];

  return (
    <AppShell title="Automações" description="Respostas automáticas, distribuição e follow-ups">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Sem automações"
          description="Crie regras como mensagem de boas-vindas, resposta fora de horário ou distribuição automática de conversas assim que o motor de automação estiver ligado ao seu número WhatsApp."
        />
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.id} className="flex items-start justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.description ?? r.trigger_type}</p>
              </div>
              <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Activa" : "Inactiva"}</Badge>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}