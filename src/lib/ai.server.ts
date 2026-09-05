/**
 * Wappy Nus — camada SERVER-ONLY da IA por organização.
 *
 * Nunca chega ao browser (`*.server.ts` é bloqueado no bundle do cliente).
 * É a única camada autorizada a usar LOVABLE_API_KEY e o service_role.
 *
 * Fluxo previsto para o WhatsApp Cloud API oficial:
 *   webhook -> organização -> contacto/conversa -> loadOrgAiContext ->
 *   generateOrgAiReply -> fila de envio (message_jobs) -> Cloud API.
 */
import { serviceClient } from "./whatsapp.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.7-flash";

export type AiAgentRow = {
  id: string;
  organization_id: string;
  name: string;
  model: string | null;
  is_active: boolean;
  system_prompt: string | null;
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
  language: string | null;
};

export type AiContext = {
  agent: AiAgentRow | null;
  knowledge: { title: string; category: string; content: string }[];
  examples: { input: string; output: string; type: string }[];
};

/** Contexto completo da IA de UMA organização (isolamento multi-tenant). */
export async function loadOrgAiContext(organizationId: string): Promise<AiContext> {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("ai_agent_context", { _organization_id: organizationId });
  if (error) throw new Error(`Contexto da IA: ${error.message}`);
  const ctx = (data ?? {}) as Partial<AiContext>;
  return {
    agent: ctx.agent ?? null,
    knowledge: ctx.knowledge ?? [],
    examples: ctx.examples ?? [],
  };
}

function section(label: string, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? `\n## ${label}\n${v}` : "";
}

/** Constrói o system prompt exclusivamente com os dados daquela organização. */
export function buildSystemPrompt(ctx: AiContext): string {
  const a = ctx.agent;
  if (!a) return "";

  const knowledge = ctx.knowledge
    .map((k) => `- [${k.category}] ${k.title}: ${k.content}`)
    .join("\n");

  const examples = ctx.examples
    .map((e) =>
      e.type === "exemplo"
        ? `Cliente: ${e.input}\nResposta correcta: ${e.output}`
        : `Regra (${e.type}): quando "${e.input}" -> ${e.output}`,
    )
    .join("\n\n");

  return [
    `És ${a.name}, assistente de atendimento da empresa ${a.company_name ?? "cliente"}.`,
    `Responde sempre em português (${a.language ?? "pt-AO"}), de forma curta e clara, adequada ao WhatsApp.`,
    section("Objectivo", a.goal),
    section("Sobre a empresa", a.company_description),
    section("Produtos e serviços", a.products_services),
    section("Horário de atendimento", a.business_hours),
    section("Localização", a.location),
    section("Formas de pagamento", a.payment_methods),
    section("Perguntas frequentes", a.faq),
    section("Tom de comunicação", a.tone),
    section("Regras de atendimento", a.service_rules),
    section("O que podes fazer", a.can_do),
    section("O que NUNCA podes fazer", a.cannot_do),
    section("Quando encaminhar para um humano", a.handoff_instructions),
    section("Mensagem inicial", a.greeting_message),
    section("Instruções adicionais", a.extra_instructions),
    section("Instruções técnicas do agente", a.system_prompt),
    knowledge ? section("Base de conhecimento da empresa", knowledge) : "",
    examples ? section("Exemplos e regras de treinamento", examples) : "",
    "\n## Limites",
    "Usa apenas a informação acima. Se não souberes, diz que vais confirmar com um colega humano.",
    "Nunca inventes preços, prazos, endereços ou promoções.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Gera a resposta da IA para uma mensagem, usando só o contexto da organização. */
export async function generateOrgAiReply(
  organizationId: string,
  message: string,
  history: ChatTurn[] = [],
): Promise<{ reply: string; model: string; agentName: string }> {
  const ctx = await loadOrgAiContext(organizationId);
  if (!ctx.agent) throw new Error("Esta organização ainda não tem um agente de IA configurado.");

  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY não está configurada no servidor.");

  const model = ctx.agent.model?.startsWith("google/") ? ctx.agent.model : DEFAULT_MODEL;

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(ctx) },
        ...history.slice(-10),
        { role: "user", content: message },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 402) throw new Error("Créditos de IA esgotados nesta área de trabalho.");
    if (res.status === 429) throw new Error("Demasiados pedidos à IA. Tente novamente em instantes.");
    throw new Error(`IA indisponível (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = json.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("A IA não devolveu resposta.");

  return { reply, model, agentName: ctx.agent.name };
}
