import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Check, CreditCard, Loader2, ShieldCheck } from "lucide-react";

export const Route=createFileRoute("/_authenticated/planos")({
 head:()=>({meta:[{title:"Atualizar plano — WhappNus"}]}),
 component:UpgradePlansPage,
});
type UpgradeData={currentPlan:{code:string;name:string;price_aoa:number;status:string}|null;options:{code:string;name:string;description:string;price_aoa:number;billing_interval:string;features:Record<string,unknown>;limits:Record<string,unknown>;checkout_url:string}[]};
function UpgradePlansPage(){
 const query=useQuery({queryKey:["available-plan-upgrades"],queryFn:async()=>{
  const {data,error}=await supabase.functions.invoke("billing-api",{body:{action:"plans.available"}});
  if(error)throw new Error(error.message||"Não foi possível carregar os planos.");
  if(!data?.ok)throw new Error(data?.error||"Não foi possível carregar os planos.");
  return data.data as UpgradeData;
 },retry:false,refetchOnWindowFocus:true});
 const openCheckout=(url:string)=>{if(!url.startsWith("https://pay.kursinha.com/")){toast.error("O endereço de pagamento não é válido. Contacta o suporte.");return;}window.location.assign(url);};
 return <AppShell title="Atualizar plano" description="Escolhe o plano adequado à tua operação. A assinatura só muda depois da confirmação do pagamento pela Kursinha.">
  {query.isLoading?<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>A carregar os planos disponíveis…</div>:null}
  {query.isError?<div className="rounded-xl border border-destructive/30 p-4 text-sm"><p>{(query.error as Error).message}</p><Button className="mt-3" variant="outline" onClick={()=>void query.refetch()}>Tentar novamente</Button></div>:null}
  {query.data?<div className="space-y-5">
   <div className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Plano atual</p><div className="mt-1 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{query.data.currentPlan?.name??"Plano gratuito / teste"}</h2><p className="mt-1 text-sm text-muted-foreground">{Number(query.data.currentPlan?.price_aoa??0).toLocaleString("pt-AO")} Kz por mês</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{query.data.currentPlan?.status==="trialing"?"Teste grátis":query.data.currentPlan?.status==="active"?"Ativo":"A confirmar"}</span></div></div>
   {query.data.options.length?<div className="grid gap-4 lg:grid-cols-2">{query.data.options.map((p)=> <section key={p.code} className={"flex flex-col rounded-2xl border bg-card p-5 "+(p.code==="premium-monthly"?"border-primary/50 shadow-soft":"border-border")}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{p.name}</h3><p className="mt-1 text-sm text-muted-foreground">{p.description}</p></div>{p.code==="premium-monthly"?<span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Mais completo</span>:null}</div>
    <p className="mt-5 text-3xl font-bold">{Number(p.price_aoa).toLocaleString("pt-AO")} <span className="text-sm font-medium text-muted-foreground">Kz / mês</span></p>
    <div className="mt-4 flex-1 space-y-2">{Object.entries(p.features??{}).filter(([,v])=>v===true).map(([key])=><div key={key} className="flex items-center gap-2 text-sm"><Check className="size-4 text-primary"/>{({ai:"Atendimento com IA",integrations:"Integrações WhatsApp",automations:"Automações",crm:"CRM",campaigns:"Campanhas",analytics:"Relatórios",team:"Gestão de equipa"} as Record<string,string>)[key]??key.replace(/_/g," ")}</div>)}</div>
    <Button className="mt-6 w-full" onClick={()=>openCheckout(p.checkout_url)}><CreditCard className="mr-2 size-4"/>Atualizar para {p.name}</Button>
   </section>)}</div>:<div className="rounded-xl border border-border bg-card p-6"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary"/>Já estás no plano mais alto disponível.</div><p className="mt-2 text-sm text-muted-foreground">Se precisares de alterar a tua assinatura ou tens um pagamento por confirmar, contacta o suporte.</p></div>}
   <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Importante: conclui o pagamento usando o mesmo e-mail da tua conta WHAPPNUS. A Kursinha confirma a venda através do webhook e o painel atualiza a assinatura automaticamente após a confirmação. Não é necessário enviar comprovativo por WhatsApp.</div>
  </div>:null}
 </AppShell>;
}