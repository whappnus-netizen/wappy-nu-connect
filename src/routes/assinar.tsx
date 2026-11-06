import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";

const plans = {
  "start-monthly": {
    code: "start-monthly",
    name: "WHAPPNUS Start",
    price: "5.000",
    checkoutUrl: "https://pay.kursinha.com/c/6aca37f7bad1248c97213091",
    description: "Para começar a atender com método.",
    benefits: ["1 número WhatsApp", "1 agente IA", "1.500 mensagens com IA/mês", "2 automações activas", "Inbox, contactos e CRM"],
  },
  "pro-monthly": {
    code: "pro-monthly",
    name: "WHAPPNUS Pro",
    price: "10.000",
    checkoutUrl: "https://pay.kursinha.com/c/6aca8c46e62b25eb5a5f9df3",
    description: "Para equipas em crescimento.",
    benefits: ["2 números WhatsApp", "2 agentes IA", "4.000 mensagens com IA/mês", "5 automações activas", "Até 3 membros adicionais"],
  },
  "premium-monthly": {
    code: "premium-monthly",
    name: "WHAPPNUS Premium",
    price: "20.000",
    checkoutUrl: "https://pay.kursinha.com/c/6acc80e79db7fbd07069b6e0",
    description: "Para operações com maior volume.",
    benefits: ["4 números WhatsApp", "4 agentes IA", "10.000 mensagens com IA/mês", "15 automações activas", "Até 9 membros adicionais"],
  },
} as const;

type PlanCode = keyof typeof plans;

export const Route = createFileRoute("/assinar")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search["plan"] === "string" ? search["plan"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Finalizar assinatura — WHAPPNUS" },
      { name: "description", content: "Conclua o pagamento do seu plano WHAPPNUS e crie a sua conta." },
    ],
  }),
  component: CheckoutHandoffPage,
});

function CheckoutHandoffPage() {
  const { plan: requestedPlan } = Route.useSearch();
  const plan = plans[requestedPlan as PlanCode];
  const [checkoutOpened, setCheckoutOpened] = useState(false);

  if (!plan) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f7f4] px-4 py-12">
        <section className="w-full max-w-lg rounded-3xl border border-[#dce8df] bg-white p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-[#123b25]">Plano não encontrado</h1>
          <p className="mt-3 text-sm text-[#5d6d62]">Volte aos preços e escolha um dos três planos disponíveis.</p>
          <a href="/#planos" className="mt-6 inline-flex rounded-full bg-[#147a43] px-6 py-3 font-semibold text-white">Ver planos</a>
        </section>
      </main>
    );
  }

  function openCheckout() {
    const opened = window.open(plan.checkoutUrl, "_blank");
    if (!opened) {
      window.location.assign(plan.checkoutUrl);
      return;
    }
    // Keep the checkout in a separate tab without exposing the opener window.
    opened.opener = null;
    setCheckoutOpened(true);
  }

  return (
    <main className="min-h-screen bg-[#f3f7f4] px-4 py-10 text-[#14291c] sm:py-16">
      <div className="mx-auto max-w-3xl">
        <a href="/#planos" className="inline-flex items-center gap-2 text-sm font-medium text-[#41604c] hover:text-[#08783c]">
          <ArrowLeft size={16} /> Voltar aos planos
        </a>
        <section className="mt-6 overflow-hidden rounded-3xl border border-[#d9e7dd] bg-white shadow-[0_24px_80px_rgba(20,60,35,.10)]">
          <div className="bg-[#071b12] px-7 py-8 text-white sm:px-10">
            <span className="text-xs font-semibold uppercase tracking-[.22em] text-[#80e5a7]">Assinatura WHAPPNUS</span>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Está a um passo de começar.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Pague o plano escolhido na Kursinha. Depois, crie a sua conta WHAPPNUS com o mesmo e-mail utilizado no checkout.</p>
          </div>
          <div className="grid gap-8 p-7 sm:grid-cols-[1fr_1.1fr] sm:p-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#64816d]">Plano seleccionado</p>
              <h2 className="mt-2 text-2xl font-bold">{plan.name}</h2>
              <p className="mt-2 text-sm text-[#66776b]">{plan.description}</p>
              <p className="mt-6 text-4xl font-extrabold tracking-tight">{plan.price} <span className="text-base font-semibold text-[#637568]">Kz/mês</span></p>
              <ul className="mt-6 space-y-3">
                {plan.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2 text-sm text-[#405448]">
                    <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#119653]" /> {benefit}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[#dce9e0] bg-[#f7faf8] p-5 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#17643a]"><ShieldCheck size={18} /> Pagamento e activação seguros</div>
              <ol className="mt-5 space-y-4 text-sm leading-6 text-[#4e6255]">
                <li><b className="text-[#183c27]">1. Pague na Kursinha.</b><br />O checkout recolhe o seu e-mail e os dados de pagamento.</li>
                <li><b className="text-[#183c27]">2. Volte a esta página.</b><br />A confirmação chega automaticamente à WHAPPNUS através do webhook.</li>
                <li><b className="text-[#183c27]">3. Crie a sua conta.</b><br />Use exactamente o mesmo e-mail do checkout e confirme-o.</li>
                <li><b className="text-[#183c27]">4. Configure a empresa.</b><br />Crie a organização; activaremos o plano quando a confirmação estiver validada.</li>
              </ol>
              <button type="button" onClick={openCheckout} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#087b42] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-[#087b42]/20 transition hover:-translate-y-0.5 hover:bg-[#066a38]">
                {checkoutOpened ? "Abrir checkout novamente" : "Pagar com Kursinha"} <ExternalLink size={16} />
              </button>
              {checkoutOpened ? (
                <p role="status" className="mt-3 text-xs leading-5 text-[#52705c]">O checkout abriu noutro separador. Depois de concluir o pagamento, volte aqui para continuar.</p>
              ) : null}
            </div>
          </div>
          <div className="border-t border-[#e3ece6] px-7 py-6 text-center sm:px-10">
            <p className="text-sm font-semibold text-[#1c3e2a]">Já concluiu o pagamento?</p>
            <p className="mt-1 text-xs leading-5 text-[#6a7b70]">Continue com o mesmo e-mail usado na Kursinha. O acesso pago só será libertado após a confirmação automática.</p>
            <a href={`/auth/registo?plan=${encodeURIComponent(plan.code)}`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-[#e5f4e9] px-6 py-3 text-sm font-bold text-[#086b39] transition hover:bg-[#d4eddd]">
              Já paguei — criar conta
            </a>
            <p className="mt-3 text-xs text-[#718176]">Já tem conta? <a className="font-semibold text-[#087b42] underline" href={`/auth/login?plan=${encodeURIComponent(plan.code)}`}>Entrar para associar a compra</a></p>
          </div>
        </section>
      </div>
    </main>
  );
}
