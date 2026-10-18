import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const allowedOrigins = new Set(["https://whappnus.online","https://appnos.online","https://whappnus1.netlify.app","http://localhost:5173"]);
const headersFor = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://whappnus.online", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json; charset=utf-8" });
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
const text = (v: unknown, max = 300) => typeof v === "string" ? v.trim().slice(0, max) : "";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const normalizePhone = (raw: unknown) => { let digits = text(raw,80).replace(/\D/g,""); if(digits.startsWith("00"))digits=digits.slice(2); if(digits.length===9)digits="244"+digits; return digits.length<8||digits.length>15?"":"+"+digits; };
const fail = (message: string, status = 400, origin: string | null = null) => json({ok:false,error:message},status,origin);
Deno.serve(async (req: Request) => {
 const origin=req.headers.get("Origin");
 if(req.method==="OPTIONS")return new Response("ok",{headers:headersFor(origin)});
 if(req.method!=="POST")return fail("Método não permitido.",405,origin);
 const url=Deno.env.get("SUPABASE_URL"),anonKey=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anonKey||!serviceKey)return fail("Serviço temporariamente indisponível.",500,origin);
 const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return fail("Inicia sessão para continuar.",401,origin);
 const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await authClient.auth.getUser(token);
 if(authError||!authData.user)return fail("A sessão expirou. Inicia sessão novamente.",401,origin);
 const actor=authData.user,db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 let input:Record<string,unknown>;try{const p=await req.json();if(!isObj(p))return fail("Pedido inválido.",400,origin);input=p;}catch{return fail("Pedido inválido.",400,origin);}
 const action=text(input.action,80);
 const requireAdmin=async()=>{const r=await db.from("superadmin_users").select("user_id,role,is_active").eq("user_id",actor.id).eq("is_active",true).maybeSingle();if(r.error)throw new Error("Não foi possível validar as permissões administrativas.");if(!r.data||!["PLATFORM_OWNER","PLATFORM_ADMIN","BILLING_ADMIN"].includes(String(r.data.role??"").toUpperCase()))throw Object.assign(new Error("Acesso restrito à equipa financeira e de plataforma."),{status:403});return r.data;};
 const approveEligible=async(userId?:string)=>{const now=new Date().toISOString();let q=db.from("affiliate_commissions").select("id,sale_id").eq("status","pending").lte("eligible_at",now).limit(500);if(userId)q=q.eq("affiliate_user_id",userId);const r=await q;if(r.error)throw r.error;if(!r.data?.length)return;const ids=r.data.map((x:any)=>x.sale_id);const sales=await db.from("kursinha_sales").select("sale_id").in("sale_id",ids).eq("status","approved");if(sales.error)throw sales.error;const ok=(sales.data??[]).map((x:any)=>x.sale_id),bad=ids.filter((x:string)=>!ok.includes(x));if(ok.length){const u=await db.from("affiliate_commissions").update({status:"approved",updated_at:now}).in("sale_id",ok).eq("status","pending");if(u.error)throw u.error;}if(bad.length){const u=await db.from("affiliate_commissions").update({status:"reversed",updated_at:now}).in("sale_id",bad).eq("status","pending");if(u.error)throw u.error;}};
 try{
  if(action==="photo.upload-url"){
   const mime=text(input.mimeType,80).toLowerCase(),ext=mime==="image/jpeg"?"jpg":mime==="image/png"?"png":mime==="image/webp"?"webp":"";
   if(!ext)return fail("Usa uma imagem JPG, PNG ou WebP.",400,origin);
   const path=actor.id+"/"+crypto.randomUUID()+"."+ext;
   const r=await db.storage.from("affiliate-photos").createSignedUploadUrl(path);
   if(r.error||!r.data)return fail("Não foi possível preparar o envio da fotografia.",500,origin);
   return json({ok:true,data:{path:r.data.path,token:r.data.token}},200,origin);
  }
  if(action==="application.submit"){
   const fullName=text(input.fullName,160),age=Number(input.age),partnerType=text(input.partnerType,30),method=text(input.payoutMethod,30),accountName=text(input.payoutAccountName,160);
   const phone=normalizePhone(input.whatsappPhone),accountPhone=normalizePhone(actor.user_metadata?.phone),photoPath=text(input.profilePhotoPath,500);
   const bank=text(input.bankName,120),iban=text(input.iban,80).replace(/\s/g,"").toUpperCase(),payoutPhone=normalizePhone(input.payoutPhone),other=text(input.otherPayoutDetails,300);
   if(fullName.length<2||!Number.isInteger(age)||age<18||age>120)return fail("Confere o nome completo e confirma que tens pelo menos 18 anos.",400,origin);
   if(!["content","commercial","strategic"].includes(partnerType))return fail("Seleciona a modalidade de parceria.",400,origin);
   if(!phone||(accountPhone&&phone!==accountPhone))return fail("Usa o número de WhatsApp associado à tua conta. Se precisares de o alterar, atualiza primeiro os dados da conta.",400,origin);
   if(!accountPhone){const u=await db.auth.admin.updateUserById(actor.id,{user_metadata:{...(actor.user_metadata??{}),phone}});if(u.error)return fail("Não foi possível validar o contacto. Confere os dados ou contacta o suporte.",400,origin);}
   if(photoPath&&!photoPath.startsWith(actor.id+"/"))return fail("A fotografia selecionada não é válida.",400,origin);
   if(!["iban","unitel_money","africell_money","other"].includes(method)||accountName.length<2)return fail("Preenche os dados de pagamento.",400,origin);
   if(method==="iban"&&(!bank||iban.length<15))return fail("Indica o banco e um IBAN válido.",400,origin);
   if(["unitel_money","africell_money"].includes(method)&&!payoutPhone)return fail("Indica o número da carteira móvel.",400,origin);
   if(method==="other"&&!other)return fail("Descreve o método de pagamento alternativo.",400,origin);
   const existing=await db.from("affiliate_profiles").select("status").eq("user_id",actor.id).maybeSingle();if(existing.error)return fail("Não foi possível consultar a candidatura.",500,origin);
   if(existing.data?.status==="approved")return fail("A tua parceria já está ativa. Contacta o suporte para alterar os dados de pagamento.",409,origin);
   const payload={user_id:actor.id,full_name:fullName,age,mother_name:text(input.motherName,160)||null,whatsapp_phone:phone,profile_photo_path:photoPath||null,partner_type:partnerType,tier:"initial",instagram_handle:text(input.instagram,160)||null,tiktok_handle:text(input.tiktok,160)||null,facebook_url:text(input.facebook,300)||null,application_notes:text(input.applicationNotes,1000)||null,payout_method:method,payout_account_name:accountName,bank_name:method==="iban"?bank:null,payout_iban:method==="iban"?iban:null,payout_phone:["unitel_money","africell_money"].includes(method)?payoutPhone:null,payout_other_details:method==="other"?other:null,status:"pending",reviewed_by:null,reviewed_at:null,rejection_reason:null,updated_at:new Date().toISOString()};
   const saved=await db.from("affiliate_profiles").upsert(payload,{onConflict:"user_id"}).select("user_id,status,partner_type,tier,referral_code,created_at").single();
   if(saved.error||!saved.data)return fail("Não foi possível enviar a candidatura. Confere os dados e tenta novamente.",400,origin);
   await db.from("affiliate_audit_logs").insert({actor_user_id:actor.id,affiliate_user_id:actor.id,action:"application.submitted",details:{partner_type:partnerType}});
   return json({ok:true,data:saved.data},200,origin);
  }
  if(action==="portal.get"){
   await approveEligible(actor.id);
   const [profile,referrals,commissions,payouts]=await Promise.all([
    db.from("affiliate_profiles").select("*").eq("user_id",actor.id).maybeSingle(),
    db.from("affiliate_referrals").select("id,referral_code,status,created_at,expires_at,converted_at").eq("affiliate_user_id",actor.id).order("created_at",{ascending:false}).limit(200),
    db.from("affiliate_commissions").select("id,sale_id,plan_code,commission_type,rate,base_amount_aoa,amount_aoa,status,eligible_at,payout_request_id,created_at").eq("affiliate_user_id",actor.id).order("created_at",{ascending:false}).limit(300),
    db.from("affiliate_payout_requests").select("id,amount_aoa,status,requested_at,reviewed_at,paid_at,payment_reference,proof_url,admin_note,rejection_reason").eq("affiliate_user_id",actor.id).order("requested_at",{ascending:false}).limit(100)
   ]);
   for(const r of [profile,referrals,commissions,payouts])if(r.error)throw r.error;
   let photoUrl:string|null=null;if(profile.data?.profile_photo_path){const s=await db.storage.from("affiliate-photos").createSignedUrl(profile.data.profile_photo_path,300);if(!s.error)photoUrl=s.data?.signedUrl??null;}
   const cs=commissions.data??[],rs=referrals.data??[];
   const stats={referralCount:rs.length,paidCount:rs.filter((x:any)=>x.status==="converted").length,pending:cs.filter((x:any)=>x.status==="pending").reduce((n:number,x:any)=>n+Number(x.amount_aoa),0),available:cs.filter((x:any)=>x.status==="approved"&&!x.payout_request_id).reduce((n:number,x:any)=>n+Number(x.amount_aoa),0),totalPaid:cs.filter((x:any)=>x.status==="paid").reduce((n:number,x:any)=>n+Number(x.amount_aoa),0)};
   return json({ok:true,data:{profile:profile.data,photoUrl,referrals:rs,commissions:cs,payouts:payouts.data??[],stats,minPayout:10000}},200,origin);
  }
  if(action==="payout.request"){
   const r=await db.rpc("request_affiliate_payout",{p_affiliate_user_id:actor.id});
   if(r.error){const m=r.error.message.includes("MINIMUM_PAYOUT_NOT_REACHED")?"O saldo disponível ainda não atingiu 10.000 Kz.":r.error.message.includes("AFFILIATE_NOT_APPROVED")?"A candidatura ainda não foi aprovada.":"Não foi possível criar o pedido de pagamento. Atualiza o saldo e tenta novamente.";return fail(m,400,origin);}
   return json({ok:true,data:{requestId:r.data}},200,origin);
  }
  if(action.startsWith("admin.")){
   await requireAdmin();await approveEligible();
   if(action==="admin.dashboard"){
    const [profiles,commissions,payouts,rules]=await Promise.all([
     db.from("affiliate_profiles").select("*").order("created_at",{ascending:false}).limit(500),
     db.from("affiliate_commissions").select("id,affiliate_user_id,referred_user_id,referral_id,sale_id,plan_code,commission_type,rate,base_amount_aoa,amount_aoa,status,eligible_at,payout_request_id,created_at").order("created_at",{ascending:false}).limit(1000),
     db.from("affiliate_payout_requests").select("*").order("requested_at",{ascending:false}).limit(500),
     db.from("affiliate_commission_rules").select("*").order("plan_code")
    ]);
    for(const r of [profiles,commissions,payouts,rules])if(r.error)throw r.error;
    const profileRows=profiles.data??[];
    const accountRows=profileRows.length?await db.from("profiles").select("id,email").in("id",profileRows.map((p:any)=>p.user_id)):{data:[],error:null};
    if(accountRows.error)throw accountRows.error;
    const accountEmails:Record<string,string>={};for(const row of accountRows.data??[]){accountEmails[row.id]=row.email??"";}
    const profilesWithEmail=profileRows.map((p:any)=>({...p,account_email:accountEmails[p.user_id]??null}));
    const photos:Record<string,string>={};for(const p of profilesWithEmail){if(!p.profile_photo_path)continue;const s=await db.storage.from("affiliate-photos").createSignedUrl(p.profile_photo_path,300);if(!s.error&&s.data?.signedUrl)photos[p.user_id]=s.data.signedUrl;}
    return json({ok:true,data:{profiles:profilesWithEmail,commissions:commissions.data??[],payouts:payouts.data??[],rules:rules.data??[],photos,minPayout:10000}},200,origin);
   }
   if(action==="admin.review"){
    const userId=text(input.userId,80),status=text(input.status,30),tier=text(input.tier,30),reason=text(input.reason,500);
    if(!userId||userId===actor.id||!["approved","rejected","suspended"].includes(status))return fail("Ação de revisão inválida.",400,origin);
    if(tier&&!["initial","pro","elite"].includes(tier))return fail("Nível de parceiro inválido.",400,origin);
    if(["rejected","suspended"].includes(status)&&!reason)return fail("Indica o motivo desta decisão.",400,origin);
    const patch:Record<string,unknown>={status,reviewed_by:actor.id,reviewed_at:new Date().toISOString(),rejection_reason:status==="rejected"?reason:null,updated_at:new Date().toISOString()};if(tier)patch.tier=tier;
    const r=await db.from("affiliate_profiles").update(patch).eq("user_id",userId).select("user_id,status,tier,referral_code").maybeSingle();
    if(r.error||!r.data)return fail("Não foi possível atualizar a candidatura.",400,origin);
    await db.from("affiliate_audit_logs").insert({actor_user_id:actor.id,affiliate_user_id:userId,action:"application.reviewed",details:{status,tier:tier||null,reason:reason||null}});
    return json({ok:true,data:r.data},200,origin);
   }
   if(action==="admin.rules.update"){
    const planCode=text(input.planCode,80),initialRate=Number(input.initialRate),renewalRate=Number(input.renewalRate),renewalLimit=Number(input.renewalLimit);
    if(!planCode||!Number.isFinite(initialRate)||initialRate<0||initialRate>100||!Number.isFinite(renewalRate)||renewalRate<0||renewalRate>100||!Number.isInteger(renewalLimit)||renewalLimit<0||renewalLimit>24)return fail("Confere as percentagens e o limite de renovações.",400,origin);
    const r=await db.from("affiliate_commission_rules").update({initial_rate:initialRate,renewal_rate:renewalRate,renewal_limit:renewalLimit,updated_at:new Date().toISOString()}).eq("plan_code",planCode).select("*").maybeSingle();
    if(r.error||!r.data)return fail("Não foi possível atualizar as regras deste plano.",400,origin);
    await db.from("affiliate_audit_logs").insert({actor_user_id:actor.id,action:"commission.rules.updated",details:{planCode,initialRate,renewalRate,renewalLimit}});
    return json({ok:true,data:r.data},200,origin);
   }
   if(action==="admin.payout.update"){
    const payoutId=text(input.payoutId,80),status=text(input.status,30),note=text(input.note,1000),reference=text(input.paymentReference,200),proofUrl=text(input.proofUrl,1000);
    if(!payoutId||!["approved","rejected","paid"].includes(status))return fail("Estado do pagamento inválido.",400,origin);
    if(status==="paid"&&!reference)return fail("Indica a referência da transferência efetuada.",400,origin);
    if(status==="rejected"&&!note)return fail("Indica o motivo da rejeição.",400,origin);
    const result=await db.rpc("review_affiliate_payout",{p_payout_id:payoutId,p_admin_id:actor.id,p_status:status,p_note:note||null,p_payment_reference:reference||null,p_proof_url:proofUrl||null});
    if(result.error){
      const message=result.error.message.includes("PAYOUT_NOT_FOUND")?"Pedido de pagamento não encontrado.":result.error.message.includes("PAYOUT_NOT_PENDING")?"Só é possível aprovar pedidos pendentes.":result.error.message.includes("PAYOUT_NOT_APPROVED_OR_REFERENCE_MISSING")?"Aprova primeiro o pedido e indica a referência da transferência.":result.error.message.includes("PAYOUT_CANNOT_BE_REJECTED")?"Este pedido já não pode ser rejeitado.":"Não foi possível atualizar o pedido de pagamento.";
      return fail(message,400,origin);
    }
    return json({ok:true,data:result.data},200,origin);
   }
   return fail("Ação administrativa desconhecida.",404,origin);
  }
  return fail("Ação desconhecida.",404,origin);
 }catch(error){const status=isObj(error)&&typeof error.status==="number"?error.status:500;console.error("[affiliate-api]",action,error instanceof Error?error.message:"unknown error");return fail(status===403?"Acesso restrito à equipa autorizada.":"Não foi possível concluir o pedido. Tenta novamente.",status,origin);}
});