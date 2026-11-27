import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=(path)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("frontend AI adapter uses authenticated Orchestrator requests with tenant HMAC",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/WHAPPNUS_ORCHESTRATOR_URL/);
 assert.match(adapter,/WHAPPNUS_ORCHESTRATOR_API_KEY/);
 assert.match(adapter,/process\.env\["ORCHESTRATOR_API_KEY"\]/);
 assert.match(adapter,/WHAPPNUS_TENANT_SIGNING_SECRET/);
 assert.match(adapter,/process\.env\["TENANT_SIGNING_SECRET"\]/);
 assert.match(adapter,/\/v1\/chat\/completions/);
 assert.match(adapter,/"X-Orchestrator-Key"/);
 assert.match(adapter,/createHmac\("sha256", secret\)/);
 assert.match(adapter,/X-Tenant-Timestamp/);
 assert.match(adapter,/X-Tenant-Nonce/);
 assert.match(adapter,/X-Tenant-Signature/);
 assert.doesNotMatch(adapter,/WHAPPNUS_ROUTER_URL|WHAPPNUS_ROUTER_API_KEY|NATIVE_AI_ENGINE_URL|AI_OLLAMA_BASE_URL/);
});
test("backend normalizes legacy Gemini agent models without changing tenant records",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/model\.startsWith\("google\/"\)/);
 assert.match(adapter,/gemini-2\.5-flash/);
 assert.match(adapter,/return "gemini-3\.8-flash"/);
 assert.match(adapter,/return "gemini-3\.1-pro-preview"/);
});

test("AI-created WhatsApp bookings are labelled correctly in the calendar",async()=>{
 const agenda=await read("../src/routes/_authenticated/agendamentos.tsx");
 assert.match(agenda,/\["ai","whatsapp_ai"\]\.includes\(booking\.source\)/);
});

test("main backend executes tenant-scoped booking tools with server-side permissions",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const tools=await read("../src/lib/ai-booking-tools.server.ts");
 assert.match(adapter,/loadBookingRuntime/);
 assert.match(adapter,/buildBookingInstructions/);
 assert.match(adapter,/parseBookingAction/);
 assert.match(adapter,/executeBookingAction/);
 assert.match(adapter,/WHAPPNUS_BOOKING_ACTION/);
 assert.match(tools,/create_booking_v2/);
 assert.match(tools,/update_booking_status_v1/);
 assert.match(tools,/reschedule_booking_v1/);
 assert.match(tools,/expire_pending_bookings_v1/);
 assert.match(tools,/p_idempotency_key/);
 assert.match(tools,/eq\("organization_id",ctx\.organizationId\)/);
 assert.match(tools,/eq\("contact_id",ctx\.contactId\)/);
});

test("default Gemini Flash agents leave complex model tier selection to Orchestrator",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/configuredModel === "gemini-3\.8-flash" \? null : configuredModel/);
 assert.match(adapter,/taskType = isAdvancedTask/);
 assert.match(adapter,/preferredProvider/);
});

test("agent media toggles are enforced before sending attachments to providers",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/mediaUnderstandingEnabled/);
 assert.match(adapter,/config\["imageUnderstanding"\] !== false/);
 assert.match(adapter,/config\["audioUnderstanding"\] !== false/);
});

test("conversation history excludes the current WhatsApp provider message id",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 assert.match(adapter,/row\.wa_message_id === currentWaMessageId/);
 assert.match(pipeline,/messageId: incoming\.waMessageId/);
});

test("payment proof inference is credit-gated and limited to payment-related messages",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 assert.match(adapter,/await consumeAiConversation\(request\)/);
 assert.match(pipeline,/hasRecentPaymentContext\(number\.organization_id/);
});

test("video MP4 is not misclassified as an audio attachment",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/messageType === "video"/);
 assert.doesNotMatch(adapter,/mp4: "audio\/mp4"/);
 assert.match(adapter,/m4a: "audio\/mp4"/);
});

test("direct backend adapter validates and forwards image audio and PDF attachments",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 assert.match(adapter,/loadIncomingAttachment/);
 assert.match(adapter,/capabilities_required:/);
 assert.match(adapter,/AI_MEDIA_SIZE_INVALID/);
 assert.ok(adapter.includes('"image/jpeg"'));
 assert.ok(adapter.includes('"audio/ogg"'));
 assert.ok(adapter.includes('"application/pdf"'));
 assert.match(adapter,/Buffer\.from\(await blob\.arrayBuffer\(\)\)/);
});

test("native AI provider adapter signs tenant requests and uses only the independent Orchestrator",async()=>{
 const router=await read("src/provider-router.ts");
 const config=await read("src/config.ts");
 const orchestrator=await read("src/orchestrator.ts");
 assert.match(router,/createHmac\("sha256"/);
 assert.match(router,/X-Tenant-Timestamp/);
 assert.match(router,/X-Tenant-Nonce/);
 assert.match(router,/X-Tenant-Signature/);
 assert.match(router,/X-Orchestrator-Key/);
 assert.match(router,/organization_id:organizationId/);
 assert.match(orchestrator,/createProvider\(input.organizationId\)/);
 assert.match(config,/ORCHESTRATOR_URL/);
 assert.doesNotMatch(router,/ollama|intelligenceRouterGenerate|AI_OLLAMA|AI_ROUTER/i);
 assert.doesNotMatch(config,/AI_OLLAMA|AI_ROUTER|AI_PROVIDER/);
});

test("backend retains tenant context, idempotent conversation billing and human-reviewed receipts",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const pipeline=await read("../src/lib/whatsapp/pipeline.server.ts");
 assert.match(adapter,/loadTenantContext/);
 assert.match(adapter,/loadConversationHistory/);
 assert.match(adapter,/buildTenantSystemPrompt/);
 assert.match(adapter,/consume_ai_conversation/);
 assert.match(adapter,/isPaymentProof: boolean/);
 assert.match(adapter,/reference: cleanText\(parsed/);
 assert.match(adapter,/beneficiaryName: cleanText\(parsed/);
 assert.match(adapter,/HUMAN_HANDOFF_STATE_UPDATE_FAILED/);
 assert.match(pipeline,/amount_aoa: analysis\.originalCurrency === "AOA" \? analysis\.amount : null/);
 assert.match(pipeline,/status: "pending_review"/);
 assert.match(pipeline,/originalAmount: analysis\.amount/);
 assert.match(pipeline,/requireActiveSubscription/);
 assert.match(pipeline,/analyzePaymentProofViaWhappNusAI/);
 assert.doesNotMatch(adapter,/WHAPPNUS_NATIVE_AI_URL|WHAPPNUS_NATIVE_AI_SECRET|WHAPPNUS_ROUTER_URL/);
});

test("generation endpoint uses durable queue and idempotency",async()=>{
 const server=await read("src/server.ts");
 const queue=await read("src/generation-queue.ts");
 assert.match(server,/enqueueGeneration\(input\)/);
 assert.match(server,/waitForGeneration\(jobId/);
 assert.match(queue,/idempotency_key/);
 assert.match(queue,/claim_ai_generation_job/);
 assert.match(queue,/finish_ai_generation_job/);
 assert.match(queue,/ORCHESTRATOR/);
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

test("Orchestrator integration uses configured endpoint and signed tenant readiness contract",async()=>{
 const adapter=await read("../src/lib/ai-engine.server.ts");
 const docs=await read("../docs/WHAPPNUS_AI_ORCHESTRATOR_INTEGRATION.md");
 assert.match(adapter,/WHAPPNUS_ORCHESTRATOR_URL/);
 assert.match(adapter,/WHAPPNUS_ORCHESTRATOR_API_KEY/);
 assert.match(adapter,/WHAPPNUS_TENANT_SIGNING_SECRET/);
 assert.match(adapter,/WHAPPNUS_ORCHESTRATOR_HTTPS_REQUIRED/);
 assert.match(adapter,/X-Tenant-Signature/);
 assert.match(docs,/\/ready/);
 assert.match(docs,/WHAPPNUS_ORCHESTRATOR_API_KEY/);
 assert.match(docs,/WHAPPNUS_TENANT_SIGNING_SECRET/);
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

test("Netlify scheduled worker invokes the authenticated Orchestrator queue processor",async()=>{
 const worker=await read("../netlify/functions/ai-generation-worker.mts");
 const route=await read("../src/routes/api/public/ai.generation-complete.ts");
 assert.match(worker,/WHAPPNUS_AI_WORKER_SECRET/);
 assert.match(worker,/\* \* \* \* \*/);
 assert.match(route,/WHAPPNUS_AI_WORKER_SECRET/);
 assert.match(route,/safeEqual\(bearer, secret\)/);
 assert.match(route,/claim_ai_generation_job/);
 assert.match(route,/generateViaWhappNusAI/);
 assert.match(route,/claim_ai_generation_delivery/);
});

test("optional native AI runtime adapter delegates inference to the signed external Orchestrator",async()=>{
 const router=await read("src/provider-router.ts");
 assert.match(router,/createHmac\("sha256"/);
 assert.match(router,/X-Orchestrator-Key/);
 assert.match(router,/X-Tenant-Timestamp/);
 assert.match(router,/X-Tenant-Nonce/);
 assert.match(router,/X-Tenant-Signature/);
 assert.match(router,/\/v1\/chat\/completions/);
 assert.doesNotMatch(router,/ollama|intelligenceRouterGenerate|AI_OLLAMA|AI_ROUTER/i);
});

test("expired generation leases at the retry limit become terminal failures",async()=>{
 const sql=await read("supabase/migrations/20261125073000_fail_expired_ai_leases_after_max_attempts.sql");
 assert.match(sql,/status='processing'/);
 assert.match(sql,/attempt_count >= max_attempts/);
 assert.match(sql,/status='failed'/);
 assert.match(sql,/lease_expired_max_attempts/);
});

test("slow WhatsApp generations are queued for authenticated Orchestrator-backed result delivery",async()=>{
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
 assert.match(worker,/WHAPPNUS_AI_WORKER_SECRET/);
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
 assert.match(route,/WHAPPNUS_AI_WORKER_SECRET/);
 assert.match(route,/safeEqual\(bearer, secret\)/);
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
