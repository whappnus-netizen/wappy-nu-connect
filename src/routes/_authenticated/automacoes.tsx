import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Workflow, Plus, Power, Trash2, MessageSquareText, Clock3, Handshake, UsersRound } from "lucide-react";
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

type TriggerType = "keyword_match" | "conversation_created" | "outside_business_hours" | "auto_assignment";
type Rule = {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  description: string | null;
  config: { keyword?: string; reply?: string; startTime?: string; endTime?: string; days?: number[]; actionType?: string } | null;
};

const triggerLabels: Record<TriggerType, string> = {
  keyword_match: "Palavra-chave",
  conversation_created: "Boas-vindas (primeira mensagem)",
  outside_business_hours: "Fora do horário de atendimento",
  auto_assignment: "Distribuição automática",
};

function triggerDescription(rule: Rule) {
  if (rule.config?.actionType === "assign_agent") return "Atribui a conversa ao membro elegível com menos conversas activas; a IA continua activa até alguém assumir o atendimento.";
  if (rule.trigger_type === "keyword_match") return `Quando a mensagem contém “${rule.config?.keyword ?? "palavra-chave"}”`;
  if (rule.trigger_type === "outside_business_hours") return `Quando a mensagem chega fora de ${rule.config?.startTime ?? "09:00"}–${rule.config?.endTime ?? "18:00"}`;
  if (rule.trigger_type === "conversation_created") return "Na primeira mensagem de uma nova conversa";
  return "Este tipo de regra ainda não é suportado pelo motor atual.";
}

function AutomationsPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const canManage = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("keyword_match");
  const [keyword, setKeyword] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
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
      if (triggerType !== "auto_assignment" && !cleanReply) throw new Error("Escreva a resposta automática.");
      if (triggerType === "keyword_match" && cleanKeyword.length < 2) throw new Error("A palavra-chave deve ter pelo menos 2 caracteres.");
      if (triggerType === "outside_business_hours" && startTime === endTime) throw new Error("A hora inicial e final não podem ser iguais.");

      const config = triggerType === "auto_assignment"
        ? { actionType: "assign_agent" }
        : triggerType === "keyword_match"
          ? { keyword: cleanKeyword, reply: cleanReply }
          : triggerType === "outside_business_hours"
            ? { reply: cleanReply, startTime, endTime, days: [1, 2, 3, 4, 5] }
            : { reply: cleanReply };
      const storedTriggerType = triggerType === "auto_assignment" ? "conversation_created" : triggerType;

      const description = triggerType === "auto_assignment"
        ? "Distribui novas conversas pelo agente elegível com menor carga"
        : triggerType === "keyword_match"
          ? `Responde quando a mensagem contém: ${cleanKeyword}`
          : triggerType === "outside_business_hours"
            ? `Responde fora do horário ${startTime}–${endTime}, de segunda a sexta`
            : "Envia uma saudação na primeira mensagem de uma conversa";

      const { error: err } = await supabase.from("automation_rules").insert({
        organization_id: orgId,
        name: cleanName,
        description,
        trigger_type: storedTriggerType,
        conditions: [],
        config,
        is_active: true,
      });
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      setName(""); setKeyword(""); setReply(""); setError(null);
      setNotice("Automação criada. Teste primeiro com uma conversa controlada.");
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
    <AppShell title="Automações" description="Respostas automáticas para mensagens recebidas no WhatsApp ligado por QR ou pela API oficial.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2"><MessageSquareText className="size-5 text-primary" /><h2 className="font-display font-semibold">Criar automação</h2></div>
          {!canManage && <p className="rounded-md bg-secondary p-2 text-xs text-muted-foreground">Só OWNER ou ADMIN pode criar e gerir automações.</p>}
          <p className="text-sm text-muted-foreground">Palavras-chave e respostas fora de horário substituem a resposta da IA para evitar duplicações. A saudação de boas-vindas pode ser seguida pela resposta da IA. A distribuição automática atribui um responsável, mantendo a IA activa até alguém assumir o atendimento.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createRule.mutate(); }}>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-name">Nome da regra</label><Input id="automation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Horário de funcionamento" maxLength={80} /></div>
            <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-trigger">Quando deve executar?</label><select id="automation-trigger" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="keyword_match">Palavra-chave</option><option value="conversation_created">Boas-vindas (primeira mensagem)</option><option value="outside_business_hours">Fora do horário de atendimento</option><option value="auto_assignment">Distribuição automática de conversa</option></select></div>
            {triggerType === "keyword_match" && <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-keyword">Palavra-chave ou expressão</label><Input id="automation-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Ex.: menu, horário, localização" maxLength={100} /></div>}
            {triggerType === "outside_business_hours" && <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-start">Abre às</label><Input id="automation-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></div><div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-end">Fecha às</label><Input id="automation-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></div><p className="col-span-2 text-xs text-muted-foreground">Usa o fuso horário da organização e considera segunda a sexta-feira como dias de atendimento.</p></div>}
            {triggerType === "auto_assignment" ? <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">A nova conversa será atribuída ao membro elegível com menos conversas abertas/em atendimento. Se não houver agentes, o sistema usa supervisor, administrador ou proprietário como alternativa. A IA continua a responder até um humano assumir.</p> : <div className="space-y-1"><label className="text-sm font-medium" htmlFor="automation-reply">Resposta automática</label><Textarea id="automation-reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escreva a resposta que será enviada..." rows={4} maxLength={2000} /></div>}
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{notice}</p>}
            <Button type="submit" disabled={!orgId || !canManage || createRule.isPending} className="w-full sm:w-auto"><Plus className="mr-2 size-4" />{createRule.isPending ? "A guardar…" : "Criar automação"}</Button>
          </form>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-display font-semibold">Regras da organização</h2><Badge variant="secondary">{rules.length}</Badge></div>
          {rulesQuery.isLoading ? <p className="text-sm text-muted-foreground">A carregar…</p> :
            rulesQuery.error ? <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{rulesQuery.error.message}</p> :
            rules.length === 0 ? <EmptyState icon={Workflow} title="Ainda sem automações" description="Crie uma regra acima e teste-a com uma conversa controlada." /> :
            <div className="space-y-3">{rules.map((rule) => (
              <article key={rule.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{rule.name}</h3><Badge variant={rule.is_active ? "default" : "secondary"}>{rule.is_active ? "Activa" : "Pausada"}</Badge></div><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant="outline">{rule.config?.actionType === "assign_agent" ? triggerLabels.auto_assignment : triggerLabels[rule.trigger_type as TriggerType] ?? "Tipo não suportado"}</Badge><p className="text-xs text-muted-foreground">{triggerDescription(rule)}</p></div></div>
                  <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={!canManage || toggleRule.isPending} onClick={() => toggleRule.mutate(rule)}><Power className="mr-1 size-4" />{rule.is_active ? "Pausar" : "Activar"}</Button><Button size="sm" variant="destructive" disabled={!canManage || deleteRule.isPending} onClick={() => { if (window.confirm("Eliminar esta automação?")) deleteRule.mutate(rule.id); }} aria-label={`Eliminar ${rule.name}`}><Trash2 className="size-4" /></Button></div>
                </div>
                {rule.trigger_type === "outside_business_hours" && <p className="text-xs text-muted-foreground"><Clock3 className="mr-1 inline size-3" />Segunda a sexta · {rule.config?.startTime ?? "09:00"}–{rule.config?.endTime ?? "18:00"}</p>}
                {rule.trigger_type === "conversation_created" && rule.config?.actionType !== "assign_agent" && <p className="text-xs text-muted-foreground"><Handshake className="mr-1 inline size-3" />Executa apenas na primeira mensagem da conversa.</p>}
                {rule.config?.actionType === "assign_agent" && <p className="text-xs text-muted-foreground"><UsersRound className="mr-1 inline size-3" />Atribuição por menor carga, sem eliminar a resposta da IA.</p>}
                <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/60 p-3 text-sm">{rule.config?.reply ?? (rule.config?.actionType === "assign_agent" ? "Acção: distribuir a conversa por um membro disponível." : "Esta regra não tem resposta configurada.")}</p>
              </article>
            ))}</div>}
          {error && !createRule.isError && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </section>
      </div>
    </AppShell>
  );
}
