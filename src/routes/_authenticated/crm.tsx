import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { KanbanSquare } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({
    meta: [
      { title: "CRM — Wappy Nus" },
      { name: "description", content: "Funil de vendas com fases, oportunidades e valores por negócio." },
      { property: "og:title", content: "CRM — Wappy Nus" },
      { property: "og:description", content: "Pipeline comercial ligado às conversas de WhatsApp." },
    ],
  }),
  component: CrmPage,
});

type Stage = { id: string; name: string; position: number };
type Deal = {
  id: string;
  title: string;
  amount: number | null;
  currency: string | null;
  stage_id: string | null;
};

function CrmPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["crm", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const id = orgId!;
      const [stagesRes, dealsRes] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select("id, name, position")
          .eq("organization_id", id)
          .order("position"),
        supabase
          .from("deals")
          .select("id, title, amount, currency, stage_id")
          .eq("organization_id", id)
          .limit(300),
      ]);
      return {
        stages: (stagesRes.data ?? []) as Stage[],
        deals: (dealsRes.data ?? []) as Deal[],
      };
    },
  });

  const stages = data?.stages ?? [];

  return (
    <AppShell title="CRM" description="Funil comercial da organização">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : stages.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title="Funil por configurar"
          description="Ainda não existem fases de pipeline nesta organização. Assim que a base de dados for criada com as fases iniciais, o funil aparece aqui."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage) => {
            const deals = (data?.deals ?? []).filter((d) => d.stage_id === stage.id);
            return (
              <div key={stage.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold">{stage.name}</h2>
                  <Badge variant="secondary">{deals.length}</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {deals.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem oportunidades.</p>
                  ) : (
                    deals.map((d) => (
                      <div key={d.id} className="rounded-lg border border-border bg-surface p-3">
                        <p className="text-sm font-medium">{d.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.amount ? `${d.amount} ${d.currency ?? "AOA"}` : "Sem valor"}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}