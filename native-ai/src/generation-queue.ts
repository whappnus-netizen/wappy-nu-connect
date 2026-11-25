import {randomUUID} from "node:crypto";
import {supabase} from "./db.js";
import {generateReply} from "./orchestrator.js";
import type {GenerateRequest,GeneratedResponse} from "./types.js";

type JobRow={id:string;idempotency_key:string;request_payload:GenerateRequest;attempt_count:number;max_attempts:number};
const workerId="native-ai-worker-"+randomUUID();
let workerBusy=false;

function retryable(error:unknown):boolean{
 const m=error instanceof Error?error.message:String(error);
 return /Ollama HTTP (408|425|429|5\d\d)\b|OLLAMA_CIRCUIT_OPEN|OLLAMA_HALF_OPEN_BUSY|timeout|AbortError|ECONN|fetch failed|socket|network/i.test(m);
}

export async function enqueueGeneration(input:GenerateRequest):Promise<string>{
 const key=input.messageId
  ? "whatsapp:"+input.organizationId+":"+input.whatsappNumberId+":"+input.messageId
  : "request:"+randomUUID();

 // The webhook can reach the engine with a stale or not-yet-created conversation
 // reference. Keep the original ID in request_payload for generation context, but
 // only attach a relational FK when the row exists in this tenant and number.
 let conversationId:string|null=null;
 if(input.conversationId){
  const {data,error}=await supabase.from("conversations")
   .select("id")
   .eq("id",input.conversationId)
   .eq("organization_id",input.organizationId)
   .eq("whatsapp_number_id",input.whatsappNumberId)
   .maybeSingle();
  if(error)throw new Error("AI_QUEUE_CONVERSATION_LOOKUP_FAILED: "+error.message);
  conversationId=data?.id??null;
 }

 const {error:insertError}=await supabase.from("ai_generation_jobs").upsert({
  idempotency_key:key,
  organization_id:input.organizationId,
  whatsapp_number_id:input.whatsappNumberId,
  conversation_id:conversationId,
  message_id:input.messageId??null,
  request_payload:input,
  status:"queued",
  available_at:new Date().toISOString()
 },{onConflict:"idempotency_key",ignoreDuplicates:true});
 if(insertError)throw new Error("AI_QUEUE_ENQUEUE_FAILED: "+insertError.message);
 const {data,error}=await supabase.from("ai_generation_jobs").select("id").eq("idempotency_key",key).single();
 if(error||!data?.id)throw new Error("AI_QUEUE_LOOKUP_FAILED");
 return String(data.id);
}

async function processOne():Promise<void>{
 const {data,error}=await supabase.rpc("claim_ai_generation_job",{_worker_id:workerId,_lease_seconds:120});
 if(error)throw new Error("AI_QUEUE_CLAIM_FAILED: "+error.message);
 const job=(Array.isArray(data)?data[0]:data) as JobRow|null;
 if(!job?.id)return;
 try{
  const result=await generateReply(job.request_payload);
  const {error:finishError}=await supabase.rpc("finish_ai_generation_job",{
   _job_id:job.id,_worker_id:workerId,_status:"succeeded",_result:result,_error_code:null
  });
  if(finishError)throw new Error("AI_QUEUE_FINISH_FAILED: "+finishError.message);
 }catch(error){
  const message=error instanceof Error?error.message:"AI_GENERATION_FAILED";
  const status=retryable(error)?"queued":"failed";
  const {error:finishError}=await supabase.rpc("finish_ai_generation_job",{
   _job_id:job.id,_worker_id:workerId,_status:status,_result:null,_error_code:message
  });
  if(finishError)console.error(JSON.stringify({event:"ai_queue_finish_error",jobId:job.id,error:finishError.message}));
  console.error(JSON.stringify({event:"ai_job_failed",jobId:job.id,attempt:job.attempt_count,error:message,retry:status==="queued"}));
 }
}

export function startGenerationWorker():void{
 const poll=async()=>{
  if(workerBusy)return;
  workerBusy=true;
  try{await processOne();}
  catch(error){console.error(JSON.stringify({event:"ai_queue_worker_error",error:error instanceof Error?error.message:String(error)}));}
  finally{workerBusy=false;}
 };
 const timer=setInterval(()=>{void poll();},500);
 timer.unref();
 void poll();
}

export async function waitForGeneration(jobId:string,timeoutMs=15000):Promise<
 {status:"succeeded";result:GeneratedResponse}|{status:"failed";error:string}|{status:"pending"}
>{
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  const {data,error}=await supabase.from("ai_generation_jobs")
   .select("status,result_payload,error_code")
   .eq("id",jobId).maybeSingle();
  if(error)throw new Error("AI_QUEUE_STATUS_FAILED: "+error.message);
  if(data?.status==="succeeded"&&data.result_payload)return {status:"succeeded",result:data.result_payload as GeneratedResponse};
  if(data?.status==="failed")return {status:"failed",error:String(data.error_code??"AI_GENERATION_FAILED")};
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return {status:"pending"};
}
