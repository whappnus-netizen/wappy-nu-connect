import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const origins=new Set(["https://whappnus.online","https://appnos.online","https://whappnus1.netlify.app","http://localhost:5173"]);
const headers=(o:string|null)=>({"Access-Control-Allow-Origin":o&&origins.has(o)?o:"https://whappnus.online","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8"});
const reply=(body:unknown,status=200,o:string|null=null)=>new Response(JSON.stringify(body),{status,headers:headers(o)});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");if(req.method==="OPTIONS")return new Response("ok",{headers:headers(origin)});if(req.method!=="POST")return reply({ok:false,error:"Método não permitido."},405,origin);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return reply({ok:false,error:"Serviço temporariamente indisponível."},500,origin);
 const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"").trim();if(!token)return reply({ok:false,error:"Inicia sessão para continuar."},401,origin);
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const who=await auth.auth.getUser(token);if(who.error||!who.data.user)return reply({ok:false,error:"Sessão inválida ou expirada."},401,origin);
 let body:any;try{body=await req.json();}catch{return reply({ok:false,error:"Pedido inválido."},400,origin);}
 if(body?.action!=="plans.available")return reply({ok:false,error:"Ação desconhecida."},404,origin);
 const requestedOrgId=typeof body.organization_id==="string"?body.organization_id.trim():"";
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOrgId))
  return reply({ok:false,error:"Seleciona uma organização válida para consultar os planos."},400,origin);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const membership=await db.from("memberships").select("organization_id,role").eq("user_id",who.data.user.id).eq("organization_id",requestedOrgId).eq("role","OWNER").maybeSingle();
  if(membership.error)throw membership.error;
  if(!membership.data)return reply({ok:false,error:"Não tens permissão para consultar a assinatura desta organização."},403,origin);
  const orgId=membership.data.organization_id;
  const current=await db.from("organization_subscriptions").select("status,plan_id,current_period_end,subscription_plans(code,name,price_aoa)").eq("organization_id",orgId).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(current.error)throw current.error;
  const currentPlan:any=current.data?.subscription_plans??null;
  const periodEnd=current.data?.current_period_end?new Date(current.data.current_period_end).getTime():null;
  const org=await db.from("organizations").select("status").eq("id",orgId).maybeSingle();
  if(org.error)throw org.error;
  const currentStatus=String(current.data?.status??"");
  const subscriptionActive=["active","trialing"].includes(currentStatus)
    &&(currentStatus!=="trialing"||periodEnd!==null)
    &&(periodEnd===null||(Number.isFinite(periodEnd)&&periodEnd>Date.now()));
  const organizationSuspended=["suspended","blocked","cancelled"].includes(String(org.data?.status??""));
  const currentPrice=subscriptionActive&&current.data?.status==="active"?Number(currentPlan?.price_aoa??0):0;
  const [plans,mappings]=await Promise.all([
   db.from("subscription_plans").select("id,code,name,description,price_aoa,trial_days,billing_interval,features,limits").eq("is_active",true).order("sort_order"),
   db.from("kursinha_product_mappings").select("plan_id,checkout_url,is_active").eq("is_active",true)
  ]);
  if(plans.error)throw plans.error;if(mappings.error)throw mappings.error;
  const urls=new Map((mappings.data??[]).map((m:any)=>[m.plan_id,m.checkout_url]));
  const options=(plans.data??[]).filter((p:any)=>Number(p.price_aoa)>currentPrice&&typeof urls.get(p.id)==="string"&&String(urls.get(p.id)).startsWith("https://pay.kursinha.com/")).map((p:any)=>({code:p.code,name:p.name,description:p.description,price_aoa:Number(p.price_aoa),billing_interval:p.billing_interval,features:p.features,limits:p.limits,checkout_url:urls.get(p.id)}));
  return reply({ok:true,data:{currentPlan:currentPlan?{code:currentPlan.code,name:currentPlan.name,price_aoa:Number(currentPlan.price_aoa??0),status:organizationSuspended?"suspended":!subscriptionActive?"expired":(current.data?.status??"active")}:null,options}},200,origin);
 }catch(e){console.error("[billing-api]",e instanceof Error?e.message:"unknown");return reply({ok:false,error:"Não foi possível carregar os planos disponíveis. Tenta novamente."},500,origin);}
});