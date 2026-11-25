import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMessages } from "../src/prompt.ts";
import { evaluateResponse, shouldRegenerate } from "../src/evaluation.ts";

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

test("queue serialization preserves retry-exhaustion cleanup and tenant boundaries", async () => {
  const sql = await read("supabase/migrations/20261125150000_serialize_ai_generation_per_conversation.sql");
  assert.match(sql, /status='failed'/);
  assert.match(sql, /lease_expired_max_attempts/);
  assert.match(sql, /prior\.organization_id=j\.organization_id/);
  assert.match(sql, /prior\.whatsapp_number_id=j\.whatsapp_number_id/);
  assert.match(sql, /prior\.conversation_id=j\.conversation_id/);
  assert.match(sql, /for update of j skip locked/i);
});
