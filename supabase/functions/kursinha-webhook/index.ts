import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-webhook-signature","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown,n=500)=>typeof v==="string"?v.trim().slice(0,n):"";
const email=(v:unknown)=>str(v,320).toLowerCase();
const num=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:typeof v==="string"&&v.trim()&&Number.isFinite(Number(v))?Number(v):NaN;
const hex=(b:Uint8Array)=>[...b].map(x=>x.toString(16).padStart(2,"0")).join("");
const hash=async(v:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))));
async function signatureOK(raw:string,header:string,secret:string){
 const m=/^sha256=([0-9a-f]{64})$/i.exec(header.trim()); if(!m)return false;
 const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const h=hex(new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(raw))));
 if(h.length!==m[1].length)return false;let d=0;for(let i=0;i<h.length;i++)d|=h.charCodeAt(i)^m[1].toLowerCase().charCodeAt(i);return d===0;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return reply({ok:false,error:"Método não permitido."},405);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply({ok:false,error:"Configuração do servidor incompleta."},500);
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const sig=req.headers.get("X-Webhook-Signature");
 if(sig===null)return reply({ok:false,error:"Assinatura obrigatória."},401);
 if(sig!==null){
  const secret=Deno.env.get("KURSINHA_WEBHOOK_SECRET");if(!secret)return reply({ok:false,error:"Webhook não configurado no servidor."},503);
  const raw=await req.text();if(!(await signatureOK(raw,sig,secret)))return reply({ok:false,error:"Assinatura inválida."},401);
  let p:Record<string,any>;try{const j=JSON.parse(raw);if(!obj(j))return reply({ok:false,error:"Payload inválido."},400);p=j;}catch{return reply({ok:false,error:"JSON inválido."},400);}
  const event=str(p.event,80),d=obj(p.data)?p.data:{},saleId=str(d.saleId,180),buyer=email(d.buyer?.email),product=obj(d.product)?d.product:{};
  const productId=str(product.id,120),productName=str(product.name,200),price=num(product.price),currency=str(product.currency??d.currency,8).toUpperCase();
  if(!["sale.pending","sale.approved","sale.cancelled"].includes(event)||!saleId||!buyer||!productId)return reply({ok:false,error:"Evento ou venda inválidos."},400);
  const now=new Date().toISOString(),eventKey=event+":"+saleId;
  const ew=await db.from("kursinha_webhook_events").upsert({event_key:eventKey,event_type:event,sale_id:saleId,payload_hash:await hash(raw),payload:p,processing_status:"received",error_message:null,processed_at:null},{onConflict:"event_key",ignoreDuplicates:true});
  if(ew.error)return reply({ok:false,error:"Não foi possível registar o evento."},500);
  const es=await db.from("kursinha_webhook_events").select("processing_status").eq("event_key",eventKey).maybeSingle();
  if(es.error)return reply({ok:false,error:"Não foi possível consultar o evento."},500);
  if(["processed","ignored"].includes(es.data?.processing_status??""))return reply({ok:true,duplicate:true});
  await db.from("kursinha_webhook_events").update({processing_status:"processing",error_message:null}).eq("event_key",eventKey);
  try{
   const mr=await db.from("kursinha_product_mappings").select("plan_id,expected_amount_aoa,currency").eq("product_id",productId).eq("is_active",true).maybeSingle();if(mr.error)throw mr.error;
   const old=await db.from("kursinha_sales").select("status,organization_id,subscription_id,applied_at").eq("sale_id",saleId).maybeSingle();if(old.error)throw old.error;
   const prev=old.data;
   const common={sale_id:saleId,order_id:str(d.orderId,180),buyer_email:buyer,buyer_name:str(d.buyer?.name,200),buyer_phone:str(d.buyer?.phone,80),product_id:productId,product_name:productName,plan_id:mr.data?.plan_id??null,amount_aoa:Number.isFinite(price)&&price>=0?price:0,currency:currency||"AOA",last_event_type:event,payload:p};
   if(event==="sale.pending"){
    if(!prev||prev.status==="pending"){const r=await db.from("kursinha_sales").upsert({...common,status:"pending"},{onConflict:"sale_id"});if(r.error)throw r.error;}
   }else if(event==="sale.approved"){
    if(prev&&["cancelled","refunded","invalid"].includes(prev.status)){await db.from("kursinha_webhook_events").update({processing_status:"ignored",processed_at:now}).eq("event_key",eventKey);return reply({ok:true,ignored:true,reason:"SALE_TERMINAL_STATE"});}
    const valid=!!mr.data&&Number.isFinite(price)&&price===Number(mr.data.expected_amount_aoa)&&currency===mr.data.currency&&currency==="AOA";
    const r=await db.from("kursinha_sales").upsert({...common,status:valid?"approved":"invalid",approved_at:valid?now:null},{onConflict:"sale_id"});if(r.error)throw r.error;
    if(!valid){await db.from("kursinha_webhook_events").update({processing_status:"processed",error_message:"Produto, preço ou moeda fora do catálogo.",processed_at:now}).eq("event_key",eventKey);return reply({ok:true,activated:false,reason:"PRODUCT_PRICE_CURRENCY_MISMATCH"});}
    // Only attach automatically when a verified account has exactly one OWNER organization.
    const pr=await db.from("profiles").select("id,email").ilike("email",buyer).maybeSingle();if(pr.error)throw pr.error;
    if(pr.data?.id){
     const au=await db.auth.admin.getUserById(pr.data.id);
     if(!au.error&&au.data.user?.email_confirmed_at&&email(au.data.user.email)===buyer){
      const ms=await db.from("memberships").select("organization_id").eq("user_id",pr.data.id).eq("role","OWNER");if(ms.error)throw ms.error;
      const ids=[...new Set((ms.data??[]).map((x:any)=>x.organization_id))];
      if(ids.length===1&&(!prev?.organization_id||prev.organization_id===ids[0])){
       if(!prev?.organization_id){const link=await db.from("kursinha_sales").update({organization_id:ids[0],updated_at:now}).eq("sale_id",saleId).is("organization_id",null);if(link.error)throw link.error;}
       const applied=await db.rpc("apply_kursinha_approved_sale",{p_sale_id:saleId});if(applied.error)throw applied.error;if(!(applied.data?.applied||applied.data?.already_applied)){throw new Error("Ativação não confirmada: "+String(applied.data?.reason??"UNKNOWN"));}
      }
     }
    }
   }else{
    const paid=prev?.status==="approved"||prev?.status==="refunded"||!!prev?.applied_at;
    const r=await db.from("kursinha_sales").upsert({...common,status:paid?"refunded":"cancelled",cancelled_at:now},{onConflict:"sale_id"});if(r.error)throw r.error;
    if(paid&&prev?.subscription_id){
     const sub=await db.from("organization_subscriptions").update({status:"cancelled",cancelled_at:now,updated_at:now}).eq("id",prev.subscription_id).eq("provider","kursinha").eq("provider_subscription_id",saleId);if(sub.error)throw sub.error;
     const tx=await db.from("payment_transactions").update({status:"refunded",updated_at:now}).eq("provider","kursinha").eq("provider_payment_id",saleId);if(tx.error)throw tx.error;
     if(prev.organization_id){
      const other=await db.from("organization_subscriptions").select("id").eq("organization_id",prev.organization_id).in("status",["active","trialing"]).gt("current_period_end",now).limit(1);if(other.error)throw other.error;
      if(!other.data?.length){const org=await db.from("organizations").update({status:"suspended",suspended_at:now,suspension_reason:"payment_refunded",updated_at:now}).eq("id",prev.organization_id).not("status","in","(blocked,cancelled)");if(org.error)throw org.error;}
     }
    }
   }
   await db.from("kursinha_webhook_events").update({processing_status:"processed",processed_at:now,error_message:null}).eq("event_key",eventKey);
   return reply({ok:true,received:event,saleId});
  }catch(e){const msg=e instanceof Error?e.message:"Erro inesperado.";console.error("[kursinha-webhook]",event,saleId,msg);await db.from("kursinha_webhook_events").update({processing_status:"failed",error_message:msg.slice(0,1000)}).eq("event_key",eventKey);return reply({ok:false,error:"Falha ao processar; o evento pode ser reenviado."},500);}
 }
 let body:Record<string,any>;try{const j=await req.json();if(!obj(j))return reply({ok:false,error:"Pedido inválido."},400);body=j;}catch{return reply({ok:false,error:"JSON inválido."},400);}
 if(body.action!=="claim_pending_sales")return reply({ok:false,error:"Ação não autorizada."},400);
 const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"").trim();if(!token)return reply({ok:false,error:"Sessão necessária."},401);
 const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),auth=await authClient.auth.getUser(token),u=auth.data.user;
 if(auth.error||!u||!u.email_confirmed_at||!u.email)return reply({ok:false,error:"Confirma o email antes de associar o pagamento."},401);
 const ms=await db.from("memberships").select("organization_id").eq("user_id",u.id).eq("role","OWNER");if(ms.error)return reply({ok:false,error:"Não foi possível confirmar a organização."},500);
 const ids=[...new Set((ms.data??[]).map((x:any)=>x.organization_id))];if(ids.length!==1)return reply({ok:false,error:"É necessária exatamente uma organização com papel OWNER."},409);
 const sales=await db.from("kursinha_sales").select("sale_id,organization_id").eq("buyer_email",email(u.email)).eq("status","approved").is("applied_at",null).order("created_at",{ascending:true}).limit(20);if(sales.error)return reply({ok:false,error:"Não foi possível localizar pagamentos pendentes."},500);
 let applied=0,skipped=0;
 for(const sale of sales.data??[]){
  if(sale.organization_id&&sale.organization_id!==ids[0]){skipped++;continue;}
  const link=await db.from("kursinha_sales").update({organization_id:ids[0],updated_at:new Date().toISOString()}).eq("sale_id",sale.sale_id).is("applied_at",null);if(link.error)return reply({ok:false,error:"Não foi possível associar a compra."},500);
  const a=await db.rpc("apply_kursinha_approved_sale",{p_sale_id:sale.sale_id});if(a.error)return reply({ok:false,error:"A associação foi feita, mas a ativação falhou; tenta novamente."},500);
  if(a.data?.applied||a.data?.already_applied)applied++;else skipped++;
 }
 return reply({ok:true,applied,skipped});
});
