import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Check, CreditCard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";

type UpgradeData = {
  currentPlan: { code: string; name: string; price_aoa: number; status: string } | null;
  options: Array<{ code: string; name: string; description: string; price_aoa: number; checkout_url: string }>;
};

const money = (value: number) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(value);
const planStatus: Record<string, string> = { active: "Ativo", trialing: "Teste gratuito", expired: "Expirado", suspended: "Suspenso" };
const featuresFor = (code: string) => {
  const key = code.toLowerCase();
  if (key.includes("premium") || key.includes("45")) return ["4 números WhatsApp", "4 agentes IA", "10.000 conversas com IA/mês", "15 automações activas", "Até 9 membros adicionais", "Inbox, CRM e ferramentas essenciais"];
  if (key.includes("pro") || key.includes("25")) return ["2 números WhatsApp", "2 agentes IA", "4.000 conversas com IA/mês", "5 automações activas", "Até 3 membros adicionais", "Inbox, CRM e ferramentas essenciais"];
  return ["1 número WhatsApp", "1 agente IA", "1.500 conversas com IA/mês", "2 automações activas", "1 membro adicional", "Inbox, CRM e ferramentas essenciais"];
};

export function BillingUpgradePanel({ organizationId }: { organizationId: string | undefined }) {
  const [showPlans, setShowPlans] = useState(false);
  const query = useQuery({
    queryKey: ["billing-plan-options", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("billing-api", { body: { action: "plans.available", organization_id: organizationId } });
      if (error) throw new Error(error.message || "Não foi possível consultar os planos.");
      if (!data?.ok) throw new Error(data?.error ?? "Não foi possível consultar os planos disponíveis.");
      return data.data as UpgradeData;
    },
  });
  const current = query.data?.currentPlan;
  const isTrial = current?.status === "trialing" || current?.price_aoa === 0 || Boolean(current?.code.toLowerCase().includes("trial") || current?.code.toLowerCase().includes("free"));

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card p-5 shadow-sm sm:p-6 lg:col-span-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CreditCard className="size-5" /></div>
          <div>
            <h2 className="font-display text-base font-semibold">O seu plano WHAPPNUS</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{isTrial ? "Está a experimentar a plataforma. Escolha o plano que acompanha o próximo passo do seu negócio." : "Consulte a sua assinatura e escolha outro plano se precisar de mais capacidade."}</p>
            {current ? <div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline">{current.name}</Badge><Badge variant={current.status === "active" ? "default" : "secondary"}>{planStatus[current.status] ?? current.status}</Badge><span className="text-sm font-semibold">{money(current.price_aoa)}{current.price_aoa > 0 ? <span className="font-normal text-muted-foreground"> / mês</span> : null}</span></div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} size="sm"><RefreshCw className={query.isFetching ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />Actualizar estado</Button>
          {!showPlans && <Button type="button" onClick={() => setShowPlans(true)} disabled={query.isLoading} className="rounded-full px-5">{isTrial ? "Actualizar plano" : "Ver planos"} <ArrowUpRight className="ml-2 size-4" /></Button>}
        </div>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">A consultar os planos disponíveis…</p> : null}
      {query.error ? <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{(query.error as Error).message}</p> : null}
      {showPlans && query.data?.options?.length ? <div className="mt-6 border-t border-border pt-5"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h3 className="text-lg font-semibold">Escolha o seu próximo plano</h3><p className="mt-1 text-sm text-muted-foreground">Todos os preços são mensais e cobrados em Kwanza (Kz).</p></div><Button type="button" variant="ghost" size="sm" onClick={() => setShowPlans(false)}>Fechar planos</Button></div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {query.data.options.map((plan) => {
            const featured = plan.code.toLowerCase().includes("pro") || plan.code.toLowerCase().includes("25");
            return <article key={plan.code} className={`flex flex-col rounded-2xl border bg-background p-5 ${featured ? "border-primary ring-1 ring-primary/20 shadow-md shadow-primary/5" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2"><h4 className="font-semibold">{plan.name}</h4>{featured ? <Badge>Mais escolhido</Badge> : <Badge variant="outline">{plan.code.toLowerCase().includes("premium") || plan.code.includes("45") ? "Premium" : "Plano mensal"}</Badge>}</div>
              <p className="mt-4 text-2xl font-semibold tracking-tight">{money(plan.price_aoa)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ mês</span></p>
              <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">{plan.description}</p>
              <ul className="mt-5 flex-1 space-y-3">{featuresFor(plan.code).map(feature => <li key={feature} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span>{feature}</span></li>)}</ul>
              <Button type="button" className="mt-6 w-full rounded-full" variant={featured ? "default" : "outline"} onClick={() => {
                if (!plan.checkout_url.startsWith("https://pay.kursinha.com/")) { toast.error("O endereço de pagamento não passou na validação."); return; }
                window.open(plan.checkout_url, "_blank", "noopener,noreferrer");
              }}>Escolher plano <ArrowUpRight className="ml-2 size-4" /></Button>
            </article>;
          })}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Depois de pagar, a WHAPPNUS actualiza a assinatura quando a Kursinha confirmar a transacção. Não partilhe dados de pagamento por mensagem.</p>
      </div> : null}
      {showPlans && query.data && !query.data.options.length ? <p className="mt-4 text-sm text-muted-foreground">Não há planos disponíveis neste momento. Contacte o suporte.</p> : null}
    </section>
  );
}
