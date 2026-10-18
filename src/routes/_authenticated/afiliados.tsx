import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Copy, Wallet, Users, Clock3, CheckCircle2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/afiliados")({
  head: () => ({ meta: [{ title: "Programa de parceiros — WhappNus" }] }),
  component: AffiliatePage,
});
type Portal = { profile:any; photoUrl:string|null; referrals:any[]; commissions:any[]; payouts:any[]; stats:{referralCount:number;paidCount:number;pending:number;available:number;totalPaid:number}; minPayout:number };
async function affiliateApi<T>(action:string,payload:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await supabase.functions.invoke("affiliate-api",{body:{action,...payload}});
 if(error){let message=error.message||"Não foi possível comunicar com o serviço de afiliados.";try{const ctx=(error as {context?:Response}).context;if(ctx){const b=await ctx.clone().json() as {error?:string};if(b.error)message=b.error;}}catch{}throw new Error(message);}
 if(!data?.ok)throw new Error(data?.error||"Não foi possível concluir o pedido.");return data.data as T;
}
const money=(n:unknown)=>Number(n??0).toLocaleString("pt-AO",{maximumFractionDigits:2})+" Kz";
const labels:Record<string,string>={pending:"Em validação",approved:"Disponível",requested:"Pedido de pagamento",paid:"Pago",reversed:"Anulado",pending_review:"A aguardar análise",rejected:"Rejeitado",suspended:"Suspenso",active:"Ativo",converted:"Cliente convertido"};
function AffiliatePage(){
 const {user}=useAuth(),client=useQueryClient();
 const [fullName,setFullName]=useState(String(user?.user_metadata?.["full_name"]??"")),[age,setAge]=useState(""),[motherName,setMotherName]=useState(""),[phone,setPhone]=useState(String(user?.user_metadata?.["phone"]??""));
 const [partnerType,setPartnerType]=useState("content"),[payoutMethod,setPayoutMethod]=useState("unitel_money"),[accountName,setAccountName]=useState(String(user?.user_metadata?.["full_name"]??""));
 const [bankName,setBankName]=useState(""),[iban,setIban]=useState(""),[payoutPhone,setPayoutPhone]=useState(String(user?.user_metadata?.["phone"]??"")),[otherDetails,setOtherDetails]=useState("");
 const [instagram,setInstagram]=useState(""),[tiktok,setTiktok]=useState(""),[facebook,setFacebook]=useState(""),[applicationNotes,setApplicationNotes]=useState(""),[photo,setPhoto]=useState<File|null>(null),[photoPath,setPhotoPath]=useState("");
 const query=useQuery({queryKey:["affiliate-portal",user?.id],enabled:Boolean(user?.id),queryFn:()=>affiliateApi<Portal>("portal.get"),retry:false});
 const profile=query.data?.profile;
 useEffect(()=>{if(!profile)return;setFullName(profile.full_name??"");setAge(String(profile.age??""));setMotherName(profile.mother_name??"");setPhone(profile.whatsapp_phone??String(user?.user_metadata?.["phone"]??""));setPartnerType(profile.partner_type??"content");setPayoutMethod(profile.payout_method??"unitel_money");setAccountName(profile.payout_account_name??profile.full_name??"");setBankName(profile.bank_name??"");setIban(profile.payout_iban??"");setPayoutPhone(profile.payout_phone??profile.whatsapp_phone??"");setOtherDetails(profile.payout_other_details??"");setInstagram(profile.instagram_handle??"");setTiktok(profile.tiktok_handle??"");setFacebook(profile.facebook_url??"");setApplicationNotes(profile.application_notes??"");setPhotoPath(profile.profile_photo_path??"");},[profile,user?.user_metadata?.["phone"]]);
 const application=useMutation({mutationFn:async()=>{
  let uploadedPath=photoPath;
  if(photo){if(!["image/jpeg","image/png","image/webp"].includes(photo.type))throw new Error("Usa uma fotografia JPG, PNG ou WebP.");if(photo.size>5*1024*1024)throw new Error("A fotografia não pode ultrapassar 5 MB.");
   const signed=await affiliateApi<{path:string;token:string}>("photo.upload-url",{mimeType:photo.type});
   const uploaded=await supabase.storage.from("affiliate-photos").uploadToSignedUrl(signed.path,signed.token,photo,{contentType:photo.type,upsert:false});if(uploaded.error)throw new Error("Não foi possível enviar a fotografia.");uploadedPath=signed.path;}
  return affiliateApi("application.submit",{fullName,age,motherName,whatsappPhone:phone,partnerType,payoutMethod,payoutAccountName:accountName,bankName,iban,payoutPhone,otherPayoutDetails:otherDetails,instagram,tiktok,facebook,applicationNotes,profilePhotoPath:uploadedPath});
 },onSuccess:async()=>{toast.success("Candidatura enviada. A equipa irá analisá-la.");setPhoto(null);await client.invalidateQueries({queryKey:["affiliate-portal",user?.id]});},onError:(e:Error)=>toast.error(e.message)});
 const requestPayout=useMutation({mutationFn:()=>affiliateApi("payout.request"),onSuccess:async()=>{toast.success("Pedido enviado para validação manual.");await client.invalidateQueries({queryKey:["affiliate-portal",user?.id]});},onError:(e:Error)=>toast.error(e.message)});
 const link=profile?.referral_code&&typeof window!=="undefined"?window.location.origin+"/auth/registo?ref="+profile.referral_code:"";
 const copyLink=async()=>{try{await navigator.clipboard.writeText(link);toast.success("Link de indicação copiado.");}catch{toast.error("Não foi possível copiar o link. Seleciona-o e copia manualmente.");}};
 return <AppShell title="Programa de parceiros" description="Indica a WHAPPNUS, acompanha comissões e solicita pagamentos após validação.">
  {query.isLoading?<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar a área de parceiros…</div>:null}
  {query.isError?<div className="rounded-xl border border-destructive/30 p-4 text-sm">Não foi possível carregar a área de parceiros. <Button className="ml-2" variant="outline" onClick={()=>void query.refetch()}>Tentar novamente</Button></div>:null}
  {!query.isLoading&&!query.isError&&(!profile||["pending","rejected"].includes(profile.status))?<div className="mx-auto max-w-3xl space-y-5">
   <div className="rounded-2xl border border-border bg-card p-5 sm:p-7"><p className="text-sm font-semibold text-primary">Programa sujeito a aprovação</p><h2 className="mt-2 text-2xl font-bold">Torna-te parceiro da WHAPPNUS</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Preenche a candidatura. Só depois da aprovação terás o link de indicação e acesso às comissões. Os dados de pagamento ficam privados e disponíveis apenas para ti e para a equipa autorizada.</p></div>
   <form className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-7" onSubmit={e=>{e.preventDefault();application.mutate();}}>
    <section className="space-y-4"><h3 className="font-semibold">Dados pessoais</h3><div className="grid gap-4 sm:grid-cols-2">
     <Field label="Nome completo"><Input value={fullName} onChange={e=>setFullName(e.target.value)} required minLength={2} maxLength={160}/></Field>
     <Field label="Idade"><Input type="number" min={18} max={120} value={age} onChange={e=>setAge(e.target.value)} required/><p className="text-xs text-muted-foreground">A participação é reservada a maiores de 18 anos.</p></Field>
     <Field label="Nome da mãe (opcional)"><Input value={motherName} onChange={e=>setMotherName(e.target.value)} maxLength={160}/></Field>
     <Field label="WhatsApp de contacto"><Input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} required placeholder="+244 9xx xxx xxx"/><p className="text-xs text-muted-foreground">Usa o mesmo número associado à tua conta.</p></Field>
     <Field label="Fotografia de perfil (opcional)"><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPhoto(e.target.files?.[0]??null)}/><p className="text-xs text-muted-foreground">JPG, PNG ou WebP, máximo 5 MB.</p></Field>
    </div></section>
    <section className="space-y-4 border-t border-border pt-5"><h3 className="font-semibold">Modalidade de parceria</h3>
     <Field label="Como vais divulgar a WHAPPNUS?"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={partnerType} onChange={e=>setPartnerType(e.target.value)}><option value="content">Influencer / criador de conteúdo</option><option value="commercial">Vendedor / consultor comercial</option><option value="strategic">Agência / parceiro estratégico</option></select></Field>
     <div className="grid gap-4 sm:grid-cols-2"><Field label="Instagram (opcional)"><Input value={instagram} onChange={e=>setInstagram(e.target.value)} maxLength={160}/></Field><Field label="TikTok (opcional)"><Input value={tiktok} onChange={e=>setTiktok(e.target.value)} maxLength={160}/></Field><Field label="Facebook / site (opcional)"><Input value={facebook} onChange={e=>setFacebook(e.target.value)} maxLength={300}/></Field><Field label="Como pretendes divulgar? (opcional)"><Textarea value={applicationNotes} onChange={e=>setApplicationNotes(e.target.value)} maxLength={1000} rows={3}/></Field></div>
    </section>
    <section className="space-y-4 border-t border-border pt-5"><h3 className="font-semibold">Dados para receber comissões</h3>
     <Field label="Método de pagamento"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={payoutMethod} onChange={e=>setPayoutMethod(e.target.value)}><option value="unitel_money">Unitel Money</option><option value="africell_money">Africell Money</option><option value="iban">Transferência bancária (IBAN)</option><option value="other">Outro método</option></select></Field>
     <div className="grid gap-4 sm:grid-cols-2"><Field label="Nome do titular"><Input value={accountName} onChange={e=>setAccountName(e.target.value)} required maxLength={160}/></Field>
      {payoutMethod==="iban"?<><Field label="Banco"><Input value={bankName} onChange={e=>setBankName(e.target.value)} required maxLength={120}/></Field><Field label="IBAN"><Input value={iban} onChange={e=>setIban(e.target.value)} required maxLength={80} autoComplete="off"/></Field></>:null}
      {["unitel_money","africell_money"].includes(payoutMethod)?<Field label="Número da carteira móvel"><Input type="tel" value={payoutPhone} onChange={e=>setPayoutPhone(e.target.value)} required placeholder="+244 9xx xxx xxx"/></Field>:null}
      {payoutMethod==="other"?<Field label="Detalhes do método"><Input value={otherDetails} onChange={e=>setOtherDetails(e.target.value)} required maxLength={300}/></Field>:null}
     </div>
    </section>
    <Button type="submit" disabled={application.isPending} className="w-full">{application.isPending?<><Loader2 className="mr-2 size-4 animate-spin"/>A enviar candidatura…</>:"Enviar candidatura para aprovação"}</Button>
   </form>
  </div>:null}
  {profile?<div className="space-y-5">
   <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4">{query.data?.photoUrl?<img src={query.data.photoUrl} alt="Fotografia do parceiro" className="size-16 rounded-full object-cover"/>:<div className="flex size-16 items-center justify-center rounded-full bg-primary/10"><Users className="size-7 text-primary"/></div>}<div><h2 className="text-xl font-bold">{profile.full_name}</h2><p className="text-sm text-muted-foreground">{profile.partner_type==="content"?"Criador de conteúdo":profile.partner_type==="commercial"?"Parceiro comercial":"Parceiro estratégico"} · Nível {profile.tier}</p><p className="mt-1 text-sm">Estado: <strong>{labels[profile.status]??profile.status}</strong></p></div></div>{profile.status==="approved"?<Button variant="outline" onClick={()=>void copyLink()}><Copy className="mr-2 size-4"/>Copiar link</Button>:null}</div>
   {profile.status==="pending"?<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">A candidatura está a aguardar análise. O link e as comissões serão ativados depois da aprovação.</div>:null}
   {profile.status==="rejected"?<div className="rounded-xl border border-destructive/30 p-4 text-sm">A candidatura foi rejeitada. Motivo: {profile.rejection_reason||"Contacta o suporte para mais informações."}</div>:null}
   {profile.status==="approved"?<>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Clientes indicados" value={String(query.data?.stats.referralCount??0)} icon={<Users className="size-4"/>}/><Metric label="Comissões pendentes" value={money(query.data?.stats.pending)} icon={<Clock3 className="size-4"/>}/><Metric label="Saldo disponível" value={money(query.data?.stats.available)} icon={<Wallet className="size-4"/>}/><Metric label="Total pago" value={money(query.data?.stats.totalPaid)} icon={<CheckCircle2 className="size-4"/>}/></div>
    <div className="rounded-2xl border border-border bg-card p-5"><h3 className="font-semibold">O teu link exclusivo</h3><p className="mt-1 text-sm text-muted-foreground">Partilha este link. A indicação é associada à conta criada através dele.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input readOnly value={link} aria-label="Link de indicação"/><Button onClick={()=>void copyLink()}><Copy className="mr-2 size-4"/>Copiar link</Button></div><p className="mt-3 text-xs text-muted-foreground">Podes solicitar o levantamento a partir de 10.000 Kz de saldo aprovado e disponível. Os pagamentos são validados e efetuados manualmente.</p><Button className="mt-4" onClick={()=>requestPayout.mutate()} disabled={requestPayout.isPending||Number(query.data?.stats.available??0)<10000}>{requestPayout.isPending?<Loader2 className="mr-2 size-4 animate-spin"/>:<Wallet className="mr-2 size-4"/>}Solicitar pagamento</Button></div>
    <div className="grid gap-5 xl:grid-cols-2"><History title="Histórico de comissões" rows={query.data?.commissions??[]} commission/><History title="Pedidos de pagamento" rows={query.data?.payouts??[]}/></div>
   </>:null}
   {profile.status==="suspended"?<div className="rounded-xl border border-destructive/30 p-4 text-sm">A participação está suspensa. Contacta a equipa de suporte.</div>:null}
  </div>:null}
 </AppShell>;
}
function Field({label,children}:{label:string;children:ReactNode}){return <div className="space-y-2"><Label>{label}</Label>{children}</div>}
function Metric({label,value,icon}:{label:string;value:string;icon:ReactNode}){return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span>{icon}</div><p className="mt-2 text-xl font-bold">{value}</p></div>}
function History({title,rows,commission=false}:{title:string;rows:any[];commission?:boolean}){return <div className="rounded-2xl border border-border bg-card p-5"><h3 className="font-semibold">{title}</h3><div className="mt-3 space-y-3">{rows.length?rows.map((r:any)=><div key={r.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 text-sm last:border-0"><div><p className="font-medium">{commission?(r.commission_type==="initial"?"Comissão inicial":"Comissão de renovação")+" · "+r.plan_code:new Date(r.requested_at).toLocaleDateString("pt-AO")}</p><p className="text-xs text-muted-foreground">{new Date(commission?r.created_at:r.requested_at).toLocaleDateString("pt-AO")} · {labels[r.status]??r.status}{r.payment_reference?" · Ref. "+r.payment_reference:""}</p></div><strong>{money(r.amount_aoa)}</strong></div>):<p className="text-sm text-muted-foreground">Ainda não existem registos.</p>}</div></div>}
