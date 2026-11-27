import {createHmac,randomUUID} from "node:crypto";
import {config} from "./config.js";
import type {AIProvider,ProviderResponse} from "./providers.js";
import type {ChatMessage,MediaAttachment} from "./types.js";

function orchestratorEndpoint():string {
 if(!config.ORCHESTRATOR_URL||!config.ORCHESTRATOR_API_KEY||!config.TENANT_SIGNING_SECRET){
  throw new Error("ORCHESTRATOR_CONFIGURATION_MISSING");
 }
 const url=new URL(config.ORCHESTRATOR_URL);
 if(url.protocol!=="https:"&&url.hostname!=="localhost"&&url.hostname!=="127.0.0.1"){
  throw new Error("ORCHESTRATOR_HTTPS_REQUIRED");
 }
 url.pathname=url.pathname.replace(/\/$/,"")+"/v1/chat/completions";
 url.search="";
 url.hash="";
 return url.toString();
}

function signedTenantHeaders(organizationId:string):Record<string,string>{
 if(!organizationId.trim())throw new Error("ORCHESTRATOR_TENANT_REQUIRED");
 const timestamp=Math.floor(Date.now()/1000).toString();
 const nonce=randomUUID();
 const canonical=organizationId+":"+timestamp+":"+nonce;
 const signature=createHmac("sha256",config.TENANT_SIGNING_SECRET!).update(canonical).digest("hex");
 return {"X-Tenant-Timestamp":timestamp,"X-Tenant-Nonce":nonce,"X-Tenant-Signature":signature};
}

function providerFromModel(model:string):"gemini"|"openai"|"anthropic"|undefined{
 if(model.startsWith("gemini-"))return "gemini";
 if(model.startsWith("gpt-"))return "openai";
 if(model.startsWith("claude-"))return "anthropic";
 return undefined;
}

function toOrchestratorMessages(messages:ChatMessage[],attachments:MediaAttachment[]):{messages:Array<Record<string,unknown>>;systemInstructions:string}{
 const systemInstructions=messages.filter(m=>m.role==="system").map(m=>m.content).filter(Boolean).join("\n\n");
 const turns:Array<Record<string,unknown>>=messages.filter(m=>m.role!=="system").map(m=>({role:m.role,content:m.content}));
 if(attachments.length){
  if(attachments.some(a=>a.type==="video"))throw new Error("ORCHESTRATOR_UNSUPPORTED_ATTACHMENT_TYPE");
  const index=turns.map(m=>m["role"]).lastIndexOf("user");
  if(index<0)throw new Error("ORCHESTRATOR_ATTACHMENT_WITHOUT_USER_TURN");
  const current=turns[index]??{};
  const content=typeof current["content"]==="string"?[{type:"text",text:current["content"]}]
   :Array.isArray(current["content"])?current["content"] as Array<Record<string,unknown>>:[];
  turns[index]={...current,content:[...content,...attachments.map(a=>({type:a.type,mime_type:a.mimeType,data:a.data}))]};
 }
 return {messages:turns,systemInstructions};
}

export function createProvider(organizationId:string):AIProvider{
 return {
  async generate(messages:ChatMessage[],options:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]):Promise<ProviderResponse>{
   const endpoint=orchestratorEndpoint();
   const converted=toOrchestratorMessages(messages,attachments);
   const preferredProvider=providerFromModel(options.model);
   const response=await fetch(endpoint,{
    method:"POST",
    headers:{"content-type":"application/json","X-Orchestrator-Key":config.ORCHESTRATOR_API_KEY!,...signedTenantHeaders(organizationId)},
    body:JSON.stringify({
     request_id:randomUUID(),
     organization_id:organizationId,
     task_type:"customer_support",
     messages:converted.messages,
     system_instructions:converted.systemInstructions||null,
     ...(preferredProvider?{preferred_provider:preferredProvider,preferred_model:options.model}:{}),
     temperature:Math.max(0,Math.min(2,options.temperature)),
     max_tokens:Math.max(1,Math.min(16384,Math.floor(options.maxTokens))),
     metadata:{source:"whappnus-native-ai"}
    }),
    signal:AbortSignal.timeout(config.ORCHESTRATOR_TIMEOUT_MS)
   });
   const raw=await response.text();
   let data:Record<string,unknown>={};
   try{data=JSON.parse(raw) as Record<string,unknown>;}catch{}
   if(!response.ok){
    const detail=data["detail"]&&typeof data["detail"]==="object"?data["detail"] as Record<string,unknown>:{};
    const code=typeof detail["code"]==="string"?detail["code"]:"ORCHESTRATOR_REQUEST_FAILED";
    const error=new Error(code+" (HTTP "+response.status+")") as Error&{retryable?:boolean};
    if(typeof detail["retryable"]==="boolean")error.retryable=detail["retryable"];
    else error.retryable=response.status===408||response.status===425||response.status===429||response.status>=500;
    throw error;
   }
   const text=typeof data["content"]==="string"?data["content"].trim():"";
   if(!text){const error=new Error("ORCHESTRATOR_EMPTY_COMPLETION") as Error&{retryable?:boolean};error.retryable=true;throw error;}
   const provider=typeof data["provider"]==="string"?data["provider"]:"whappnus-ai-orchestrator";
   const model=typeof data["model"]==="string"?data["model"]:"configured-model";
   console.info(JSON.stringify({event:"ai_provider_selected",provider,model,organizationId}));
   return {text,provider,model};
  }
 };
}

export async function getProviderHealth():Promise<{ok:boolean;provider:string;model:string;status:string}>{
 if(!config.ORCHESTRATOR_URL||!config.ORCHESTRATOR_API_KEY||!config.TENANT_SIGNING_SECRET){
  return {ok:false,provider:"whappnus-ai-orchestrator",model:"configured",status:"not_configured"};
 }
 try{
  const base=new URL(config.ORCHESTRATOR_URL);base.pathname="/ready";base.search="";base.hash="";
  const response=await fetch(base,{signal:AbortSignal.timeout(5000)});
  const raw=await response.text();let data:{status?:string}={};try{data=JSON.parse(raw) as typeof data;}catch{}
  const ok=response.ok&&data.status==="ready";
  return {ok,provider:"whappnus-ai-orchestrator",model:"configured",status:ok?"ready":"unavailable"};
 }catch{return {ok:false,provider:"whappnus-ai-orchestrator",model:"configured",status:"unreachable"};}
}
