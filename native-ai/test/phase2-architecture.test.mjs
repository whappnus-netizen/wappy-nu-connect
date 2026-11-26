import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=(path)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("frontend AI adapter uses the authenticated WHAPPNUS Intelligence Router",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/WHAPPNUS_ROUTER_URL/);
 assert.match(adapter,/WHAPPNUS_ROUTER_API_KEY/);
 assert.match(adapter,/\/v1\/chat\/completions/);
 assert.match(adapter,/authorization:\s*"Bearer "\s*\+/);
 assert.match(adapter,/whappnus-intelligence-router/);
 assert.doesNotMatch(adapter,/NATIVE_AI_ENGINE_URL|AI_OLLAMA_BASE_URL/);
});

test("generation endpoint uses durable queue and idempotency",async()=>{
 const server=await read("src/server.ts");
 const queue=await read("src/generation-queue.ts");
 assert.match(server,/enqueueGeneration\(input\)/);
 assert.match(server,/waitForGeneration\(jobId/);
 assert.match(queue,/idempotency_key/);
 assert.match(queue,/claim_ai_generation_job/);
 assert.match(queue,/finish_ai_generation_job/);
 assert.match(queue,/OLLAMA_CIRCUIT_OPEN/);
});

test("queue safely detaches stale or cross-tenant conversation references",async()=>{
 const queue=await read("src/generation-queue.ts");
 assert.match(queue,/\.eq\("organization_id",input\.organizationId\)/);
 assert.match(queue,/\.eq\("whatsapp_number_id",input\.whatsappNumberId\)/);
 assert.match(queue,/conversation_id:conversationId/);
 assert.match(queue,/conversationId=data\?\.id\?\?null/);
});

test("queue migration protects tenants and uses SKIP LOCKED",async()=>{
 const sql=await read("supabase/migrations/20261124220000_ai_generation_durable_queue.sql");
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/for update skip locked/i);
 assert.match(sql,/unique/i);
 assert.match(sql,/service_role/i);
});

test("Router integration uses configured server endpoint and secure readiness contract",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const docs=await read("../docs/WHAPPNUS_ROUTER_INTEGRATION.md");
 assert.match(adapter,/WHAPPNUS_ROUTER_URL/);
 assert.match(adapter,/WHAPPNUS_ROUTER_API_KEY/);
 assert.match(adapter,/WHAPPNUS_ROUTER_HTTPS_REQUIRED/);
 assert.match(docs,/\/ready/);
 assert.match(docs,/WHAPPNUS_ROUTER_API_KEY/);
});

test("conversation history is tenant-scoped and excludes the current inbound message",async()=>{
 const db=await read("src/db.ts");
 const orchestrator=await read("src/orchestrator.ts");
 assert.match(db,/\.eq\("organization_id",organizationId\)/);
 assert.match(db,/\.eq\("conversation_id",conversationId\)/);
 assert.match(db,/\.neq\("wa_message_id",excludeWaMessageId\)/);
 assert.match(orchestrator,/getHistory\(input\.conversationId,input\.organizationId,typeof input\.messageId==="string"\?input\.messageId:null\)/);
});

test("internal playground uses the same central generator without queue billing",async()=>{
 const server=await read("src/server.ts");
 const orchestrator=await read("src/orchestrator.ts");
 assert.match(server,/if\(input\.testMode\)/);
 assert.match(server,/generateReply\(input\)/);
 assert.match(orchestrator,/if\s*\(\s*!input\.testMode\s*\)\s*await\s+consumeCredit/);
});

test("Netlify scheduled worker calls the authenticated Router-backed queue processor",async()=>{
 const worker=await read("../netlify/functions/ai-generation-worker.mts");
 const route=await read("../src/routes/api/public/ai.generation-complete.ts");
 assert.match(worker,/WHAPPNUS_ROUTER_API_KEY/);
 assert.match(worker,/\* \* \* \* \*/);
 assert.match(route,/WHAPPNUS_ROUTER_API_KEY/);
 assert.match(route,/claim_ai_generation_job/);
});
test("Ollama concurrency semaphore transfers slots without a race",async()=>{
 const router=await read("src/provider-router.ts");
 assert.match(router,/if\(active<1\)/);
 assert.match(router,/if\(next\)\{next\(\);return;\}/);
 assert.doesNotMatch(router,/active\+\+;\s*return\s*\(\)=>release\(\);\s*\}\s*active\+\+/);
});

test("expired generation leases at the retry limit become terminal failures",async()=>{
 const sql=await read("supabase/migrations/20261125073000_fail_expired_ai_leases_after_max_attempts.sql");
 assert.match(sql,/status='processing'/);
 assert.match(sql,/attempt_count >= max_attempts/);
 assert.match(sql,/status='failed'/);
 assert.match(sql,/lease_expired_max_attempts/);
});

test("slow WhatsApp generations are queued for authenticated Router-backed result delivery",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const route=await read("../src/routes/api/public/ai.generation-complete.ts");
 const worker=await read("../netlify/functions/ai-generation-worker.mts");
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 assert.match(adapter,/enqueueGenerationForRetry/);
 assert.match(adapter,/idempotencyKey/);
 assert.match(route,/safeEqual\(bearer, secret\)/);
 assert.match(route,/claim_ai_generation_job/);
 assert.match(route,/claim_ai_generation_delivery/);
 assert.match(route,/deliverAiGenerationJob\(deliveryJob\.id\)/);
 assert.match(worker,/WHAPPNUS_ROUTER_API_KEY/);
 assert.match(pipeline,/aiGenerationJobId/);
 assert.match(pipeline,/export async function deliverAiGenerationJob/);
});
test("AI delivery outbox is durable and unique per generation job",async()=>{
 const sql=await read("supabase/migrations/20261125080000_ai_generation_delivery_outbox.sql");
 assert.match(sql,/delivery_status/);
 assert.match(sql,/claim_ai_generation_delivery/);
 assert.match(sql,/finish_ai_generation_delivery/);
 assert.match(sql,/messages_ai_generation_job_id_unique/);
 assert.match(sql,/for update skip locked/i);
});

test("slow-job delivery respects live human takeover and avoids duplicate sends",async()=>{
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 const route=await read("../src/routes/api/public/ai.generation-complete.ts");
 assert.match(pipeline,/conversation\.status !== "open"/);
 assert.match(pipeline,/!conversation\.ai_enabled/);
 assert.match(pipeline,/requireActiveSubscription/);
 assert.match(pipeline,/ai_generation_job_id/);
 assert.match(pipeline,/AI_DELIVERY_UNCERTAIN/);
 assert.match(route,/WHAPPNUS_ROUTER_API_KEY/);
 assert.doesNotMatch(route,/organizationId\s*:/);
});
test("pending native generation does not send a premature fallback",async()=>{
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 assert.match(pipeline,/errorCode === "generation_pending_retry"/);
 assert.match(pipeline,/generation_pending_delivery_queued/);
});


test("agent identity and configured instructions outrank the internal agent label",async()=>{
 const prompt=await read("src/prompt.ts");
 const orchestrator=await read("src/orchestrator.ts");
 assert.ok(prompt.includes("FONTE OFICIAL DA IDENTIDADE"));
 assert.ok(prompt.includes("function isIdentityQuestion"));
 assert.ok(prompt.includes("export function configuredIdentityReply"));
 assert.ok(orchestrator.includes("configuredIdentityReply(a,messageText)"));
 assert.ok(orchestrator.includes('provider:"configured_agent_instruction"'));
});

test("conversation prompt preserves dialogue history and protects current-turn relevance",async()=>{
 const prompt=await read("src/prompt.ts");
 assert.ok(prompt.includes("Preserve chronological dialogue"));
 assert.ok(prompt.includes("history.slice(-16)"));
 assert.ok(prompt.includes("messages.push(...recent.slice(-12))"));
 assert.ok(prompt.includes('messages.push({ role: "user", content: text })'));
 assert.ok(prompt.includes("Não reinicies a conversa nem repitas a saudação"));
});

test("generation queue serializes jobs for the same conversation across workers",async()=>{
 const sql=await read("supabase/migrations/20261125150000_serialize_ai_generation_per_conversation.sql");
 assert.match(sql,/prior\.conversation_id=j\.conversation_id/);
 assert.match(sql,/prior\.status in \('queued','processing'\)/);
 assert.match(sql,/for update of j skip locked/i);
 assert.match(sql,/organization_id=j\.organization_id/);
 assert.match(sql,/whatsapp_number_id=j\.whatsapp_number_id/);
});
