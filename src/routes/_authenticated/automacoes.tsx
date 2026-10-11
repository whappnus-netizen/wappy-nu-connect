import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Workflow, Plus, Power, Trash2, MessageSquareText } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — Wapnus" }] }),
  component: AutomationsPage,
});

type Rule = {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  description: string | null;
  config: { keyword?: string; reply?: string } | null;
};

function AutomationsPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["automations", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("automation_rules")
        .select("id, name, trigger_type, is_active, description, config")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (err) throw new Error(err.message);
      return (data ?? []) as Rule[];
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Não foi encontrada uma organização activa.");
      const cleanName = name.trim();
      const cleanKeyword = keyword.trim();
      const cleanReply = reply.trim();
      if (cleanName.length < 2) throw new Error("Dê um nome à automação.");
      if (cleanKeyword.length < 2) throw new Error("A palavra-chave deve ter pelo menos 2 caracteres.");
      if (!cleanReply) throw new Error("Escreva a resposta automática.");
      const { error: err } = await supabase.from("automation_rules").insert({
        organization_id: orgId,
        name: cleanName,
        description: `Responde quando a mensagem contém: ${cleanKeyword}`,
        trigger_type: "keyword_match",
        conditions: [],
        config: { keyword: cleanKeyword, reply: cleanReply },
        is_active: true,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      setName(""); setKeyword(""); setReply(""); setError(null);
      setNotice("Automação criada. Faça um teste com uma palavra-chave não ambígua.");
      void queryClient.invalidateQueries({ queryKey: ["automations", orgId] });
    },
    onError: (e: Error) => { setError(e.message); setNotice(null); },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: Rule) => {
      const { error: err } = await supabase.from("automation_rules")
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq("id", rule.id).eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteRule = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error: actionError } = await supabase.from("automation_actions")
        .delete().eq("rule_id", ruleId).eq("organization_id", orgId!);
      if (actionError) throw new Error(actionError.message);
      const { error: ruleError } = await supabase.from("automation_rules")
        .delete().eq("id", ruleId).eq("organization_id", orgId!);
      if (ruleError) throw new Error(ruleError.message);
    },
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["automations", orgId] }); },
    onError: (e: Error) => setError(e.message),
  });

  const rules = rulesQuery.data ?? [];

  return (
    <AppShell title="Automações" description="Regras de resposta para mensagens recebidas no WhatsApp ligado por QR ou pela API oficial.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <MessageSquareText className="size-5 text-primary" />
            <h2 className="font-display font-semibold">Criar resposta por palavra-chave</h2>
          </div>
          <p className="text-sm text-muted-foreground">Quando uma mensagem recebida contiver a palavra-chave, a Wapnus envia esta resposta e não chama a IA para essa mesma mensagem, evitando respostas duplicadas.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createRule.mutate(); }}>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-name">Nome da regra</label><Input id="automation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Horário de funcionamento" maxLength={80} /></div>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-keyword">Palavra-chave ou expressão</label><Input id="automation-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ex.: horário" maxLength={100} /></div>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-reply">Resposta automática</label><Textarea id="automation-reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escreva a resposta que será enviada..." rows={4} maxLength={2000} /></div>
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{notice}</p>}
            <Button type="submit" disabled={!orgId || createRule.isPending} className="w-full sm:w-auto"><Plus className="mr-2 size-4" />{createRule.isPending ? "A guardar…" : "Criar automação"}</Button>
          </form>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-display font-semibold">Regras da organização</h2><Badge variant="secondary">{rules.length}</Badge></div>
          {rulesQuery.isLoading ? <p className="text-sm text-muted-foreground">A carregar…</p> :
            rulesQuery.error ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{rulesQuery.error.message}</p> :
            rules.length === 0 ? <EmptyState icon={Workflow} title="Ainda sem automações" description="Crie uma regra acima. Comece por palavras-chave fáceis de testar, como horário, localização ou menu." /> :
            <div className="space-y-3">{rules.map((rule) => (
              <article key={rule.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{rule.name}</h3><Badge variant={rule.is_active ? "default" : "secondary"}>{rule.is_active ? "Activa" : "Pausada"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Se a mensagem contiver “{rule.config?.keyword ?? "palavra-chave"}”</p></div>
                  <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={toggleRule.isPending} onClick={() => toggleRule.mutate(rule)}><Power className="mr-1 size-4" />{rule.is_active ? "Pausar" : "Activar"}</Button><Button size="sm" variant="destructive" disabled={deleteRule.isPending} onClick={() => { if (window.confirm("Eliminar esta automação?")) deleteRule.mutate(rule.id); }} aria-label={`Eliminar ${rule.name}`}><Trash2 className="size-4" /></Button></div>
                </div>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-3 text-sm">{rule.config?.reply ?? "Esta regra não tem resposta configurada."}</p>
              </article>
            ))}</div>}
          {error && !createRule.isError && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </section>
      </div>
    </AppShell>
  );
}
