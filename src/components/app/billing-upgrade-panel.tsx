import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, CreditCard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";

type UpgradeData = {
  currentPlan: { code: string; name: string; price_aoa: number; status: string } | null;
  options: Array<{ code: string; name: string; description: string; price_aoa: number; checkout_url: string }>;
};

const money = (value: number) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(value);
const planStatus: Record<string, string> = { active: "Ativo", trialing: "Em teste", expired: "Expirado", suspended: "Suspenso" };

export function BillingUpgradePanel({ organizationId }: { organizationId: string | undefined }) {
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

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-5 lg:col-span-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CreditCard className="size-5" /></div>
          <div>
            <h2 className="font-display text-sm font-semibold">Assinatura e atualização do plano</h2>
            <p className="mt-1 text-sm text-muted-foreground">Escolhe um plano superior. A WHAPPNUS atualiza a assinatura depois de a Kursinha confirmar o pagamento.</p>
            {query.data?.currentPlan ? <p className="mt-2 text-sm font-medium">Plano atual: {query.data.currentPlan.name} · {money(query.data.currentPlan.price_aoa)} · {planStatus[query.data.currentPlan.status] ?? query.data.currentPlan.status}</p> : null}
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching} className="shrink-0">
          <RefreshCw className={query.isFetching ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />Atualizar estado
        </Button>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">A consultar os planos disponíveis…</p> : null}
      {query.error ? <p role="alert" className="mt-4 text-sm text-destructive">{(query.error as Error).message}</p> : null}
      {query.data?.options?.length ? <div className="mt-4 grid gap-3 md:grid-cols-3">
        {query.data.options.map((plan) => <div key={plan.code} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{plan.name}</h3><Badge variant="outline">{plan.code.toLowerCase().includes("premium") ? "Premium" : plan.code.toLowerCase().includes("pro") ? "Pro" : "Plano"}</Badge></div>
          <p className="mt-2 text-xl font-bold">{money(plan.price_aoa)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ mês</span></p>
          <p className="mt-2 min-h-10 text-xs text-muted-foreground">{plan.description}</p>
          <Button type="button" className="mt-4 w-full" onClick={() => {
            if (!plan.checkout_url.startsWith("https://pay.kursinha.com/")) { toast.error("O endereço de pagamento não passou na validação."); return; }
            window.open(plan.checkout_url, "_blank", "noopener,noreferrer");
          }}>Atualizar plano <ArrowUpRight className="ml-2 size-4" /></Button>
        </div>)}
      </div> : null}
      {query.data && !query.data.options.length ? <p className="mt-4 text-sm text-muted-foreground">Não há planos superiores disponíveis neste momento. Se pretendes alterar a assinatura, contacta o suporte.</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">O pagamento é processado fora da WHAPPNUS. Mantém esta página aberta: o estado é consultado automaticamente e só muda depois da confirmação do pagamento.</p>
    </section>
  );
}
