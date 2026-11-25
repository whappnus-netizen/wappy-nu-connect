import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMessages } from "../src/prompt.ts";
import { evaluateResponse, shouldRegenerate } from "../src/evaluation.ts";
import { mergeConversationMemory } from "../src/memory.ts";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("follow-up turns omit first-contact scripts and preserve the current message", () => {
  const agent = {
    id: "agent-1",
    name: "Jonathan",
    personality: "És um atendente comercial cordial.",
    extra_instructions: [
      "## 2. PRIMEIRA ABORDAGEM",
      "Quando receber uma saudação, responde: Olá! Seja muito bem-vindo à WHAPPNUS. Qual é o seu negócio?",
      "## 3. CONTINUIDADE",
      "Quando o cliente já informou o negócio, reconhece essa informação e avança."
    ].join("\n")
  };
  const history = [
    { role: "assistant", content: "Olá! Qual é o seu negócio?" },
    { role: "user", content: "Trabalho com formação de inglês." }
  ];
  const messages = buildMessages(agent, history, "", "", "general", null, "Como assim?");
  assert.equal(messages[0].role, "system");
  assert.doesNotMatch(messages[0].content, /Seja muito bem-vindo à WHAPPNUS/);
  assert.match(messages[0].content, /Esta conversa já começou/);
  assert.match(messages.at(-1).content, /Como assim\?/);
});

test("twenty exchanges retain older customer facts through extractive conversation memory", () => {
  const agent = { id: "agent-2", name: "Jonathan", personality: "Atendente comercial." };
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: index === 16
      ? "Trabalho com formação de inglês e preciso organizar as inscrições."
      : index % 2 === 0 ? "Mensagem do cliente " + index : "Qual é o próximo detalhe que podemos esclarecer?"
  }));
  const messages = buildMessages(agent, history, "", "", "general", null, "E quanto aos horários?");
  assert.match(messages[0].content, /Memória extractiva da conversa/);
  assert.match(messages[0].content, /formação de inglês/);
  assert.match(messages[0].content, /Perguntas anteriores do atendente/);
  assert.equal(messages.length, 18);
  assert.match(messages.at(-1).content, /E quanto aos horários\?/);
});

test("response evaluator rejects a repeated opening after the customer supplied new information", () => {
  const greeting = "Olá! Seja muito bem-vindo à WHAPPNUS. Sou Jonathan, atendente comercial. Qual é o seu negócio?";
  const history = [
    { role: "assistant", content: greeting },
    { role: "user", content: "Trabalho com formação de inglês." }
  ];
  const evaluation = evaluateResponse("formação de inglês", greeting, 0, history);
  assert.ok(evaluation.flags.includes("introductory_reply_during_existing_conversation"));
  assert.ok(evaluation.flags.includes("repeated_previous_answer"));
  assert.equal(shouldRegenerate(evaluation), true);
});

test("response evaluator accepts a contextual acknowledgement instead of a repeated greeting", () => {
  const history = [
    { role: "assistant", content: "Qual é o teu negócio?" },
    { role: "user", content: "Trabalho com formação de inglês." }
  ];
  const evaluation = evaluateResponse(
    "formação de inglês",
    "Interessante! Então trabalhas com formação de inglês. Como organizas actualmente as inscrições dos alunos?",
    0,
    history
  );
  assert.equal(shouldRegenerate(evaluation), false);
});

test("explicit repeat requests are not incorrectly blocked", () => {
  const greeting = "A WHAPPNUS ajuda empresas a organizar o atendimento pelo WhatsApp.";
  const history = [{ role: "assistant", content: greeting }];
  const evaluation = evaluateResponse("Podes repetir o que disseste?", greeting, 0, history);
  assert.equal(evaluation.flags.includes("repeated_previous_answer"), false);
});

test("test history observability uses the exact history sent to the model", async () => {
  const orchestrator = await read("src/orchestrator.ts");
  assert.match(orchestrator, /evaluateResponse\(messageText,response\.text,ranked\.length,effectiveHistory\)/);
  assert.match(orchestrator, /historyMessages:effectiveHistory\.length/);
  assert.match(orchestrator, /historySource:input\.testMode\?"test_payload":"database"/);
  assert.match(orchestrator, /regenerationAttempts/);
});

test("persistent memory stores explicit business facts with provenance", () => {
  const memory = mergeConversationMemory(
    null,
    "Trabalho com formação de inglês e recebo muitos pedidos pelo WhatsApp.",
    "Como organizas actualmente as inscrições?",
    "wa-message-123",
    "2026-11-25T15:00:00.000Z"
  );
  assert.ok(memory.summary.includes("Negócio: formação de inglês"));
  assert.ok(memory.summary.includes("Necessidade: muitos pedidos pelo WhatsApp"));
  assert.equal(memory.facts.every((fact) => fact.confidence === 1), true);
  assert.equal(memory.facts.every((fact) => fact.sourceMessageId === "wa-message-123"), true);
  assert.equal(memory.state.stage, "business_identified");
  assert.equal(memory.state.lastAssistantQuestion, "Como organizas actualmente as inscrições?");
});

test("memory recognises a direct business statement without requiring extra words", () => {
  const memory = mergeConversationMemory(null, "Tenho uma pastelaria.", "Como recebes as encomendas?", "message-pastelaria");
  assert.equal(memory.summary, "Negócio: pastelaria");
});

test("explicit corrections replace stale facts and unrelated sensitive statements are not stored", () => {
  const previous = mergeConversationMemory(
    null,
    "Trabalho com formação de inglês.",
    "Como posso ajudar?",
    "message-1"
  );
  const corrected = mergeConversationMemory(
    previous,
    "Na verdade, trabalho com formação de francês.",
    "Percebo.",
    "message-2"
  );
  assert.equal(corrected.facts.filter((fact) => fact.category === "business_type").length, 1);
  assert.ok(corrected.summary.includes("formação de francês"));
  assert.ok(!corrected.summary.includes("formação de inglês"));

  const unrelated = mergeConversationMemory(null, "Tenho uma doença crónica.", "Entendo.", "message-3");
  assert.equal(unrelated.facts.length, 0);
  assert.equal(unrelated.summary, "");
});

test("memory storage migration enforces tenant ownership and service-only access", async () => {
  const sql = await read("supabase/migrations/20261125160000_ai_conversation_memory.sql");
  assert.match(sql, /foreign key \(conversation_id, organization_id\)/i);
  assert.match(sql, /references public\.conversations\(id, organization_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.ai_conversation_memory from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.ai_conversation_memory to service_role/i);
});

test("queue serialization preserves retry-exhaustion cleanup and tenant boundaries", async () => {
  const sql = await read("supabase/migrations/20261125150000_serialize_ai_generation_per_conversation.sql");
  assert.match(sql, /status='failed'/);
  assert.match(sql, /lease_expired_max_attempts/);
  assert.match(sql, /prior\.organization_id=j\.organization_id/);
  assert.match(sql, /prior\.whatsapp_number_id=j\.whatsapp_number_id/);
  assert.match(sql, /prior\.conversation_id=j\.conversation_id/);
  assert.match(sql, /for update of j skip locked/i);
});
