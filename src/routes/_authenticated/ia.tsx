import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquare, Plus, Sparkles, Trash2, Mic, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useSubscriptionAccess } from "@/lib/subscription";
import { supabase } from "@/lib/supabase/client";
import { testOrgAiAgent, organizeAgentInstructions } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/ia")({
  head: () => ({
    meta: [
      { title: "IA — Wappy Nus" },
      {
        name: "description",
        content:
          "Configure e treine o agente de IA da sua empresa: instruções, conhecimento, exemplos e testes antes do atendimento real.",
      },
      { property: "og:title", content: "IA — Wappy Nus" },
      {
        property: "og:description",
        content: "Assistente de atendimento treinado com os dados da sua empresa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiPage,
});

type Agent = {
  id: string;
  organization_id: string;
  name: string;
  model: string | null;
  is_active: boolean;
  goal: string | null;
  personality: string | null;
  company_name: string | null;
  company_description: string | null;
  products_services: string | null;
  business_hours: string | null;
  location: string | null;
  payment_methods: string | null;
  faq: string | null;
  tone: string | null;
  service_rules: string | null;
  can_do: string | null;
  cannot_do: string | null;
  handoff_instructions: string | null;
  greeting_message: string | null;
  extra_instructions: string | null;
  config: Record<string, unknown> | null;
};

type Knowledge = {
  id: string;
  title: string;
  content: string;
  category: string;
  is_active: boolean;
};

type Example = {
  id: string;
  input: string;
  expected_output: string;
  example_type: string;
  is_active: boolean;
};

const AGENT_FIELDS = [
  "id, organization_id, name, model, is_active, goal, personality, company_name, company_description",
  "products_services, business_hours, location, payment_methods, faq, tone",
  "service_rules, can_do, cannot_do, handoff_instructions, greeting_message, extra_instructions",
  "config",
].join(", ");

const CATEGORIES = [
  "geral",
  "produtos",
  "servicos",
  "precos",
  "faq",
  "politicas",
  "horarios",
  "empresa",
  "entrega",
  "pagamentos",
] as const;

const EXAMPLE_TYPES = [
  { value: "exemplo", label: "Exemplo de resposta" },
  { value: "regra", label: "Regra de comportamento" },
  { value: "proibicao", label: "Proibição" },
  { value: "encaminhamento", label: "Encaminhar para humano" },
] as const;

function AiPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const subscription = useSubscriptionAccess(orgId);
  const canManage = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const canCreateAgent = canManage && subscription.active && subscription.features["ai"] !== false;
  const qc = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const agentQuery = useQuery({
    queryKey: ["ai-agents", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select(AGENT_FIELDS)
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Agent[];
    },
  });

  const agents = agentQuery.data ?? [];
  const agentLimit = Number(subscription.limits.agents ?? 0);
  const agentLimitReached = agentLimit > 0 && agents.length >= agentLimit;
  const agent = agents.find((item) => item.id === selectedAgentId) ?? agents[0] ?? null;

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId !== null) setSelectedAgentId(null);
      return;
    }
    if (!selectedAgentId || !agents.some((item) => item.id === selectedAgentId)) {
      setSelectedAgentId(agents.find((item) => item.is_active)?.id ?? agents[0]?.id ?? null);
    }
  }, [agentQuery.data, selectedAgentId]);

  const knowledgeQuery = useQuery({
    queryKey: ["ai-knowledge", orgId, agent?.id],
    enabled: Boolean(orgId && agent?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_knowledge")
        .select("id, title, content, category, is_active")
        .eq("organization_id", orgId!)
        .eq("agent_id", agent!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Knowledge[];
    },
  });

  const examplesQuery = useQuery({
    queryKey: ["ai-examples", orgId, agent?.id],
    enabled: Boolean(orgId && agent?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_training_examples")
        .select("id, input, expected_output, example_type, is_active")
        .eq("organization_id", orgId!)
        .eq("agent_id", agent!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Example[];
    },
  });

  const createAgent = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Não foi encontrada uma organização activa.");
      if (!canCreateAgent) throw new Error("Para criar agentes, precisas de ser OWNER/ADMIN e ter uma assinatura activa com IA incluída.");
      const { count, error: countError } = await supabase.from("ai_agents").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
      if (countError) throw new Error("Não foi possível verificar o limite de agentes: " + countError.message);
      const maxAgents = Number(subscription.limits.agents ?? 0);
      if (maxAgents > 0 && (count ?? 0) >= maxAgents) throw new Error(`O plano ${subscription.planName} permite ${maxAgents} agentes de IA. Já atingiste esse limite; elimina ou actualiza o plano para criar outro.`);
      const { data, error } = await supabase
        .from("ai_agents")
        .insert({
          organization_id: orgId,
          name: "Novo agente",
          purpose: "autoreply",
          is_active: false,
        })
        .select(AGENT_FIELDS)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Agent;
    },
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
      setSelectedAgentId(created.id);
      toast.success("Agente criado. Configure-o antes de o activar.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAgent = useMutation({
    mutationFn: async (agentId: string) => {
      if (!orgId || !canManage) throw new Error("Apenas OWNER ou ADMIN pode eliminar agentes.");
      const { error } = await supabase.from("ai_agents")
        .delete().eq("organization_id", orgId).eq("id", agentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_result, deletedId) => {
      if (selectedAgentId === deletedId) setSelectedAgentId(null);
      toast.success("Agente eliminado.");
      void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
      void qc.invalidateQueries({ queryKey: ["ai-knowledge", orgId] });
      void qc.invalidateQueries({ queryKey: ["ai-examples", orgId] });
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-assignments", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!orgId) {
    return (
      <AppShell title="Inteligência Artificial" description="Agentes de atendimento da sua empresa">
        <p className="text-sm text-muted-foreground">A carregar a organização…</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Inteligência Artificial"
      description="Crie vários agentes, treine cada um e escolha o WhatsApp que cada agente atende"
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">Os meus agentes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada agente tem a sua configuração, conhecimento, exemplos e números WhatsApp associados.
                {agentLimit > 0 && <span className="mt-1 block text-xs">Plano {subscription.planName}: {agents.length} de {agentLimit} agentes utilizados.</span>}
              </p>
            </div>
            {canManage && (
              <Button onClick={() => createAgent.mutate()} disabled={createAgent.isPending || !canCreateAgent || agentLimitReached} className="w-full sm:w-auto">
                {createAgent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Criar agente
              </Button>
            )}
          </div>

          {agentQuery.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">A carregar agentes…</p>
          ) : agentQuery.isError ? (
            <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Não foi possível carregar os agentes: {(agentQuery.error as Error).message}
            </p>
          ) : agents.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-border p-6 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-medium">Ainda não tem agentes de IA</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Crie o primeiro agente e configure o nome, a empresa, os produtos, as regras e o conhecimento antes de o activar.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map((item) => (
                <div
                  key={item.id}
                  className={`flex min-w-0 items-stretch gap-2 rounded-lg border p-3 ${agent?.id === item.id ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <button
                    type="button"
                    aria-pressed={agent?.id === item.id}
                    onClick={() => setSelectedAgentId(item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.company_name || "Empresa por configurar"}
                    </span>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs ${item.is_active ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                      {item.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </button>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Eliminar agente ${item.name}`}
                      title="Eliminar agente"
                      disabled={deleteAgent.isPending}
                      onClick={() => {
                        if (window.confirm(`Eliminar o agente “${item.name}”? Os conhecimentos e exemplos deste agente também serão eliminados. As conversas e mensagens serão preservadas.`)) {
                          deleteAgent.mutate(item.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!canManage && <p className="mt-3 text-xs text-muted-foreground">Apenas OWNER ou ADMIN da organização pode gerir agentes.</p>}{canManage && !subscription.active && <p className="mt-3 rounded-md bg-secondary p-2 text-xs text-muted-foreground">A assinatura do plano {subscription.planName} não está confirmada. Podes desactivar agentes existentes, mas a criação de novos fica bloqueada até regularizar o plano.</p>}{subscription.isError && <p role="alert" className="mt-2 text-xs text-destructive">Erro ao validar assinatura: {(subscription.error as Error)?.message ?? "consulta indisponível"}.</p>}
        </section>

        {agent && (
          <Tabs key={agent.id} defaultValue="overview" className="space-y-6">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="overview">Visão geral</TabsTrigger>
              <TabsTrigger value="config">Configuração</TabsTrigger>
              <TabsTrigger value="knowledge">Conhecimento</TabsTrigger>
              <TabsTrigger value="examples">Exemplos de treinamento</TabsTrigger>
              <TabsTrigger value="test">Testar IA</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <Overview
                agent={agent}
                knowledgeCount={knowledgeQuery.data?.length ?? 0}
                exampleCount={examplesQuery.data?.length ?? 0}
                orgId={orgId}
                canManage={canManage}
              />
              <AgentWhatsAppAssignments
                orgId={orgId}
                agentId={agent.id}
                agentName={agent.name}
                agents={agents}
                canManage={canManage}
              />
            </TabsContent>

            <TabsContent value="config">
              <ConfigForm agent={agent} orgId={orgId} canManage={canManage} />
            </TabsContent>

            <TabsContent value="knowledge">
              <KnowledgePanel
                orgId={orgId}
                agentId={agent.id}
                items={knowledgeQuery.data ?? []}
                loading={knowledgeQuery.isLoading}
                canManage={canManage}
              />
            </TabsContent>

            <TabsContent value="examples">
              <ExamplesPanel
                orgId={orgId}
                agentId={agent.id}
                items={examplesQuery.data ?? []}
                loading={examplesQuery.isLoading}
              />
            </TabsContent>

            <TabsContent value="test">
              <TestPanel orgId={orgId} agentId={agent.id} agentName={agent.name} canTest={subscription.active} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}

function AgentWhatsAppAssignments({
  orgId,
  agentId,
  agentName,
  agents,
  canManage,
}: {
  orgId: string;
  agentId: string;
  agentName: string;
  agents: Agent[];
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const numbersQuery = useQuery({
    queryKey: ["agent-whatsapp-numbers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_numbers")
        .select("id, display_name, phone_e164, provider, status, ai_enabled")
        .eq("organization_id", orgId).is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; display_name: string | null; phone_e164: string | null; provider: string | null; status: string; ai_enabled: boolean }>;
    },
  });
  const assignmentsQuery = useQuery({
    queryKey: ["agent-whatsapp-assignments", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_agent_whatsapp_numbers")
        .select("whatsapp_number_id, agent_id")
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ whatsapp_number_id: string; agent_id: string }>;
    },
  });
  const assign = useMutation({
    mutationFn: async (input: { numberId: string; checked: boolean }) => {
      if (!canManage) throw new Error("Apenas OWNER ou ADMIN pode associar agentes.");
      if (input.checked) {
        const { error } = await supabase.from("ai_agent_whatsapp_numbers").upsert({
          organization_id: orgId,
          agent_id: agentId,
          whatsapp_number_id: input.numberId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "whatsapp_number_id" });
        if (error) throw new Error(error.message);
        const { error: enableError } = await supabase.from("whatsapp_numbers")
          .update({ ai_enabled: true }).eq("organization_id", orgId).eq("id", input.numberId);
        if (enableError) throw new Error(enableError.message);
      } else {
        const { error: disableError } = await supabase.from("whatsapp_numbers")
          .update({ ai_enabled: false }).eq("organization_id", orgId).eq("id", input.numberId);
        if (disableError) throw new Error(disableError.message);
        const { error } = await supabase.from("ai_agent_whatsapp_numbers").delete()
          .eq("organization_id", orgId)
          .eq("agent_id", agentId)
          .eq("whatsapp_number_id", input.numberId);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Associação e respostas automáticas actualizadas.");
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-assignments", orgId] });
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-numbers", orgId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-assignments", orgId] });
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-numbers", orgId] });
    },
  });

  const numbers = numbersQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const currentAgentNumberCount = assignments.filter((item) => item.agent_id === agentId).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-display text-base font-semibold">WhatsApps associados a {agentName}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada número pode ter um único agente associado. Activar aqui associa o agente e liga as respostas automáticas desse WhatsApp; desligar pausa a IA nesse número e remove a associação específica.
        </p>
      </div>
      {numbersQuery.isLoading || assignmentsQuery.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">A carregar números WhatsApp…</p>
      ) : numbers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Ainda não há números WhatsApp activos nesta organização. Liga um número na aba WhatsApp para o associar aqui.</p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {numbers.map((number) => {
            const current = assignments.find((item) => item.whatsapp_number_id === number.id);
            const isAssigned = current?.agent_id === agentId && number.ai_enabled;
            const assignedAgent = current ? agents.find((item) => item.id === current.agent_id) : null;
            return (
              <div key={number.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{number.display_name || number.phone_e164 || "WhatsApp sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{number.phone_e164 || "Número ainda não identificado"} · {number.provider === "qr" ? "QR Code" : "Meta Cloud API"} · {number.status} · IA {number.ai_enabled ? "activa" : "pausada"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAssigned ? "Este agente atende este número e as respostas automáticas estão activas." : current ? `Associado a: ${assignedAgent?.name ?? "outro agente"}; respostas automáticas ${number.ai_enabled ? "activas" : "pausadas"}.` : number.ai_enabled ? "Sem agente específico; será usado o agente activo padrão." : "Respostas automáticas pausadas neste WhatsApp."}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{isAssigned ? "Associado" : "Associar"}</span>
                  <Switch
                    checked={isAssigned}
                    disabled={!canManage || assign.isPending}
                    onCheckedChange={(checked) => {
                      if (checked && current && current.agent_id !== agentId) {
                        const previousName = agents.find((item) => item.id === current.agent_id)?.name ?? "outro agente";
                        if (!window.confirm(`Este número está associado a “${previousName}”. Transferir para “${agentName}”?`)) return;
                      }
                      assign.mutate({ numberId: number.id, checked });
                    }}
                    aria-label={`Activar respostas automáticas de ${number.display_name || number.phone_e164 || "WhatsApp"} para ${agentName}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {currentAgentNumberCount === 0 && numbers.length > 0 && (
        <p className="mt-3 rounded-md bg-secondary p-3 text-xs text-muted-foreground">
          Nenhum número está associado especificamente a este agente. Enquanto não associares um, o motor mantém a seleção padrão do agente activo mais antigo.
        </p>
      )}
      {!canManage && <p className="mt-3 text-xs text-muted-foreground">Apenas OWNER ou ADMIN pode alterar associações.</p>}
    </section>
  );
}

function Overview({
  agent,
  knowledgeCount,
  exampleCount,
  orgId,
  canManage,
}: {
  agent: Agent;
  knowledgeCount: number;
  exampleCount: number;
  orgId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from("ai_agents")
        .update({ is_active: next })
        .eq("id", agent.id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const checklist = [
    { label: "Nome da empresa", done: Boolean(agent.company_name) },
    { label: "Objectivo do agente", done: Boolean(agent.goal) },
    { label: "Personalidade da IA", done: Boolean(agent.personality) },
    { label: "Instrução da IA", done: Boolean(agent.extra_instructions) },
    { label: "Conhecimento adicionado", done: knowledgeCount > 0 },
    { label: "Exemplos de treinamento", done: exampleCount > 0 },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
        <p className="font-display text-lg font-semibold">{agent.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.company_name ?? "Empresa por definir"} · {agent.tone ?? "tom por definir"}
        </p>
        {agent.products_services && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{agent.products_services}</p>}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {checklist.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-sm">
              <span
                className={
                  c.done
                    ? "h-2 w-2 rounded-full bg-primary"
                    : "h-2 w-2 rounded-full bg-muted-foreground/40"
                }
              />
              <span className={c.done ? "" : "text-muted-foreground"}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Agente ativo</p>
              <p className="text-xs text-muted-foreground">
                Quando ativo, fica disponível para responder no atendimento.
              </p>
            </div>
            <Switch checked={agent.is_active} disabled={!canManage || toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Conhecimento" value={knowledgeCount} />
          <Stat label="Exemplos" value={exampleCount} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="font-display text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const CONFIG_FIELDS: {
  key: keyof Agent;
  label: string;
  hint: string;
  long?: boolean;
}[] = [
  { key: "name", label: "Nome do agente", hint: "Nome pelo qual o assistente será conhecido." },
  { key: "tone", label: "Tom de voz", hint: "Escolha um estilo sugerido ou escreva o seu." },
  { key: "goal", label: "Objectivo do agente", hint: "O resultado principal que o assistente deve alcançar.", long: true },
  { key: "personality", label: "Personalidade da IA", hint: "Descreva como a IA deve ser, falar e relacionar-se com os clientes.", long: true },
  { key: "extra_instructions", label: "Instrução da IA", hint: "Explique tarefas, processos, prioridades e regras específicas. Pode escrever ou ditar.", long: true },
  { key: "company_name", label: "Nome da empresa", hint: "Nome comercial da sua empresa." },
  { key: "company_description", label: "Descrição da empresa", hint: "O que a empresa faz e a quem serve.", long: true },
  { key: "can_do", label: "O que a IA pode fazer (opcional)", hint: "Acções autorizadas, como esclarecer dúvidas e recolher pedidos.", long: true },
  { key: "cannot_do", label: "O que a IA não pode fazer (opcional)", hint: "Limites, promessas ou acções que deve evitar.", long: true },
];

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>>;
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

function ConfigForm({ agent, orgId, canManage }: { agent: Agent; orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const organizeFn = useServerFn(organizeAgentInstructions);
  const [form, setForm] = useState<Record<string, string>>({});
  const [readDelaySeconds, setReadDelaySeconds] = useState(1.5);
  const [responseDelaySeconds, setResponseDelaySeconds] = useState(2);
  const [recordingField, setRecordingField] = useState<string | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [organizingField, setOrganizingField] = useState<string | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingFieldRef = useRef<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of CONFIG_FIELDS) next[f.key] = ((agent[f.key] as string | null) ?? "") as string;
    setForm(next);
    const storedConfig = agent.config && typeof agent.config === "object" ? agent.config : {};
    const readDelay = Number(storedConfig["readDelaySeconds"]);
    const responseDelay = Number(storedConfig["responseDelaySeconds"]);
    const legacyMin = Number(storedConfig["responseDelayMinSeconds"]);
    const legacyMax = Number(storedConfig["responseDelayMaxSeconds"]);
    const legacyResponse = Number.isFinite(legacyMin) && Number.isFinite(legacyMax)
      ? (legacyMin + legacyMax) / 2
      : 2;
    setReadDelaySeconds(Number.isFinite(readDelay) ? Math.round(Math.min(10, Math.max(0, readDelay)) * 2) / 2 : 1.5);
    setResponseDelaySeconds(Number.isFinite(responseDelay)
      ? Math.round(Math.min(15, Math.max(0, responseDelay)) * 2) / 2
      : Math.round(Math.min(15, Math.max(0, legacyResponse)) * 2) / 2);
    recordingFieldRef.current = null;
    setRecordingField(null);
    setTranscriptPreview("");
    speechRef.current?.abort?.();
    speechRef.current?.stop();
    speechRef.current = null;
  }, [agent.id]);

  useEffect(() => () => {
    recordingFieldRef.current = null;
    speechRef.current?.abort?.();
    speechRef.current?.stop();
    speechRef.current = null;
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const f of CONFIG_FIELDS) {
        const v = (form[f.key] ?? "").trim();
        payload[f.key] = v.length > 0 ? v : null;
      }
      if (!payload["name"]) throw new Error("O agente precisa de um nome.");
      // A primeira configuração válida activa o agente automaticamente.
      // Não reactivar agentes já configurados que o cliente tenha pausado manualmente.
      const autoActivate = !agent.is_active && !agent.personality?.trim()
        && Boolean(payload["personality"]?.trim());
      const safeReadDelay = Math.round(Math.min(10, Math.max(0, readDelaySeconds)) * 2) / 2;
      const safeResponseDelay = Math.round(Math.min(15, Math.max(0, responseDelaySeconds)) * 2) / 2;
      const existingConfig = agent.config && typeof agent.config === "object" ? agent.config : {};
      const updatePayload = {
        ...payload,
        config: {
          ...existingConfig,
          readDelaySeconds: safeReadDelay,
          responseDelaySeconds: safeResponseDelay,
        },
        ...(autoActivate ? { is_active: true } : {}),
      };
      const { error } = await supabase
        .from("ai_agents")
        .update(updatePayload)
        .eq("id", agent.id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);

      if (autoActivate) {
        // First successful setup: automatically bind this agent to the first
        // connected WhatsApp that has no explicit agent yet.
        const { data: number, error: numberError } = await supabase.from("whatsapp_numbers")
          .select("id")
          .eq("organization_id", orgId)
          .eq("status", "connected")
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (numberError) throw new Error(numberError.message);
        if (number) {
          const { data: existingAssignment, error: assignmentError } = await supabase
            .from("ai_agent_whatsapp_numbers")
            .select("agent_id")
            .eq("organization_id", orgId)
            .eq("whatsapp_number_id", number.id)
            .maybeSingle();
          if (assignmentError) throw new Error(assignmentError.message);
          if (!existingAssignment) {
            const { error: assignError } = await supabase.from("ai_agent_whatsapp_numbers").insert({
              organization_id: orgId,
              agent_id: agent.id,
              whatsapp_number_id: number.id,
            });
            if (assignError) throw new Error(assignError.message);
            const { error: enableError } = await supabase.from("whatsapp_numbers")
              .update({ ai_enabled: true }).eq("organization_id", orgId).eq("id", number.id);
            if (enableError) throw new Error(enableError.message);
          } else if (existingAssignment.agent_id === agent.id) {
            const { error: enableError } = await supabase.from("whatsapp_numbers")
              .update({ ai_enabled: true }).eq("organization_id", orgId).eq("id", number.id);
            if (enableError) throw new Error(enableError.message);
          }
        }
      }
      return autoActivate;
    },
    onSuccess: (autoActivated) => {
      toast.success(autoActivated ? "Configuração guardada. A IA foi activada automaticamente." : "Configuração da IA guardada.");
      void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopDictation = () => {
    const active = speechRef.current;
    recordingFieldRef.current = null;
    setRecordingField(null);
    setTranscriptPreview("");
    speechRef.current = null;
    try { active?.stop(); } catch {
      try { active?.abort?.(); } catch { /* reconhecimento já encerrado */ }
    }
  };

  const toggleDictation = (key: string) => {
    if (recordingFieldRef.current === key) {
      stopDictation();
      return;
    }
    if (speechRef.current) stopDictation();

    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("O ditado por voz não é suportado neste navegador. Tenta no Google Chrome actualizado.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-PT";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const part = result?.[0]?.transcript?.trim() ?? "";
        if (!part) continue;
        if (result?.[0]?.isFinal) finalText += (finalText ? " " : "") + part;
        else interimText += (interimText ? " " : "") + part;
      }
      if (finalText) {
        setForm((current) => ({
          ...current,
          [key]: [current[key]?.trim(), finalText].filter(Boolean).join("\n"),
        }));
      }
      setTranscriptPreview(interimText);
    };
    recognition.onerror = (event) => {
      if (speechRef.current === recognition) {
        speechRef.current = null;
        recordingFieldRef.current = null;
        setRecordingField(null);
        setTranscriptPreview("");
      }
      const messages: Record<string, string> = {
        "not-allowed": "O navegador bloqueou o microfone. Autoriza-o nas permissões do site.",
        "audio-capture": "Não foi encontrado um microfone disponível.",
        "no-speech": "Não foi detectada fala. Tenta falar mais perto do microfone.",
        "network": "O serviço de reconhecimento de voz falhou. Verifica a ligação à internet.",
      };
      toast.error(messages[event.error ?? ""] ?? "Não foi possível transcrever o áudio. Tenta novamente.");
    };
    recognition.onend = () => {
      if (speechRef.current === recognition) {
        speechRef.current = null;
        recordingFieldRef.current = null;
        setRecordingField(null);
      }
      setTranscriptPreview("");
    };
    speechRef.current = recognition;
    recordingFieldRef.current = key;
    setRecordingField(key);
    setTranscriptPreview("");
    try {
      recognition.start();
    } catch {
      speechRef.current = null;
      recordingFieldRef.current = null;
      setRecordingField(null);
      toast.error("Não foi possível iniciar o microfone. Verifica a permissão do navegador.");
    }
  };

  const organize = async (key: string) => {
    const text = (form[key] ?? "").trim();
    if (text.length < 10) {
      toast.error("Escreve ou dita mais detalhes antes de organizar.");
      return;
    }
    setOrganizingField(key);
    try {
      const result = await organizeFn({ data: { organizationId: orgId, agentId: agent.id, text } });
      setForm((current) => ({ ...current, [key]: result.text }));
      toast.success("Texto organizado. Revê e guarda a configuração.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setOrganizingField(null);
    }
  };

  const toneTemplates = [
    "Profissional, simpático e claro",
    "Próximo, acolhedor e paciente",
    "Consultivo, especialista e orientado para vendas",
    "Directo, breve e objectivo",
    "Elegante, premium e discreto",
    "Enérgico, persuasivo e respeitoso",
  ];

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        {CONFIG_FIELDS.map((f) => (
          <div key={f.key} className={f.long ? "min-w-0 space-y-2 md:col-span-2" : "min-w-0 space-y-2"}>
            <Label htmlFor={f.key}>{f.label}</Label>
            {f.long ? (
              <Textarea
                id={f.key}
                rows={f.key === "personality" || f.key === "extra_instructions" ? 7 : 3}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((current) => ({ ...current, [f.key]: e.target.value }))}
                placeholder={f.hint}
                className="min-h-24 resize-y"
              />
            ) : (
              <Input
                id={f.key}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((current) => ({ ...current, [f.key]: e.target.value }))}
                placeholder={f.hint}
                list={f.key === "tone" ? "whappnus-tone-templates" : undefined}
              />
            )}
            {f.key === "tone" && <datalist id="whappnus-tone-templates">{toneTemplates.map((tone) => <option key={tone} value={tone} />)}</datalist>}
            {(f.key === "goal" || f.key === "personality" || f.key === "extra_instructions") && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={recordingField === f.key ? "default" : "outline"} onClick={() => toggleDictation(f.key)} className="max-w-full">
                  <Mic className="mr-2 size-4" />{recordingField === f.key ? "Parar ditado" : "Ditar por voz"}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={organizingField !== null} onClick={() => void organize(f.key)}>
                  {organizingField === f.key ? <Loader2 className="mr-2 size-4 animate-spin" /> : <WandSparkles className="mr-2 size-4" />}
                  {organizingField === f.key ? "A organizar…" : "Organizar com IA"}
                </Button>
              </div>
            )}
            {recordingField === f.key && (
              <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
                <span className="flex h-6 items-center gap-0.5" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5, 6].map((bar) => <span key={bar} className="w-1 rounded-full bg-primary animate-pulse" style={{ height: `${8 + (bar % 4) * 4}px`, animationDelay: `${bar * 90}ms` }} />)}
                </span>
                <span className="min-w-0">{transcriptPreview ? `A transcrever: “${transcriptPreview}”` : "Microfone activo. Fala agora; o texto final será inserido no campo quando parares."}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>
      <section className="rounded-xl border border-border bg-secondary/30 p-4 sm:p-5 space-y-5">
        <div>
          <h3 className="font-semibold">Comportamento das mensagens</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Personaliza os intervalos de leitura e resposta da IA para proporcionar uma experiência de atendimento mais natural, sem comprometer a rapidez e a qualidade do serviço.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="read-delay-seconds">Tempo para visualizar a mensagem</Label>
              <p id="read-delay-help" className="mt-1 text-sm text-muted-foreground">
                Define quanto tempo a IA aguarda depois de receber a mensagem antes de a marcar como lida, quando o canal suporta essa funcionalidade.
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-background px-3 py-1 text-sm font-semibold tabular-nums">{readDelaySeconds.toLocaleString("pt-AO", { maximumFractionDigits: 1 })} s</span>
          </div>
          <input
            id="read-delay-seconds" type="range" min={0} max={10} step={0.5}
            value={readDelaySeconds}
            onChange={(e) => setReadDelaySeconds(Number(e.target.value))}
            disabled={!canManage || save.isPending}
            aria-describedby="read-delay-help"
            className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-xs text-muted-foreground"><span>0 s — Imediatamente</span><span>10 s — Máximo</span></div>
        </div>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="response-delay-seconds">Tempo de resposta da IA</Label>
              <p id="response-delay-help" className="mt-1 text-sm text-muted-foreground">
                Define a espera adicional depois de a IA concluir a resposta. O processamento normal e a latência do canal continuam a influenciar o tempo total.
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-background px-3 py-1 text-sm font-semibold tabular-nums">{responseDelaySeconds.toLocaleString("pt-AO", { maximumFractionDigits: 1 })} s</span>
          </div>
          <input
            id="response-delay-seconds" type="range" min={0} max={15} step={0.5}
            value={responseDelaySeconds}
            onChange={(e) => setResponseDelaySeconds(Number(e.target.value))}
            disabled={!canManage || save.isPending}
            aria-describedby="response-delay-help"
            className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-xs text-muted-foreground"><span>0 s — Sem espera adicional</span><span>15 s — Máximo</span></div>
        </div>
        <p className="text-xs text-muted-foreground">Padrões recomendados: 1,5 s para leitura e 2 s para resposta. O valor 0 remove a espera artificial adicional.</p>
      </section>
      <p className="rounded-md bg-secondary/60 p-3 text-xs text-muted-foreground">Dica: pode ditar instruções longas e depois usar “Organizar com IA”. O texto será estruturado sem inventar preços, políticas ou informações que não forneceu. Revê sempre o resultado antes de guardar.</p>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Guardar configuração
      </Button>
    </form>
  );
}

function KnowledgePanel({
  orgId,
  agentId,
  items,
  loading,
  canManage,
}: {
  orgId: string;
  agentId: string;
  items: Knowledge[];
  loading: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("geral");

  const add = useMutation({
    mutationFn: async () => {
      if (title.trim().length < 2 || content.trim().length < 2) {
        throw new Error("Preencha título e conteúdo.");
      }
      const { error } = await supabase.from("ai_knowledge").insert({
        organization_id: orgId,
        agent_id: agentId,
        title: title.trim(),
        content: content.trim(),
        category,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setTitle("");
      setContent("");
      toast.success("Conhecimento adicionado.");
      void qc.invalidateQueries({ queryKey: ["ai-knowledge", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ai_knowledge")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai-knowledge", orgId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PdfUploadPanel orgId={orgId} agentId={agentId} canManage={canManage} />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="font-display font-semibold">Adicionar conhecimento</p>
        <div className="space-y-2">
          <Label htmlFor="k-title">Título</Label>
          <Input
            id="k-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Entregas em Luanda"
          />
        </div>
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="k-content">Conteúdo</Label>
          <Textarea
            id="k-content"
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Escreva a informação como quer que a IA a use."
          />
        </div>
        <Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">
          {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Adicionar
        </Button>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">A carregar…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem conhecimento ainda. Comece pelos produtos, preços e horários.
          </p>
        ) : (
          items.map((k) => (
            <div key={k.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{k.title}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.category}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(k.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{k.content}</p>
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
}

function PdfUploadPanel({ orgId, agentId, canManage }: { orgId: string; agentId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);

  const documentsQuery = useQuery({
    queryKey: ["ai-knowledge-documents", orgId, agentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_knowledge_documents")
        .select("id, file_name, size_bytes, extracted_chars, storage_path, created_at")
        .eq("organization_id", orgId).eq("agent_id", agentId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; file_name: string; size_bytes: number; extracted_chars: number; storage_path: string; created_at: string }>;
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!canManage) throw new Error("Apenas OWNER ou ADMIN pode carregar documentos.");
      if (!file) throw new Error("Escolha um PDF.");
      if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) throw new Error("Escolha um ficheiro PDF válido.");
      if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("O PDF deve ter até 20 MB.");

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      if (pdf.numPages > 500) {
        await pdf.destroy();
        throw new Error("O PDF tem mais de 500 páginas. Divida-o em ficheiros menores.");
      }
      const pageTexts: string[] = [];
      try {
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
          const page = await pdf.getPage(pageNo);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean).join(" ");
          if (pageText.trim()) pageTexts.push(pageText.trim());
        }
      } finally {
        await pdf.destroy();
      }
      const extracted = pageTexts.join("\n\n").replace(/[ \t]+/g, " ").trim().slice(0, 150000);
      if (extracted.length < 20) throw new Error("Este PDF não contém texto extraível. PDFs digitalizados como imagens precisam de OCR, que ainda não está incluído.");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "documento.pdf";
      const storagePath = `${orgId}/${agentId}/${crypto.randomUUID()}-${safeName}`;
      const { error: storageError } = await supabase.storage.from("ai-knowledge-pdfs")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (storageError) throw new Error("Falha ao guardar o PDF: " + storageError.message);

      let documentId: string | null = null;
      try {
        const { data: doc, error: docError } = await supabase.from("ai_knowledge_documents").insert({
          organization_id: orgId, agent_id: agentId, file_name: file.name,
          storage_path: storagePath, size_bytes: file.size, extracted_chars: extracted.length,
        }).select("id").single();
        if (docError) throw new Error(docError.message);
        documentId = doc.id as string;

        const chunks: Array<Record<string, unknown>> = [];
        const size = 2400, overlap = 200;
        for (let offset = 0; offset < extracted.length && chunks.length < 70; offset += size - overlap) {
          const part = extracted.slice(offset, offset + size).trim();
          if (part) chunks.push({
            organization_id: orgId, agent_id: agentId, source_document_id: documentId,
            title: `${file.name} — trecho ${chunks.length + 1}`, content: part, category: "geral",
          });
        }
        const { error: chunkError } = await supabase.from("ai_knowledge").insert(chunks);
        if (chunkError) throw new Error("Não foi possível indexar o texto do PDF: " + chunkError.message);
        return { chunks: chunks.length };
      } catch (error) {
        if (documentId) await supabase.from("ai_knowledge_documents").delete().eq("id", documentId).eq("organization_id", orgId);
        await supabase.storage.from("ai-knowledge-pdfs").remove([storagePath]);
        throw error;
      }
    },
    onSuccess: (result) => {
      setFile(null);
      toast.success(`PDF carregado e indexado em ${result.chunks} partes.`);
      void qc.invalidateQueries({ queryKey: ["ai-knowledge", orgId, agentId] });
      void qc.invalidateQueries({ queryKey: ["ai-knowledge-documents", orgId, agentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (doc: { id: string; storage_path: string }) => {
      if (!canManage) throw new Error("Apenas OWNER ou ADMIN pode eliminar documentos.");
      const { error: storageError } = await supabase.storage.from("ai-knowledge-pdfs").remove([doc.storage_path]);
      if (storageError) throw new Error("Falha ao eliminar o ficheiro: " + storageError.message);
      const { error } = await supabase.from("ai_knowledge_documents").delete()
        .eq("id", doc.id).eq("organization_id", orgId).eq("agent_id", agentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("PDF e conteúdo de treinamento removidos.");
      void qc.invalidateQueries({ queryKey: ["ai-knowledge", orgId, agentId] });
      void qc.invalidateQueries({ queryKey: ["ai-knowledge-documents", orgId, agentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-display font-semibold">Conhecimento adicional por PDF</h3>
        <p className="mt-1 text-sm text-muted-foreground">Carregue catálogos, tabelas de preços, políticas e manuais. O WhappNus extrai o texto e divide-o em trechos para o agente recuperar durante as conversas. Limite: 20 MB e 500 páginas por PDF. Documentos digitalizados sem texto precisam de OCR, ainda não incluído.</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="ai-knowledge-pdf">Ficheiro PDF</Label>
          <Input id="ai-knowledge-pdf" type="file" accept=".pdf,application/pdf" disabled={!canManage || upload.isPending} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <p className="text-xs text-muted-foreground">{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</p>}
        </div>
        <Button onClick={() => upload.mutate()} disabled={!canManage || !file || upload.isPending} className="sm:min-w-44">
          {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          {upload.isPending ? "A processar…" : "Carregar PDF"}
        </Button>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Documentos deste agente</h4>
        {documentsQuery.isLoading ? <p className="text-sm text-muted-foreground">A carregar documentos…</p> : documentsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar documentos: {(documentsQuery.error as Error).message}</p>
        ) : (documentsQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há PDFs carregados para este agente.</p>
        ) : (documentsQuery.data ?? []).map((doc) => (
          <div key={doc.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{doc.file_name}</p>
              <p className="text-xs text-muted-foreground">{(Number(doc.size_bytes) / (1024 * 1024)).toFixed(2)} MB · {Number(doc.extracted_chars).toLocaleString("pt-PT")} caracteres · {new Date(doc.created_at).toLocaleDateString("pt-PT")}</p>
            </div>
            <Button variant="outline" size="sm" disabled={!canManage || remove.isPending} onClick={() => {
              if (window.confirm(`Eliminar “${doc.file_name}” e retirar o seu texto do treinamento?`)) remove.mutate({ id: doc.id, storage_path: doc.storage_path });
            }}><Trash2 className="mr-2 h-4 w-4" /> Eliminar PDF</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExamplesPanel({
  orgId,
  agentId,
  items,
  loading,
}: {
  orgId: string;
  agentId: string;
  items: Example[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [type, setType] = useState<string>("exemplo");

  const add = useMutation({
    mutationFn: async () => {
      if (input.trim().length < 2 || output.trim().length < 2) {
        throw new Error("Preencha a pergunta e a resposta esperada.");
      }
      const { error } = await supabase.from("ai_training_examples").insert({
        organization_id: orgId,
        agent_id: agentId,
        input: input.trim(),
        expected_output: output.trim(),
        example_type: type,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setInput("");
      setOutput("");
      toast.success("Exemplo guardado.");
      void qc.invalidateQueries({ queryKey: ["ai-examples", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ai_training_examples")
        .delete()
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai-examples", orgId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="font-display font-semibold">Ensinar com um exemplo</p>
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXAMPLE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="e-input">Pergunta do cliente</Label>
          <Textarea
            id="e-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ex.: Vocês fazem entrega?"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="e-output">Resposta esperada</Label>
          <Textarea
            id="e-output"
            rows={4}
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="Ex.: Sim, fazemos entrega. Diga-me a sua localização para lhe indicar o valor."
          />
        </div>
        <Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">
          {add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Guardar exemplo
        </Button>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">A carregar…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem exemplos ainda. Ensine as perguntas que os seus clientes fazem todos os dias.
          </p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {EXAMPLE_TYPES.find((t) => t.value === e.example_type)?.label ?? e.example_type}
                </p>
                <Button variant="ghost" size="icon" onClick={() => remove.mutate(e.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-sm font-medium">{e.input}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{e.expected_output}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TestPanel({ orgId, agentId, agentName, canTest }: { orgId: string; agentId: string; agentName: string; canTest: boolean }) {
  const testConversationId = useRef(crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  const ask = useMutation({
    mutationFn: async (text: string) =>
      testOrgAiAgent({ data: { organizationId: orgId, agentId, conversationId: testConversationId.current, message: text, history: turns.slice(-10) } }),
    onSuccess: (res, text) => {
      setTurns((t) => [...t, { role: "user", content: text }, { role: "assistant", content: res.reply }]);
      setMessage("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="min-h-[280px] space-y-3 rounded-xl border border-border bg-card p-5">
        {turns.length === 0 ? (
          <div className="flex h-[240px] flex-col items-center justify-center text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Escreva como se fosse um cliente e veja o que {agentName} responderia.
            </p>
          </div>
        ) : (
          turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user"
                  ? "ml-auto max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground"
                  : "mr-auto max-w-[80%] rounded-2xl bg-secondary px-4 py-2 text-sm"
              }
            >
              {t.content}
            </div>
          ))
        )}
        {ask.isPending ? (
          <p className="text-xs text-muted-foreground">{agentName} está a escrever…</p>
        ) : null}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = message.trim();
          if (text) ask.mutate(text);
        }}
      >
        <Input
          value={message}
          disabled={!canTest}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ex.: Vocês fazem entrega?"
        />
        <Button type="submit" disabled={!canTest || ask.isPending || message.trim().length === 0}>
          Enviar
        </Button>
      </form>
      {!canTest && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">O teste da IA está bloqueado enquanto a assinatura estiver suspensa. Consulte os planos para reactivar o acesso.</p>}
      <p className="text-xs text-muted-foreground">
        O teste usa apenas a configuração, o conhecimento e os exemplos da sua organização.
      </p>
    </div>
  );
}
