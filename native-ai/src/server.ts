import express from "express";
import {config} from "./config.js";
import {generateReply} from "./orchestrator.js";
import {analyzePaymentProof} from "./payment-proof.js";
import {createProvider,getOllamaHealth} from "./provider-router.js";
import {supabase,writeAiLog} from "./db.js";
import {allow} from "./rate-limit.js";
import {enqueueGeneration,startGenerationWorker,waitForGeneration} from "./generation-queue.js";
import type {GenerateRequest} from "./types.js";

const app=express();app.disable("x-powered-by");app.use(express.json({limit:"256kb"}));
app.get("/live",(_req,res)=>res.status(200).json({ok:true,service:"whappnus-native-ai-engine"}));
app.get("/health",async(_req,res)=>{
 const ollama=await getOllamaHealth();
 return res.status(ollama.ok?200:503).json({ok:ollama.ok,service:"whappnus-native-ai-engine",provider:"ollama",model:ollama.model,ollamaStatus:ollama.status,queue:"supabase"});
});

// Expire trials/subscriptions even when no new WhatsApp messages arrive.
async function syncExpiredSubscriptions(){
 try {
  const result=await supabase.rpc("suspend_expired_subscriptions");
  if(result.error) console.error("subscription expiry sync failed:",result.error.message);
 } catch(e) {
  console.error("subscription expiry sync failed:",e instanceof Error?e.message:"unknown");
 }
}
void syncExpiredSubscriptions();
const expiryTimer=setInterval(()=>{void syncExpiredSubscriptions();},60_000);
expiryTimer.unref();
startGenerationWorker();

function authorized(req:express.Request){return req.header("authorization")==="Bearer "+config.AI_INTERNAL_SECRET;}

app.post("/v1/generate",async(req,res)=>{
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const b=req.body as Partial<GenerateRequest>;
 if(!b.organizationId||!b.whatsappNumberId||typeof b.text!=="string"||!b.text.trim())return res.status(400).json({ok:false,error:"organizationId, whatsappNumberId and text are required"});
 const key=String(b.organizationId)+":"+String(b.fromWaId??"unknown");
 if(!allow(key,config.AI_RATE_LIMIT_PER_MINUTE))return res.status(429).json({ok:false,error:"rate_limited"});
 try{
  const input={...b,text:b.text.trim()} as GenerateRequest;
  const jobId=await enqueueGeneration(input);
  const outcome=await waitForGeneration(jobId,config.AI_QUEUE_WAIT_MS);
  if(outcome.status==="succeeded")return res.json({ok:true,...outcome.result});
  if(outcome.status==="pending")return res.status(503).json({ok:false,error:"generation_pending_retry",jobId});
  const m=outcome.error;
  if(m==="AUTO_REPLY_DISABLED"||m==="NO_ACTIVE_AGENT")return res.status(409).json({ok:false,error:m});
  if(["SUBSCRIPTION_REQUIRED","ACCOUNT_SUSPENDED","AI_CONVERSATIONS_EXHAUSTED","PLAN_HAS_NO_AI_CONVERSATIONS"].includes(m))return res.status(402).json({ok:false,error:m});
  await writeAiLog({organization_id:input.organizationId,conversation_id:input.conversationId??null,message_id:typeof input.messageId==="string"&&/^[0-9a-fA-F-]{36}$/.test(input.messageId)?input.messageId:null,event_type:"generation",status:"failed",metadata:{error:m.slice(0,500),messageType:input.messageType??"text",jobId}});
  return res.status(500).json({ok:false,error:"ai_generation_failed"});
 }catch(e){
  const m=e instanceof Error?e.message:"unknown";
  console.error(JSON.stringify({event:"ai_generation_request_failed",organizationId:b.organizationId,conversationId:b.conversationId??null,messageId:b.messageId??null,error:m}));
  return res.status(503).json({ok:false,error:"ai_queue_unavailable"});
 }
});

app.post("/v1/payment-proof/analyze",async(req,res)=>{
 if(!authorized(req))return res.status(401).json({ok:false,error:"unauthorized"});
 const b=req.body as {
  organizationId?:string;whatsappNumberId?:string;conversationId?:string;contactId?:string|null;
  mediaPath?:string;mediaMimeType?:string;messageType?:string;messageText?:string|null;
 };
 if(!b.organizationId||!b.whatsappNumberId||!b.conversationId||!b.mediaPath||!b.mediaMimeType||
  (b.messageType!=="image"&&b.messageType!=="document")){
  return res.status(400).json({ok:false,error:"payment_proof_fields_required"});
 }
 try{
  const result=await analyzePaymentProof({
   organizationId:b.organizationId,whatsappNumberId:b.whatsappNumberId,conversationId:b.conversationId,
   contactId:b.contactId??null,mediaPath:b.mediaPath,mediaMimeType:b.mediaMimeType,
   messageType:b.messageType,messageText:b.messageText??null
  });
  return res.json({ok:true,...result});
 }catch(e){
  const message=e instanceof Error?e.message:"payment_proof_analysis_failed";
  console.error("payment proof analysis:",message);
  return res.status(500).json({ok:false,error:"payment_proof_analysis_failed"});
 }
});

app.post("/v1/group-generate",async(req,res)=>{
 const sharedSecret=process.env.GROUP_AI_SHARED_SECRET;
 if(!authorized(req)&&(!sharedSecret||req.header("authorization")!=="Bearer "+sharedSecret))return res.status(401).json({ok:false,error:"unauthorized"});
 const b=req.body as {systemPrompt?:unknown;publicGroupRules?:unknown;privateDmRules?:unknown;prompt?:unknown};
 const systemPrompt=typeof b.systemPrompt==="string"?b.systemPrompt.trim():"";
 const publicGroupRules=typeof b.publicGroupRules==="string"?b.publicGroupRules.trim():"";
 const privateDmRules=typeof b.privateDmRules==="string"?b.privateDmRules.trim():"";
 const prompt=typeof b.prompt==="string"?b.prompt.trim():"";
 if(systemPrompt.length<20||!prompt||prompt.length>12000)return res.status(400).json({ok:false,error:"systemPrompt and prompt are required"});
 const system="És a IA de conteúdo do WhappNus Group Commander. Produz apenas a mensagem final, sem comentários sobre a tarefa.\n\nINSTRUÇÃO PRINCIPAL:\n"+systemPrompt+"\n\nREGRAS PARA GRUPOS:\n"+publicGroupRules+"\n\nREGRAS PARA CONVERSAS PRIVADAS (não as executar dentro do grupo):\n"+privateDmRules+"\n\nSegurança: não inventes preços, factos, provas ou promessas; não peças dados privados num grupo; não respondas a pessoas específicas como se fosse uma conversa privada; respeita a finalidade comercial e as regras de consentimento.";
 try {
  const result=await createProvider().generate([{role:"system",content:system},{role:"user",content:prompt}],{model:config.AI_MODEL,temperature:config.AI_TEMPERATURE,maxTokens:config.AI_MAX_OUTPUT_TOKENS});
  const text=String(result.text??"").trim();
  if(!text)return res.status(502).json({ok:false,error:"empty_generation"});
  return res.json({ok:true,text:text.slice(0,12000),provider:result.provider,model:result.model});
 } catch(e) {
  console.error("group generation:",e instanceof Error?e.message:"unknown");
  return res.status(503).json({ok:false,error:"group_generation_failed"});
 }
});
app.get("/v1/capabilities",(_req,res)=>res.json({ok:true,providers:["ollama"],capabilities:["intent-classification","agent-selection","prompt-orchestration","natural-conversation","sales-guidance","conversation-context","knowledge-ranking","training-examples","local-text-inference","local-image-understanding","provider-abstraction","durable-generation-queue","idempotent-generation","circuit-breaker","structured-ai-logs"]}));
app.listen(config.PORT,()=>console.log("WhappNus AI Engine listening on :"+config.PORT));
