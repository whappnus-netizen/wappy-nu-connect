import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KanbanSquare, Plus, RefreshCw } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { previewExistingConversationDeals, syncExistingConversationDeals } from "@/lib/crm-backfill.server";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM — Wapnus" }] }),
  component: CrmPage,
});

type Stage = { id: string; name: string; position: number };
type Deal = { id: string; title: string; amount: number | null; currency: string | null; stage_id: string | null; contact_id: string | null; status: string };
type Contact = { id: string; full_name: string | null; phone_e164: string };

function CrmPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [contactId, setContactId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [backfillPreview, setBackfillPreview] = useState<{ contactsWithConversations: number; alreadyRepresented: number; opportunitiesToCreate: number; initialStage: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManageCRM = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const previewBackfillFn = useServerFn(previewExistingConversationDeals);
  const syncBackfillFn = useServerFn(syncExistingConversationDeals);

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
      return { stages: (stagesRes.data ?? []) as Stage[], deals: (dealsRes.data ?? []) as Deal[], contacts: (contactsRes.data ?? []) as Contact[] };
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
        currency: membership?.organizations?.currency ?? "AOA", stage_id: firstStage.id, status: "open", contact_id: contactId || null,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => { setTitle(""); setAmount(""); setContactId(""); setError(null); void queryClient.invalidateQueries({ queryKey: ["crm", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const previewBackfill = useMutation({
    mutationFn: async () => {
      if (!orgId || !canManageCRM) throw new Error("Apenas OWNER ou ADMIN pode sincronizar o CRM.");
      return previewBackfillFn({ data: { organizationId: orgId } });
    },
    onSuccess: (result) => { setBackfillPreview(result); setError(null); setNotice(null); },
    onError: (e: Error) => { setError(e.message); setBackfillPreview(null); },
  });

  const syncBackfill = useMutation({
    mutationFn: async () => {
      if (!orgId || !canManageCRM) throw new Error("Apenas OWNER ou ADMIN pode sincronizar o CRM.");
      return syncBackfillFn({ data: { organizationId: orgId } });
    },
    onSuccess: (result) => {
      setNotice(`Sincronização concluída: ${result.createdCount} oportunidades criadas, ${result.skippedCount} contactos já representados e ${result.failedCount} falhas.`);
      setBackfillPreview(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["crm", orgId] });
    },
    onError: (e: Error) => { setError(e.message); setNotice(null); },
  });

  const moveDeal = useMutation({
    mutationFn: async ({ dealId, stageId, stageName }: { dealId: string; stageId: string; stageName: string }) => {
      const normalized = stageName.toLocaleLowerCase();
      const nextStatus = normalized.includes("ganho") || normalized.includes("won") ? "won" : normalized.includes("perdido") || normalized.includes("lost") ? "lost" : "open";
      const { error: err } = await supabase.from("deals").update({ stage_id: stageId, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", dealId).eq("organization_id", orgId!);
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
        <form className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]" onSubmit={(e) => { e.preventDefault(); createDeal.mutate(); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Pedido de catering para evento" maxLength={160} aria-label="Nome da oportunidade" />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor em Kz (opcional)" type="number" min="0" step="1" aria-label="Valor em kwanzas" />
          <div className="space-y-1"><label className="text-sm font-medium" htmlFor="deal-contact">Contacto (opcional)</label><select id="deal-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Associar contacto à oportunidade"><option value="">Sem contacto associado</option>{(query.data?.contacts ?? []).map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || contact.phone_e164}</option>)}</select></div>
          <Button type="submit" disabled={!orgId || createDeal.isPending}><Plus className="mr-2 size-4" />{createDeal.isPending ? "A guardar…" : "Adicionar"}</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">A criação manual funciona já. Para novas conversas, activa na aba Automações a regra “Criar oportunidade no CRM”. A sincronização abaixo permite importar conversas antigas sem duplicar contactos que já têm oportunidades.</p>
        {(error || query.error) && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error ?? query.error?.message}</p>}
      </section>

      {canManageCRM && <section className="mb-5 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><h2 className="font-display font-semibold">Sincronizar conversas existentes</h2><p className="mt-1 text-sm text-muted-foreground">Pré-visualiza quantos contactos têm conversas WhatsApp mas ainda não têm nenhuma oportunidade no CRM. Nada é criado até confirmares.</p></div>
          <Button variant="outline" disabled={previewBackfill.isPending || syncBackfill.isPending || !orgId} onClick={() => previewBackfill.mutate()}><RefreshCw className="mr-2 size-4" />{previewBackfill.isPending ? "A verificar…" : "Verificar conversas"}</Button>
        </div>
        {backfillPreview && <div className="space-y-3 rounded-lg bg-secondary/50 p-3">
          <p className="text-sm">{backfillPreview.contactsWithConversations} contactos com conversas · {backfillPreview.alreadyRepresented} já representados no CRM · etapa inicial: <strong>{backfillPreview.initialStage}</strong>.</p>
          {backfillPreview.opportunitiesToCreate > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-medium">Serão criadas {backfillPreview.opportunitiesToCreate} oportunidades em falta.</p><Button disabled={syncBackfill.isPending} onClick={() => { if (window.confirm(`Criar ${backfillPreview.opportunitiesToCreate} oportunidades para contactos com conversas existentes? A acção não altera mensagens nem contactos.`)) syncBackfill.mutate(); }}>{syncBackfill.isPending ? "A sincronizar…" : `Criar ${backfillPreview.opportunitiesToCreate} oportunidades`}</Button></div> : <p className="text-sm text-muted-foreground">Não há oportunidades em falta para importar.</p>}
        </div>}
        {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </section>}

      {query.isLoading ? <p className="text-sm text-muted-foreground">A carregar CRM…</p> :
        stages.length === 0 ? <EmptyState icon={KanbanSquare} title="Funil por configurar" description="Não existem etapas de pipeline nesta organização. É necessário criar as etapas iniciais antes de adicionar oportunidades." /> :
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage) => {
            const stageDeals = deals.filter((deal) => deal.stage_id === stage.id);
            return <section key={stage.id} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-display text-sm font-semibold">{stage.name}</h2><Badge variant="secondary">{stageDeals.length}</Badge></div>
              <div className="space-y-2">{stageDeals.length === 0 ? <p className="text-xs text-muted-foreground">Sem oportunidades.</p> : stageDeals.map((deal) => <article key={deal.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
                <p className="break-words text-sm font-medium">{deal.title}</p>
                <p className="text-xs text-muted-foreground">{deal.amount !== null ? `${Number(deal.amount).toLocaleString("pt-AO")} ${deal.currency ?? "AOA"}` : "Sem valor definido"}</p>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor={`deal-stage-${deal.id}`}>Mover para etapa</label>
                  <select id={`deal-stage-${deal.id}`} value={deal.stage_id ?? ""} disabled={moveDeal.isPending} onChange={(e) => { const destination = stages.find((candidate) => candidate.id === e.target.value); if (destination) moveDeal.mutate({ dealId: deal.id, stageId: destination.id, stageName: destination.name }); }} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs">
                    {stages.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                  </select>
                  <Badge variant={deal.status === "won" ? "default" : deal.status === "lost" ? "destructive" : "secondary"}>{deal.status === "won" ? "Ganho" : deal.status === "lost" ? "Perdido" : "Aberto"}</Badge>
                </div>
              </article>)}</div>
            </section>;
          })}
        </div>}
    </AppShell>
  );
}
