import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useSubscriptionAccess } from "@/lib/subscription";

export const Route = createFileRoute("/_authenticated/assinatura")({
  component: SubscriptionPage,
});

const plans = [
  { code: "start-monthly", name: "WHAPPNUS Start", price: 5000, checkout: "https://pay.kursinha.com/c/6aca37f7bad1248c97213091", description: "Para começar a atender com método." },
  { code: "pro-monthly", name: "WHAPPNUS Pro", price: 10000, checkout: "https://pay.kursinha.com/c/6aca8c46e62b25eb5a5f9df3", description: "Para equipas em crescimento." },
  { code: "premium-monthly", name: "WHAPPNUS Premium", price: 20000, checkout: "https://pay.kursinha.com/c/6acc80e79db7fbd07069b6e0", description: "Para operações com maior volume." },
];
const money = (amount: number) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(amount);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("pt-AO", { dateStyle: "long", timeZone: "Africa/Luanda" }).format(new Date(value)) : "Sem data definida";

function SubscriptionPage() {
  const { user, membership } = useAuth();
  const subscription = useSubscriptionAccess(membership?.organization_id);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const currentCode = subscription.data?.planCode ?? "";
  const active = subscription.active;
  const currentEnd = subscription.data?.currentPeriodEnd ?? null;

  async function refreshStatus() {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["subscription-access", membership?.organization_id] });
    setRefreshing(false);
  }

  return (
    <AppShell title="Assinatura" description="Consulta o teu plano, validade e opções de renovação.">
      <div className="mx-auto max-w-5xl space-y-6">
        <div><h2 className="text-xl font-semibold">A tua assinatura WHAPPNUS</h2><p className="mt-1 text-sm text-muted-foreground">Renova antes do fim do período para manter a IA, as automações e o atendimento disponíveis.</p></div>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div><CardTitle>{subscription.data?.planName ?? "A carregar plano…"}</CardTitle><CardDescription>Conta: {user?.email ?? "—"} · Organização: {membership?.organizations?.name ?? "—"}</CardDescription></div>
            <Badge variant={active ? "default" : "destructive"}>{subscription.isLoading ? "A verificar" : active ? "Activa" : "Atenção necessária"}</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Estado</p><p className="mt-1 font-semibold">{subscription.data?.status === "trialing" ? "Teste gratuito" : subscription.data?.status === "active" ? "Plano pago activo" : subscription.data?.status ?? "Não identificado"}</p></div>
            <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Valor actual</p><p className="mt-1 font-semibold">{money(subscription.data?.priceAoa ?? 0)}</p></div>
            <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Válido até</p><p className="mt-1 font-semibold">{date(currentEnd)}</p></div>
          </CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="size-4" />A data de validade só muda após a confirmação do pagamento pela Kursinha.</p>
            <Button variant="outline" size="sm" onClick={refreshStatus} disabled={refreshing}>{refreshing ? "A actualizar…" : "Actualizar estado"}</Button>
          </div>
        </Card>

        <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <div><p className="text-sm font-semibold">Como funciona a renovação?</p><p className="mt-1 text-sm text-muted-foreground">Escolhe o plano, paga no checkout Kursinha usando exactamente este e-mail ({user?.email ?? "da tua conta"}) e aguarda a confirmação automática. O webhook associa a compra à tua organização e actualiza o período. Não precisas de criar outra conta nem outra organização.</p></div>
        </div>

        <section className="space-y-3">
          <div><h3 className="text-lg font-semibold">Renovar ou mudar de plano</h3><p className="text-sm text-muted-foreground">Podes manter o plano actual ou escolher outro. A confirmação é feita exclusivamente pelo webhook seguro da Kursinha.</p></div>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map(plan => {
              const current = currentCode === plan.code;
              return <Card key={plan.code} className={current ? "border-primary shadow-sm" : ""}>
                <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="text-base">{plan.name}</CardTitle>{current && <Badge>Plano actual</Badge>}</div><CardDescription>{plan.description}</CardDescription><p className="pt-2 text-2xl font-bold">{money(plan.price)}<span className="text-xs font-normal text-muted-foreground"> / mês</span></p></CardHeader>
                <CardContent><ul className="mb-4 space-y-2 text-xs text-muted-foreground"><li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-primary" />Pagamento seguro via Kursinha</li><li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-primary" />Activação automática após confirmação</li><li className="flex items-center gap-2"><CheckCircle2 className="size-3 text-primary" />Sem criar nova conta</li></ul><Button asChild className="w-full" variant={current ? "default" : "outline"}><a href={plan.checkout} target="_blank" rel="noopener noreferrer"><CreditCard className="mr-2 size-4" />{current ? "Renovar este plano" : "Escolher este plano"}<ExternalLink className="ml-2 size-3" /></a></Button></CardContent>
              </Card>;
            })}
          </div>
        </section>
        <p className="text-xs text-muted-foreground">Importante: utiliza o mesmo e-mail de acesso à WHAPPNUS no checkout. Se o pagamento não for associado automaticamente, não repitas o pagamento; abre um ticket na área Suporte e envia a referência da compra.</p>
      </div>
    </AppShell>
  );
}
