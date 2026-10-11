import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { testOrgAiAgent } from "@/lib/ai.functions";

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
  "id, organization_id, name, model, is_active, goal, company_name, company_description",
  "products_services, business_hours, location, payment_methods, faq, tone",
  "service_rules, can_do, cannot_do, handoff_instructions, greeting_message, extra_instructions",
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
  const canManage = (membership?.role === "OWNER" || membership?.role === "ADMIN") && subscription.active;
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
  const agent = agents.find((item) => item.id === selectedAgentId) ?? agents[0] ?? null;

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId !== null) setSelectedAgentId(null);
      return;
    }
    if (!selectedAgentId || !agents.some((item) => item.id === selectedAgentId)) {
      setSelectedAgentId(agents[0]?.id ?? null);
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
      if (!canManage) throw new Error("Apenas OWNER ou ADMIN pode criar agentes.");
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
              </p>
            </div>
            {canManage && (
              <Button onClick={() => createAgent.mutate()} disabled={createAgent.isPending} className="w-full sm:w-auto">
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
          {!canManage && <p className="mt-3 text-xs text-muted-foreground">Apenas OWNER ou ADMIN pode criar ou eliminar agentes.</p>}
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
              <ConfigForm agent={agent} orgId={orgId} />
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
        .select("id, display_name, phone_e164, provider, status")
        .eq("organization_id", orgId).is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; display_name: string | null; phone_e164: string | null; provider: string | null; status: string }>;
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
      } else {
        const { error } = await supabase.from("ai_agent_whatsapp_numbers").delete()
          .eq("organization_id", orgId)
          .eq("agent_id", agentId)
          .eq("whatsapp_number_id", input.numberId);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Associação WhatsApp actualizada.");
      void qc.invalidateQueries({ queryKey: ["agent-whatsapp-assignments", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const numbers = numbersQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const currentAgentNumberCount = assignments.filter((item) => item.agent_id === agentId).length;

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-display text-base font-semibold">WhatsApps associados a {agentName}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada número pode ter um único agente associado. Se associares um número que já pertence a outro agente, a associação será transferida.
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
            const isAssigned = current?.agent_id === agentId;
            const assignedAgent = current ? agents.find((item) => item.id === current.agent_id) : null;
            return (
              <div key={number.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{number.display_name || number.phone_e164 || "WhatsApp sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{number.phone_e164 || "Número ainda não identificado"} · {number.provider === "qr" ? "QR Code" : "Meta Cloud API"} · {number.status}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isAssigned ? "Este agente atende este número." : current ? `Associado a: ${assignedAgent?.name ?? "outro agente"}` : "Sem agente específico; será usado o comportamento padrão."}
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
                    aria-label={`Associar ${number.display_name || number.phone_e164 || "WhatsApp"} a ${agentName}`}
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
    { label: "Objetivo do agente", done: Boolean(agent.goal) },
    { label: "Produtos e serviços", done: Boolean(agent.products_services) },
    { label: "Horário de atendimento", done: Boolean(agent.business_hours) },
    { label: "Formas de pagamento", done: Boolean(agent.payment_methods) },
    { label: "Regras de atendimento", done: Boolean(agent.service_rules) },
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
  { key: "name", label: "Nome do agente", hint: "Como o assistente se apresenta ao cliente." },
  { key: "goal", label: "Objetivo do agente", hint: "Ex.: atender clientes e recolher pedidos.", long: true },
  { key: "company_name", label: "Nome da empresa", hint: "Nome comercial da sua empresa." },
  { key: "company_description", label: "Descrição da empresa", hint: "O que a empresa faz.", long: true },
  { key: "products_services", label: "Produtos e serviços", hint: "Liste o que vende, com detalhes úteis.", long: true },
  { key: "business_hours", label: "Horário de atendimento", hint: "Ex.: segunda a sábado, 8h–18h.", long: true },
  { key: "location", label: "Localização", hint: "Endereço ou zonas onde atua.", long: true },
  { key: "payment_methods", label: "Formas de pagamento", hint: "Ex.: transferência, multicaixa, dinheiro.", long: true },
  { key: "faq", label: "Perguntas frequentes e respostas", hint: "Uma pergunta e resposta por linha.", long: true },
  { key: "tone", label: "Tom de comunicação", hint: "Ex.: simpático, formal, direto." },
  { key: "service_rules", label: "Regras de atendimento", hint: "O que deve sempre cumprir.", long: true },
  { key: "can_do", label: "O que a IA pode fazer", hint: "Ex.: informar preços e horários.", long: true },
  { key: "cannot_do", label: "O que a IA NÃO pode fazer", hint: "Ex.: dar descontos.", long: true },
  { key: "handoff_instructions", label: "Quando encaminhar para um atendente", hint: "Situações que exigem um humano.", long: true },
  { key: "greeting_message", label: "Mensagem inicial", hint: "Primeira mensagem enviada ao cliente.", long: true },
  { key: "extra_instructions", label: "Instruções adicionais", hint: "Qualquer outra orientação.", long: true },
];

function ConfigForm({ agent, orgId }: { agent: Agent; orgId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of CONFIG_FIELDS) next[f.key] = ((agent[f.key] as string | null) ?? "") as string;
    setForm(next);
  }, [agent.id]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | null> = {};
      for (const f of CONFIG_FIELDS) {
        const v = (form[f.key] ?? "").trim();
        payload[f.key] = v.length > 0 ? v : null;
      }
      if (!payload["name"]) throw new Error("O agente precisa de um nome.");
      const { error } = await supabase
        .from("ai_agents")
        .update(payload)
        .eq("id", agent.id)
        .eq("organization_id", orgId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Treinamento da IA guardado.");
      void qc.invalidateQueries({ queryKey: ["ai-agents", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
          <div key={f.key} className={f.long ? "space-y-2 md:col-span-2" : "space-y-2"}>
            <Label htmlFor={f.key}>{f.label}</Label>
            {f.long ? (
              <Textarea
                id={f.key}
                rows={3}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.hint}
              />
            ) : (
              <Input
                id={f.key}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.hint}
              />
            )}
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Guardar treinamento
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
            title: `${file.name} — trecho ${chunks.length + 1}`, content: part, category: "documento_pdf",
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
