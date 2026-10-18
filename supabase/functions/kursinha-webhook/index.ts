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
// Envio idempotente de e-mails (WhappNus /api/public/email/dispatch → Brevo). Nunca lança: falhas não bloqueiam pagamentos.
async function sendEmail(db:any,p:{template:string;to:string;name?:string;vars?:Record<string,unknown>;idempotencyKey:string;event:string;organizationId?:string|null}){
 const endpoint=Deno.env.get("EMAIL_DISPATCH_URL")??"https://whappnus.online/api/public/email/dispatch",secret=Deno.env.get("EMAIL_DISPATCH_SECRET");
 if(!secret||!p.to)return;
 try{
  const ex=await db.from("email_delivery_logs").select("id,status").eq("idempotency_key",p.idempotencyKey).maybeSingle();
  if(ex.data&&["sent","sending"].includes(ex.data.status))return;
  const ins=ex.data?await db.from("email_delivery_logs").update({status:"sending",error_message:null}).eq("id",ex.data.id).select("id").single()
   :await db.from("email_delivery_logs").insert({idempotency_key:p.idempotencyKey,template_code:p.template,recipient_email:p.to,event_type:p.event,organization_id:p.organizationId??null,status:"sending"}).select("id").single();
  if(ins.error){console.warn("[email] log",ins.error.message);if(ins.error.code==="23505")return;}
  const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","x-email-secret":secret},body:JSON.stringify({template:p.template,to:p.to,name:p.name||undefined,vars:p.vars??{},idempotency_key:p.idempotencyKey})});
  const j:any=await r.json().catch(()=>({}));
  if(ins.data?.id)await db.from("email_delivery_logs").update(r.ok&&j.ok?{status:"sent",provider_message_id:j.messageId??null,sent_at:new Date().toISOString(),error_message:null}:{status:"failed",error_message:String(j.error??r.status).slice(0,300)}).eq("id",ins.data.id);
 }catch(e){console.error("[email]",p.template,e instanceof Error?e.message:e);await db.from("email_delivery_logs").update({status:"failed",error_message:"network_uncertain"}).eq("idempotency_key",p.idempotencyKey).eq("status","sending");}
}
async function recordAffiliateCommission(db:any,referredUserId:string,saleId:string,planId:string|null|undefined,price:number,now:string){
 if(!referredUserId||!planId||!Number.isFinite(price)||price<=0)return;
 const referral=await db.from("affiliate_referrals").select("id,affiliate_user_id,status,expires_at").eq("referred_user_id",referredUserId).in("status",["active","converted"]).maybeSingle();if(referral.error)throw referral.error;
 if(!referral.data)return;
 const partner=await db.from("affiliate_profiles").select("user_id,status").eq("user_id",referral.data.affiliate_user_id).eq("status","approved").maybeSingle();if(partner.error)throw partner.error;
 const plan=await db.from("subscription_plans").select("code").eq("id",planId).maybeSingle();if(plan.error)throw plan.error;
 const rule=plan.data?.code?await db.from("affiliate_commission_rules").select("initial_rate,renewal_rate,renewal_limit,is_active").eq("plan_code",plan.data.code).maybeSingle():{data:null,error:null};if(rule.error)throw rule.error;
 if(!partner.data||!plan.data?.code||!rule.data?.is_active)return;
 const history=await db.from("affiliate_commissions").select("commission_type,status").eq("referral_id",referral.data.id).neq("status","reversed");if(history.error)throw history.error;
 const prior=history.data??[],renewalCount=prior.filter((x:any)=>x.commission_type==="renewal").length;
 let commissionType:"initial"|"renewal"|null=null,rate=0;
 if(prior.length===0&&referral.data.status==="active"&&new Date(referral.data.expires_at).getTime()>=Date.now()){commissionType="initial";rate=Number(rule.data.initial_rate);}
 else if(prior.length>0&&renewalCount<Number(rule.data.renewal_limit)){commissionType="renewal";rate=Number(rule.data.renewal_rate);}
 if(!commissionType||rate<=0)return;
 const amount=Math.round((Number(price)*rate/100)*100)/100;
 const saved=await db.from("affiliate_commissions").upsert({referral_id:referral.data.id,affiliate_user_id:referral.data.affiliate_user_id,referred_user_id:referredUserId,sale_id:saleId,plan_code:plan.data.code,commission_type:commissionType,rate,base_amount_aoa:Number(price),amount_aoa:amount,status:"pending",eligible_at:new Date(Date.now()+14*24*60*60*1000).toISOString(),updated_at:now},{onConflict:"sale_id",ignoreDuplicates:true});
 if(saved.error)throw saved.error;
 if(commissionType==="initial"){const converted=await db.from("affiliate_referrals").update({status:"converted",converted_at:now}).eq("id",referral.data.id).eq("status","active");if(converted.error)throw converted.error;}
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
  if(["processed","ignored"].includes(es.data?.processing_status??"")){
   if(es.data?.processing_status==="processed"){
    const keys=event==="sale.pending"?["payment_pending:"+saleId]:event==="sale.approved"?["payment_approved:"+saleId]:["payment_cancelled:"+saleId,"payment_refunded:"+saleId];
    const failedEmail=await db.from("email_delivery_logs").select("id").in("idempotency_key",keys).eq("status","failed").limit(1);
    if(failedEmail.error)console.warn("[kursinha-webhook] não foi possível verificar retry de e-mail",failedEmail.error.message);
    if(failedEmail.data?.length){
     await db.from("kursinha_webhook_events").update({processing_status:"received",processed_at:null,error_message:null}).eq("event_key",eventKey);
    }else return reply({ok:true,duplicate:true});
   }else return reply({ok:true,duplicate:true});
  }
  await db.from("kursinha_webhook_events").update({processing_status:"processing",error_message:null}).eq("event_key",eventKey);
  try{
   const mr=await db.from("kursinha_product_mappings").select("plan_id,expected_amount_aoa,currency").eq("product_id",productId).eq("is_active",true).maybeSingle();if(mr.error)throw mr.error;
   const old=await db.from("kursinha_sales").select("status,organization_id,subscription_id,applied_at").eq("sale_id",saleId).maybeSingle();if(old.error)throw old.error;
   const prev=old.data;
   const common={sale_id:saleId,order_id:str(d.orderId,180),buyer_email:buyer,buyer_name:str(d.buyer?.name,200),buyer_phone:str(d.buyer?.phone,80),product_id:productId,product_name:productName,plan_id:mr.data?.plan_id??null,amount_aoa:Number.isFinite(price)&&price>=0?price:0,currency:currency||"AOA",last_event_type:event,payload:p};
   if(event==="sale.pending"){
    if(!prev||prev.status==="pending"){const r=await db.from("kursinha_sales").upsert({...common,status:"pending"},{onConflict:"sale_id"});if(r.error)throw r.error;
     await sendEmail(db,{template:"payment_pending",to:buyer,name:common.buyer_name,event,idempotencyKey:"payment_pending:"+saleId,vars:{plan:productName,amount:common.amount_aoa,reference:common.order_id||saleId}});}
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
              try {
        await recordAffiliateCommission(db,pr.data?.id,saleId,mr.data?.plan_id,price,now);
       } catch (affiliateError) {
        console.error("[affiliate-commission] Falha ao gerar comissão para a venda " + saleId + ":", affiliateError instanceof Error ? affiliateError.message : "erro desconhecido");
        await db.from("affiliate_audit_logs").insert({ action: "commission.generation_failed", details: { sale_id: saleId, reason: affiliateError instanceof Error ? affiliateError.message.slice(0,200) : "unknown" } });
       }
       const ss=await db.from("kursinha_sales").select("subscription_id").eq("sale_id",saleId).maybeSingle();
       const sub:any=ss.data?.subscription_id?await db.from("organization_subscriptions").select("current_period_start,current_period_end,subscription_plans(name),organizations(name)").eq("id",ss.data.subscription_id).maybeSingle():{data:null};
       const s0:any=sub.data;
       await sendEmail(db,{template:"payment_approved",to:buyer,name:common.buyer_name,event,organizationId:ids[0],idempotencyKey:"payment_approved:"+saleId,vars:{plan:s0?.subscription_plans?.name||productName,organization:s0?.organizations?.name,amount:common.amount_aoa,approved_at:now,period_start:s0?.current_period_start,period_end:s0?.current_period_end,reference:common.order_id||saleId}});
      }
     }
    }
   }else{
    const paid=prev?.status==="approved"||prev?.status==="refunded"||!!prev?.applied_at;
    const r=await db.from("kursinha_sales").upsert({...common,status:paid?"refunded":"cancelled",cancelled_at:now},{onConflict:"sale_id"});if(r.error)throw r.error;
    try {
     const requestedCommission=await db.from("affiliate_commissions").select("payout_request_id,affiliate_user_id,amount_aoa").eq("sale_id",saleId).eq("status","requested").maybeSingle();if(requestedCommission.error)throw requestedCommission.error;
     if(requestedCommission.data?.payout_request_id){
      const requestId=requestedCommission.data.payout_request_id;
      const requestNote="Pedido devolvido para revisão automática: uma venda associada a comissão solicitada foi cancelada/reembolsada.";
      const payoutReset=await db.from("affiliate_payout_requests").update({status:"rejected",reviewed_at:now,rejection_reason:requestNote,admin_note:requestNote}).eq("id",requestId).in("status",["pending_review","approved"]);if(payoutReset.error)throw payoutReset.error;
      const release=await db.from("affiliate_commissions").update({status:"approved",payout_request_id:null,updated_at:now}).eq("payout_request_id",requestId).eq("status","requested");if(release.error)throw release.error;
     }
     const commissionCancel=await db.from("affiliate_commissions").update({status:"reversed",payout_request_id:null,updated_at:now}).eq("sale_id",saleId).in("status",["pending","approved"]);if(commissionCancel.error)throw commissionCancel.error;
     const alreadyPaidCommission=await db.from("affiliate_commissions").select("affiliate_user_id,amount_aoa").eq("sale_id",saleId).eq("status","paid").maybeSingle();if(alreadyPaidCommission.error)throw alreadyPaidCommission.error;
     if(alreadyPaidCommission.data){const audit=await db.from("affiliate_audit_logs").insert({affiliate_user_id:alreadyPaidCommission.data.affiliate_user_id,action:"commission.sale_refunded_after_payout",details:{sale_id:saleId,amount_aoa:alreadyPaidCommission.data.amount_aoa}});if(audit.error)throw audit.error;}
 
    } catch (affiliateError) {
     console.error("[affiliate-commission] Falha ao reconciliar comissão após cancelamento da venda " + saleId + ":", affiliateError instanceof Error ? affiliateError.message : "erro desconhecido");
     await db.from("affiliate_audit_logs").insert({ action: "commission.reversal_failed", details: { sale_id: saleId, reason: affiliateError instanceof Error ? affiliateError.message.slice(0,200) : "unknown" } });
    }
    await sendEmail(db,{template:paid?"payment_refunded":"payment_cancelled",to:buyer,name:common.buyer_name,event,organizationId:prev?.organization_id,idempotencyKey:(paid?"payment_refunded:":"payment_cancelled:")+saleId,vars:{plan:productName,amount:common.amount_aoa,reference:common.order_id||saleId}});
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
  if(a.data?.applied||a.data?.already_applied){
   applied++;
   // A conta pode ter sido criada depois do evento aprovado; enviar confirmação após ativação real.
   const saleInfo=await db.from("kursinha_sales").select("buyer_email,buyer_name,product_name,amount_aoa,order_id,organization_id,subscription_id,approved_at,plan_id").eq("sale_id",sale.sale_id).maybeSingle();
   if(saleInfo.error)console.warn("[kursinha-webhook] detalhes da venda para e-mail",saleInfo.error.message);
   else if(saleInfo.data){
    const si:any=saleInfo.data;
    try {
     await recordAffiliateCommission(db,u.id,sale.sale_id,si.plan_id,Number(si.amount_aoa),new Date().toISOString());
    } catch (affiliateError) {
     console.error("[affiliate-commission] Falha ao reconciliar comissão durante a associação da venda " + sale.sale_id + ":", affiliateError instanceof Error ? affiliateError.message : "erro desconhecido");
     await db.from("affiliate_audit_logs").insert({affiliate_user_id:null,action:"commission.claim_reconciliation_failed",details:{sale_id:sale.sale_id,reason:affiliateError instanceof Error?affiliateError.message.slice(0,200):"unknown"}});
    }
    const subInfo=si.subscription_id?await db.from("organization_subscriptions").select("current_period_start,current_period_end,subscription_plans(name),organizations(name)").eq("id",si.subscription_id).maybeSingle():{data:null,error:null};
    if(subInfo.error)console.warn("[kursinha-webhook] dados da assinatura para e-mail",subInfo.error.message);
    const ss:any=subInfo.data;
    await sendEmail(db,{template:"payment_approved",to:si.buyer_email,name:si.buyer_name,event:"sale.approved",organizationId:si.organization_id,idempotencyKey:"payment_approved:"+sale.sale_id,vars:{plan:ss?.subscription_plans?.name||si.product_name,organization:ss?.organizations?.name,amount:si.amount_aoa,approved_at:si.approved_at||new Date().toISOString(),period_start:ss?.current_period_start,period_end:ss?.current_period_end,reference:si.order_id||sale.sale_id}});
   }
  }else skipped++;
 }
 return reply({ok:true,applied,skipped});
});
