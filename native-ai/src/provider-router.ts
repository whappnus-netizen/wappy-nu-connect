import {config} from "./config.js";
import type {AIProvider,ProviderResponse} from "./providers.js";
import type {ChatMessage,MediaAttachment} from "./types.js";

type Circuit={failures:number;openUntil:number;halfOpen:boolean};
const circuit:Circuit={failures:0,openUntil:0,halfOpen:false};
const threshold=2;
const cooldownMs=30_000;
let active=0;
const waiters:Array<()=>void>=[];

async function acquire():Promise<()=>void>{
 if(active===0){active++;return ()=>release();}
 await new Promise<void>(resolve=>waiters.push(resolve));
 active++;
 return ()=>release();
}
function release(){active=Math.max(0,active-1);const next=waiters.shift();if(next)next();}

function isTransient(error:unknown):boolean{
 const m=error instanceof Error?error.message:String(error);
 if(/HTTP (400|401|403|404)\b|model .*not found|unsupported/i.test(m))return false;
 return /HTTP (408|409|425|429|5\d\d)\b|timeout|abort|ECONN|fetch failed|socket|network/i.test(m);
}

async function ollamaGenerate(messages:ChatMessage[],options:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]):Promise<ProviderResponse>{
 if(circuit.openUntil>Date.now())throw new Error("OLLAMA_CIRCUIT_OPEN");
 if(circuit.openUntil>0&&circuit.halfOpen)throw new Error("OLLAMA_HALF_OPEN_BUSY");
 const halfOpen=circuit.openUntil>0;
 if(halfOpen)circuit.halfOpen=true;
 const unlock=await acquire();
 try{
  if(attachments.some(a=>a.type!=="image"))throw new Error("OLLAMA_UNSUPPORTED_ATTACHMENT_TYPE");
  const lastUser=messages.map(m=>m.role).lastIndexOf("user");
  const ollamaMessages=messages.map((m,index)=>index===lastUser&&attachments.length>0
   ? {...m,images:attachments.map(a=>a.data)}
   : m);
  const response=await fetch(config.AI_OLLAMA_BASE_URL.replace(/\/$/,"")+"/api/chat",{
   method:"POST",
   headers:{"content-type":"application/json",authorization:"Bearer "+config.AI_OLLAMA_API_KEY},
   body:JSON.stringify({
    model:config.AI_OLLAMA_MODEL,
    messages:ollamaMessages,
    stream:false,
    options:{
     temperature:options.temperature,
     num_predict:Math.min(options.maxTokens,4096),
     num_thread:config.AI_OLLAMA_NUM_THREADS,
     num_ctx:config.AI_OLLAMA_CONTEXT_LENGTH
    }
   }),
   signal:AbortSignal.timeout(config.AI_OLLAMA_TIMEOUT_MS)
  });
  const raw=await response.text();
  if(!response.ok)throw new Error("Ollama HTTP "+response.status+": "+raw.slice(0,240));
  const data=JSON.parse(raw) as {message?:{content?:unknown};model?:string};
  const text=typeof data.message?.content==="string"?data.message.content.trim():"";
  if(!text)throw new Error("OLLAMA_EMPTY_RESPONSE");
  circuit.failures=0;circuit.openUntil=0;
  return {text,provider:"ollama",model:data.model??config.AI_OLLAMA_MODEL};
 }catch(error){
  if(isTransient(error)){
   circuit.failures++;
   if(circuit.failures>=threshold)circuit.openUntil=Date.now()+cooldownMs;
  }
  throw error;
 }finally{
  unlock();
  if(halfOpen)circuit.halfOpen=false;
 }
}

class OllamaOnlyProvider implements AIProvider{
 async generate(messages:ChatMessage[],options:{model:string;temperature:number;maxTokens:number},attachments:MediaAttachment[]=[]):Promise<ProviderResponse>{
  const result=await ollamaGenerate(messages,options,attachments);
  console.info(JSON.stringify({event:"ai_provider_selected",provider:"ollama",model:result.model}));
  return result;
 }
}
export function createProvider():AIProvider{return new OllamaOnlyProvider();}

export async function getOllamaHealth():Promise<{ok:boolean;model:string;status:string}>{
 try{
  const response=await fetch(config.AI_OLLAMA_BASE_URL.replace(/\/$/,"")+"/health",{headers:{authorization:"Bearer "+config.AI_OLLAMA_API_KEY},signal:AbortSignal.timeout(4000)});
  return {ok:response.ok,model:config.AI_OLLAMA_MODEL,status:response.ok?"ready":"unavailable"};
 }catch{return {ok:false,model:config.AI_OLLAMA_MODEL,status:"unreachable"};}
}
