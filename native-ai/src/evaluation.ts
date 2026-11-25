export interface Evaluation { score: number; flags: string[] }

function normalize(value: string): string {
  return value.toLocaleLowerCase("pt-AO").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/).filter((word) => word.length > 2));
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function isGreeting(value: string): boolean {
  return /^(?:oi|ol[áa]|bom dia|boa tarde|boa noite|hey|hello)[!.,\s]*$/i.test(value.trim());
}

function isExplicitRepeatRequest(value: string): boolean {
  return /\b(repete|repetir|repita|outra vez|novamente|reformula|reformular|diz de novo)\b/i.test(value);
}

function isIntroductoryReply(value: string): boolean {
  return /^(?:ol[áa][!,. ]*)?(?:seja\s+(?:muito\s+)?bem-vind[oa]|sou\s+.{1,70}\b(?:atendente|assistente)\b|vi\s+que\s+tem\s+interesse|como\s+posso\s+(?:(?:te|lhe)\s+)?ajudar)/i.test(value.trim());
}

function historyBody(turn: Record<string, unknown>): string {
  return String(turn.body ?? turn.content ?? turn.text ?? "").trim();
}

function isAssistantTurn(turn: Record<string, unknown>): boolean {
  return Boolean(turn.from_me ?? turn.fromMe) || String(turn.direction) === "outbound" || turn.role === "assistant";
}

export function evaluateResponse(
  input: string,
  output: string,
  knowledgeUsed: number,
  history: Array<Record<string, unknown>> = [],
): Evaluation {
  const flags: string[] = [];
  const normalizedOutput = normalize(output);
  if (!normalizedOutput) flags.push("empty");
  if (output.length > 1800) flags.push("too_long_for_whatsapp");
  if (/(api[_ -]?key|service[_ -]?role|bridge[_ -]?secret|system prompt)/i.test(output)) {
    flags.push("possible_secret_or_internal_disclosure");
  }
  if (knowledgeUsed === 0 && /(preço|preco|valor|horário|horario|endereço|endereco)/i.test(input)) {
    flags.push("business_fact_without_retrieved_knowledge");
  }

  if (history.length > 0 && !isExplicitRepeatRequest(input)) {
    if (!isGreeting(input) && isIntroductoryReply(output)) {
      flags.push("introductory_reply_during_existing_conversation");
    }
    const previousAssistant = history.filter(isAssistantTurn).map(historyBody).filter(Boolean);
    if (output.trim().length >= 45 && previousAssistant.some((previous) => similarity(output, previous) >= 0.72)) {
      flags.push("repeated_previous_answer");
    }
  }

  let score = 1;
  score -= flags.includes("empty") ? 0.8 : 0;
  score -= flags.includes("too_long_for_whatsapp") ? 0.15 : 0;
  score -= flags.includes("possible_secret_or_internal_disclosure") ? 0.8 : 0;
  score -= flags.includes("business_fact_without_retrieved_knowledge") ? 0.2 : 0;
  score -= flags.includes("introductory_reply_during_existing_conversation") ? 0.55 : 0;
  score -= flags.includes("repeated_previous_answer") ? 0.65 : 0;
  return { score: Math.max(0, Number(score.toFixed(3))), flags };
}

/** Only conversational failures that can be fixed with a single retry are hard failures. */
export function shouldRegenerate(evaluation: Evaluation): boolean {
  return evaluation.flags.some((flag) => [
    "empty",
    "possible_secret_or_internal_disclosure",
    "introductory_reply_during_existing_conversation",
    "repeated_previous_answer",
  ].includes(flag));
}
