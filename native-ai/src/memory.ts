export interface MemoryFact {
  category: "business_type" | "customer_need" | "objection" | "budget" | "preference";
  value: string;
  sourceMessageId: string | null;
  observedAt: string;
  confidence: 1;
}

export interface ConversationMemory {
  summary: string;
  facts: MemoryFact[];
  state: Record<string, unknown>;
  lastMessageId: string | null;
  lastMessageAt: string;
}

const BUSINESS_TERMS = /(neg[oó]cio|empresa|cliente|whatsapp|mensagen|pedido|venda|atendimento|respost|inscri[cç][aã]o|curso|aluno|encomend|agend|agenda|marketing|publicidade|an[uú]ncio|site|loja|produto|servi[cç]o|pre[cç]o|pagamento|or[cç]amento|pastelaria|restaurante|hamburgueria|sal[aã]o|barbearia|cl[ií]nica|escola|forma[cç][aã]o|imobili[aá]ria|academia|hotel|hospedaria|papelaria|oficina|lavandaria|consultoria)/i;

function cleanValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[,;:\s]+|[,;:\s]+$/g, "").trim().slice(0, 140);
}

function extractFacts(text: string, sourceMessageId: string | null, observedAt: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  const patterns: Array<{ category: MemoryFact["category"]; pattern: RegExp; businessOnly?: boolean }> = [
    {
      category: "business_type",
      pattern: /\b(?:trabalho com|o meu neg[oó]cio [ée]|a minha empresa [ée]|minha empresa [ée]|sou (?:dono|dona|propriet[aá]rio|propriet[aá]ria) de|tenho (?:uma?|um)\s+(?:escola|centro de forma[cç][aã]o|academia|pastelaria|restaurante|hamburgueria|loja|sal[aã]o|barbearia|cl[ií]nica|imobili[aá]ria|ag[eê]ncia|hotel|hospedaria|consultoria|papelaria|oficina|lavandaria|creche|mercearia|boutique|gin[aá]sio|estofaria|farm[aá]cia|forma[cç][aã]o))\s+([^.!?\n]{3,140})/i
    },
    {
      category: "customer_need",
      pattern: /\b(?:preciso de|necessito de|gostava de|tenho dificuldade em|o problema [ée]|recebo)\s+([^.!?\n]{3,140})/i,
      businessOnly: true
    },
    {
      category: "objection",
      pattern: /\b(?:j[aá] tenho|j[aá] utilizo|n[aã]o preciso|n[aã]o quero|[ée] caro|muito caro|n[aã]o tenho or[cç]amento)\s*([^.!?\n]{0,120})/i,
      businessOnly: true
    },
    {
      category: "budget",
      pattern: /\b(?:or[cç]amento|posso gastar|tenho dispon[ií]vel)\s*(?:de|[ée]|:)?\s*([\d.,]+\s*(?:kz|kwanzas?))/i,
      businessOnly: true
    },
    {
      category: "preference",
      pattern: /\b(?:prefiro|gosto mais de|quero apenas)\s+([^.!?\n]{3,120})/i,
      businessOnly: true
    }
  ];

  for (const rule of patterns) {
    const match = text.match(rule.pattern);
    if (!match?.[1]) continue;
    if (rule.businessOnly && !BUSINESS_TERMS.test(text)) continue;
    const value = cleanValue(match[1]);
    if (value.length < 3) continue;
    facts.push({
      category: rule.category,
      value,
      sourceMessageId,
      observedAt,
      confidence: 1
    });
  }
  return facts;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("pt-AO").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSummary(facts: MemoryFact[]): string {
  const labels: Record<MemoryFact["category"], string> = {
    business_type: "Negócio",
    customer_need: "Necessidade",
    objection: "Objecção",
    budget: "Orçamento",
    preference: "Preferência"
  };
  const sections: string[] = [];
  for (const category of Object.keys(labels) as MemoryFact["category"][]) {
    const values = facts.filter((fact) => fact.category === category).slice(-2);
    if (values.length) sections.push(labels[category] + ": " + values.map((fact) => fact.value).join("; "));
  }
  return sections.join("\n");
}

function lastQuestion(value: string): string | null {
  const questions = value.match(/[^.!?\n]{4,180}\?/g);
  return questions?.at(-1)?.trim() ?? null;
}

/**
 * Keeps only explicit business-related customer statements. It never infers
 * identity, health, sensitive traits, location, or financial profile.
 */
export function mergeConversationMemory(
  current: { facts?: unknown; summary?: string; state?: unknown } | null,
  customerText: string,
  assistantText: string,
  sourceMessageId: string | null,
  observedAt = new Date().toISOString()
): ConversationMemory {
  const existing = Array.isArray(current?.facts)
    ? current.facts.filter((fact): fact is MemoryFact =>
        Boolean(fact) && typeof fact === "object" &&
        typeof (fact as MemoryFact).category === "string" &&
        typeof (fact as MemoryFact).value === "string"
      )
    : [];
  const correction = /\b(na verdade|corrigindo|correcção|correção|enganei-me|não é|na realidade)\b/i.test(customerText);
  const additions = extractFacts(customerText, sourceMessageId, observedAt);
  let facts = [...existing];
  for (const addition of additions) {
    if (correction) facts = facts.filter((fact) => fact.category !== addition.category);
    const duplicate = facts.some((fact) =>
      fact.category === addition.category && normalize(fact.value) === normalize(addition.value)
    );
    if (!duplicate) facts.push(addition);
  }
  facts = facts.slice(-30);

  const previousState = current?.state && typeof current.state === "object"
    ? current.state as Record<string, unknown>
    : {};
  const question = lastQuestion(assistantText);
  const stage = facts.some((fact) => fact.category === "business_type")
    ? "business_identified"
    : facts.some((fact) => fact.category === "customer_need")
      ? "need_identified"
      : "discovery";

  return {
    summary: buildSummary(facts),
    facts,
    state: {
      ...previousState,
      stage,
      lastAssistantQuestion: question ?? previousState.lastAssistantQuestion ?? null,
      lastCustomerMessageId: sourceMessageId,
      updatedAt: observedAt
    },
    lastMessageId: sourceMessageId,
    lastMessageAt: observedAt
  };
}
