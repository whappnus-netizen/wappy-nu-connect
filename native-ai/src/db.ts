import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type { ConversationMemory } from "./memory.js";

export const supabase=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});

export async function getSettings(organizationId:string){
 const r=await supabase.from("ai_settings").select("*").eq("organization_id",organizationId).maybeSingle();
 if(r.error)throw new Error("ai_settings: "+r.error.message); return r.data;
}
export async function getAgent(organizationId:string){
 const r=await supabase.from("ai_agents").select("*").eq("organization_id",organizationId).limit(20);
 if(r.error)throw new Error("ai_agents: "+r.error.message);
 const rows=(r.data??[]) as Array<Record<string,unknown>>;
 return rows.find(x=>x.is_active!==false&&x.status!=="inactive")??rows[0]??null;
}
export async function getAgentContext(organizationId:string,whatsappNumberId?:string|null,agentId?:string|null){
 const r=await supabase.rpc("ai_agent_context",{
  _organization_id:organizationId,
  _whatsapp_number_id:whatsappNumberId??null,
  _agent_id:agentId??null
 });
 if(r.error)throw new Error("ai_agent_context: "+r.error.message);
 if(!r.data||typeof r.data!=="object")throw new Error("ai_agent_context returned an invalid response");
 const d=r.data as Record<string,unknown>;
 const agent=(d.agent&&typeof d.agent==="object"?d.agent:null) as Record<string,unknown>|null;
 const knowledge=Array.isArray(d.knowledge)?d.knowledge as Array<Record<string,unknown>>:[];
 const examples=Array.isArray(d.examples)?d.examples as Array<Record<string,unknown>>:[];
 return {agent,knowledge,examples};
}
export async function getHistory(
 conversationId:string|null|undefined,
 organizationId:string,
 excludeWaMessageId?:string|null
){
 if(!conversationId)return [] as Array<Record<string,unknown>>;
 // Keep the history tenant-scoped and exclude the inbound event currently being
 // generated: ingestion persists it before the worker starts, while buildMessages
 // appends the current user turn separately.
 let query=supabase.from("messages").select("body,direction,created_at,wa_message_id")
  .eq("organization_id",organizationId)
  .eq("conversation_id",conversationId);
 if(excludeWaMessageId)query=query.neq("wa_message_id",excludeWaMessageId);
 const r=await query.order("created_at",{ascending:false}).limit(config.AI_HISTORY_LIMIT);
 if(r.error)throw new Error("messages: "+r.error.message);
 return ((r.data??[]) as Array<Record<string,unknown>>).reverse();
}
export async function getKnowledge(organizationId:string){
 const r=await supabase.from("ai_knowledge").select("*").eq("organization_id",organizationId).eq("is_active",true).limit(config.AI_KNOWLEDGE_LIMIT);
 if(r.error)throw new Error("ai_knowledge: "+r.error.message);
 return (r.data??[]) as Array<Record<string,unknown>>;
}
export async function getTrainingExamples(organizationId:string){
 const r=await supabase.from("ai_training_examples").select("*").eq("organization_id",organizationId).eq("is_active",true).limit(20);
 if(r.error)throw new Error("ai_training_examples: "+r.error.message);
 return (r.data??[]) as Array<Record<string,unknown>>;
}
export async function getConversationMemory(organizationId:string,conversationId:string){
 const r=await supabase.from("ai_conversation_memory")
  .select("summary,facts,state,last_message_id,last_message_at,updated_at")
  .eq("organization_id",organizationId)
  .eq("conversation_id",conversationId)
  .maybeSingle();
 if(r.error)throw new Error("ai_conversation_memory read: "+r.error.message);
 if(!r.data)return null;
 return {
  summary:String(r.data.summary??""),
  facts:Array.isArray(r.data.facts)?r.data.facts as ConversationMemory["facts"]:[],
  state:r.data.state&&typeof r.data.state==="object"?r.data.state as Record<string,unknown>:{}
 };
}
export async function upsertConversationMemory(
 organizationId:string,
 conversationId:string,
 agentId:string,
 memory:ConversationMemory
){
 const r=await supabase.from("ai_conversation_memory").upsert({
  organization_id:organizationId,
  conversation_id:conversationId,
  agent_id:agentId,
  summary:memory.summary,
  facts:memory.facts,
  state:memory.state,
  last_message_id:memory.lastMessageId,
  last_message_at:memory.lastMessageAt,
  updated_at:new Date().toISOString()
 },{onConflict:"organization_id,conversation_id"});
 if(r.error)throw new Error("ai_conversation_memory upsert: "+r.error.message);
}
export async function writeAiLog(payload:Record<string,unknown>){
 const r=await supabase.from("ai_logs").insert(payload);
 if(r.error)console.error("ai_logs:",r.error.message);
}
