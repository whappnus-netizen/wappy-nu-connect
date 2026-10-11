import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KanbanSquare, Plus, ArrowRight } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM — Wapnus" }] }),
  component: CrmPage,
});

type Stage = { id: string; name: string; position: number };
type Deal = { id: string; title: string; amount: number | null; currency: string | null; stage_id: string | null; contact_id: string | null; status: string };

function CrmPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["crm", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const [stagesRes, dealsRes, contactsRes] = await Promise.all([
        supabase.from("pipeline_stages").select("id, name, position").eq("organization_id", orgId!).order("position"),
        supabase.from("deals").select("id, title, amount, currency, stage_id, contact_id, status").eq("organization_id", orgId!).order("created_at", { ascending: false }).limit(300),
        supabase.from("contacts").select("id, full_name, phone_e164").eq("organization_id", orgId!).order("created_at", { ascending: false }).limit(300),
      ]);
      if (stagesRes.error) throw new Error(`Etapas do CRM: ${stagesRes.error.message}`);
      if (dealsRes.error) throw new Error(`Oportunidades: ${dealsRes.error.message}`);
      if (contactsRes.error) throw new Error(`Contactos: ${contactsRes.error.message}`);
      return { stages: (stagesRes.data ?? []) as Stage[], deals: (dealsRes.data ?? []) as Deal[], contacts: contactsRes.data ?? [] };
    },
  });

  const createDeal = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Não foi encontrada uma organização activa.");
      const cleanTitle = title.trim();
      if (cleanTitle.length < 2) throw new Error("Indique o nome da oportunidade.");
      const firstStage = query.data?.stages[0];
      if (!firstStage) throw new Error("O funil ainda não tem etapas configuradas.");
      const { error: err } = await supabase.from("deals").insert({
        organization_id: orgId, title: cleanTitle, amount: amount.trim() ? Number(amount) : null,
        currency: "AOA", stage_id: firstStage.id, status: "open",
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => { setTitle(""); setAmount(""); setError(null); void queryClient.invalidateQueries({ queryKey: ["crm", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const moveDeal = useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error: err } = await supabase.from("deals").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", dealId).eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["crm", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const stages = query.data?.stages ?? [];
  const deals = query.data?.deals ?? [];

  return (
    <AppShell title="CRM" description="Acompanhe oportunidades comerciais associadas ao atendimento WhatsApp.">
      <section className="mb-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 font-display font-semibold">Criar oportunidade</h2>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); createDeal.mutate(); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Pedido de catering para evento" maxLength={160} aria-label="Nome da oportunidade" />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor em Kz (opcional)" type="number" min="0" step="1" aria-label="Valor em kwanzas" />
          <Button type="submit" disabled={!orgId || createDeal.isPending}><Plus className="mr-2 size-4" />{createDeal.isPending ? "A guardar…" : "Adicionar"}</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">A criação manual funciona já. A conversão automática de conversas em oportunidades será activada apenas quando definirmos critérios comerciais claros, para não encher o CRM com falsos leads.</p>
        {(error || query.error) && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error ?? query.error?.message}</p>}
      </section>

      {query.isLoading ? <p className="text-sm text-muted-foreground">A carregar CRM…</p> :
        stages.length === 0 ? <EmptyState icon={KanbanSquare} title="Funil por configurar" description="Não existem etapas de pipeline nesta organização. É necessário criar as etapas iniciais antes de adicionar oportunidades." /> :
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage, index) => {
            const stageDeals = deals.filter((deal) => deal.stage_id === stage.id);
            const nextStage = stages[index + 1];
            return <section key={stage.id} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-sm font-semibold">{stage.name}</h2><Badge variant="secondary">{stageDeals.length}</Badge></div>
              <div className="space-y-2">{stageDeals.length === 0 ? <p className="text-xs text-muted-foreground">Sem oportunidades.</p> : stageDeals.map((deal) => <article key={deal.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
                <p className="break-words text-sm font-medium">{deal.title}</p>
                <p className="text-xs text-muted-foreground">{deal.amount !== null ? `${Number(deal.amount).toLocaleString("pt-AO")} ${deal.currency ?? "AOA"}` : "Sem valor definido"}</p>
                {nextStage && <Button size="sm" variant="outline" className="w-full" disabled={moveDeal.isPending} onClick={() => moveDeal.mutate({ dealId: deal.id, stageId: nextStage.id })}><ArrowRight className="mr-2 size-3" />Mover para {nextStage.name}</Button>}
              </article>)}</div>
            </section>;
          })}
        </div>}
    </AppShell>
  );
}
