import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  const qc = useQueryClient();

  const agentQuery = useQuery({
    queryKey: ["ai-agent", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select(AGENT_FIELDS)
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as Agent) ?? null;
    },
  });

  const agent = agentQuery.data ?? null;

  const knowledgeQuery = useQuery({
    queryKey: ["ai-knowledge", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_knowledge")
        .select("id, title, content, category, is_active")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Knowledge[];
    },
  });

  const examplesQuery = useQuery({
    queryKey: ["ai-examples", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_training_examples")
        .select("id, input, expected_output, example_type, is_active")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Example[];
    },
  });

  const createAgent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("ensure_ai_agent", { _organization_id: orgId! });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Agente criado. Agora preencha a configuração.");
      void qc.invalidateQueries({ queryKey: ["ai-agent", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!orgId) {
    return (
      <AppShell title="Inteligência Artificial" description="Agente de atendimento da sua empresa">
        <p className="text-sm text-muted-foreground">A carregar a organização…</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Inteligência Artificial"
      description="Configure, treine e teste o assistente da sua empresa"
    >
      {agentQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : !agent ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-4 font-display text-lg font-semibold">Ainda não tem um agente de IA</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Crie o agente da sua empresa e depois diga-lhe como deve atender os seus clientes:
            objetivo, produtos, horários, formas de pagamento e regras.
          </p>
          <Button className="mt-5" onClick={() => createAgent.mutate()} disabled={createAgent.isPending}>
            {createAgent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Criar agente da minha empresa
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="config">Configuração</TabsTrigger>
            <TabsTrigger value="knowledge">Conhecimento</TabsTrigger>
            <TabsTrigger value="examples">Exemplos de treinamento</TabsTrigger>
            <TabsTrigger value="test">Testar IA</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Overview
              agent={agent}
              knowledgeCount={knowledgeQuery.data?.length ?? 0}
              exampleCount={examplesQuery.data?.length ?? 0}
              orgId={orgId}
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
            <TestPanel orgId={orgId} agentName={agent.name} />
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}

function Overview({
  agent,
  knowledgeCount,
  exampleCount,
  orgId,
}: {
  agent: Agent;
  knowledgeCount: number;
  exampleCount: number;
  orgId: string;
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai-agent", orgId] }),
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
            <Switch checked={agent.is_active} onCheckedChange={(v) => toggle.mutate(v)} />
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
      void qc.invalidateQueries({ queryKey: ["ai-agent", orgId] });
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
}: {
  orgId: string;
  agentId: string;
  items: Knowledge[];
  loading: boolean;
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

function TestPanel({ orgId, agentName }: { orgId: string; agentName: string }) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  const ask = useMutation({
    mutationFn: async (text: string) =>
      testOrgAiAgent({ data: { organizationId: orgId, message: text, history: turns.slice(-10) } }),
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
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ex.: Vocês fazem entrega?"
        />
        <Button type="submit" disabled={ask.isPending || message.trim().length === 0}>
          Enviar
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        O teste usa apenas a configuração, o conhecimento e os exemplos da sua organização.
      </p>
    </div>
  );
}
