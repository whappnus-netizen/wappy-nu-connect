import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=(path)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("AI provider is self-hosted Ollama only",async()=>{
 const router=await read("src/provider-router.ts");
 const config=await read("src/config.ts");
 assert.match(router,/AI_OLLAMA_BASE_URL/);
 assert.match(router,/provider:"ollama"/);
 assert.match(router,/\/api\/chat/);
 assert.match(router,/num_thread:config\.AI_OLLAMA_NUM_THREADS/);
 assert.doesNotMatch(router,/createCloudProvider|new Gemini|new Compatible|new Anthropic/);
 assert.match(config,/AI_PROVIDER:z\.literal\("ollama"\)/);
 assert.match(config,/AI_OLLAMA_API_KEY:z\.string\(\)\.min\(32\)/);
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

test("health endpoint exposes Ollama readiness",async()=>{
 const server=await read("src/server.ts");
 const router=await read("src/provider-router.ts");
 assert.match(server,/app.get\("\/live"/);
 assert.match(server,/getOllamaHealth/);
 assert.match(router,/\/health/);
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
 assert.match(orchestrator,/if\(!input\.testMode\) await consumeCredit/);
});

test("native worker can be held inactive during blue/green validation",async()=>{
 const config=await read("src/config.ts");
 const server=await read("src/server.ts");
 assert.match(config,/AI_WORKER_ENABLED:z\.enum\(\["true","false"\]\)/);
 assert.match(server,/if\(config\.AI_WORKER_ENABLED\)startGenerationWorker\(\)/);
});
test("Ollama concurrency semaphore transfers slots without a race",async()=>{
 const router=await read("src/provider-router.ts");
 assert.match(router,/if\(active<1\)/);
 assert.match(router,/if\(next\)\{next\(\);return;\}/);
 assert.doesNotMatch(router,/active\+\+;\s*return\s*\(\)=>release\(\);\s*\}\s*active\+\+/);
});
