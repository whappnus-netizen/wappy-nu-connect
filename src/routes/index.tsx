import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MessagesSquare,
  Smartphone,
  KanbanSquare,
  Workflow,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/app-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WhappNus" },
      {
        name: "description",
        content:
          "Centralize o WhatsApp da sua empresa: multiatendimento, CRM, automações e IA numa só plataforma feita para Angola.",
      },
      { property: "og:title", content: "WhappNus" },
      {
        property: "og:description",
        content: "Centralize o WhatsApp da sua empresa: multiatendimento, CRM, automações e IA numa só plataforma feita para Angola.",
      },
    ],
  }),
  component: Landing,
});

const modules = [
  { icon: Smartphone, title: "Ligação WhatsApp", text: "Ligue números através da Cloud API da Meta ou por QR Code, conforme o método disponível." },
  { icon: MessagesSquare, title: "Multiatendimento", text: "Vários agentes na mesma caixa de entrada, com filas, etiquetas, prioridade e transferência." },
  { icon: KanbanSquare, title: "CRM", text: "Leads, oportunidades e pipeline em Kanban, com valor potencial em Kwanza (AOA)." },
  { icon: Workflow, title: "Automações", text: "Regras QUANDO → SE → ENTÃO para respostas fora do expediente, etiquetas e atribuições." },
  { icon: Sparkles, title: "IA", text: "Sugestão de respostas, resumo e classificação de conversas, com chaves guardadas no servidor." },
  { icon: ShieldCheck, title: "Multiempresa seguro", text: "Isolamento total por organização com Row Level Security no PostgreSQL." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth/login">Entrar</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth/registo">Criar conta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-brand-gradient opacity-[0.07]" />
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              Feito para empresas de Angola
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              O WhatsApp da sua empresa, finalmente organizado.
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted-foreground">
              WhappNus centraliza o atendimento, organiza os contactos e automatiza respostas — sobre a
              infraestrutura oficial do WhatsApp Business Platform.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth/registo">
                  Começar agora <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth/login">Já tenho conta</Link>
              </Button>
            </div>
            <ul className="mt-8 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {["Vários agentes, um número", "Pipeline comercial em AOA", "Automação sem código", "Dados isolados por empresa"].map((i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> {i}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-lift">
            <div className="rounded-xl bg-brand-gradient p-5 text-primary-foreground">
              <p className="text-xs uppercase tracking-widest opacity-80">Caixa de entrada</p>
              <p className="mt-2 font-display text-2xl font-semibold">Atendimento unificado</p>
            </div>
            <div className="mt-5 space-y-3">
              {["Conversas abertas", "Em atendimento", "Pendentes"].map((label) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="font-display text-sm font-semibold text-muted-foreground">—</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Métricas reais aparecem assim que ligar o seu número WhatsApp.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24">
        <h2 className="text-2xl font-bold">O núcleo da Fase 1</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.title} className="rounded-xl border border-border bg-card p-5 shadow-soft">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <m.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{m.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="planos" className="border-y border-border bg-card/40 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Planos transparentes</span>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Comece pequeno. Cresça com o seu negócio.</h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">Preços em Kwanza, limites claros e as ferramentas essenciais num só lugar. Sem cartão bancário para experimentar.</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {name:"Teste grátis",price:"0",period:"7 dias",description:"Experimente antes de investir.",featured:false,items:["1 WhatsApp + 1 agente IA","Até 150 conversas com IA no teste","Até 2 automações","Acesso ao Inbox, CRM e contactos","Sem cartão bancário"]},
              {name:"WhappNus Start",price:"10.000",period:"/ mês",description:"Para começar a automatizar o atendimento.",featured:false,items:["1 WhatsApp + 1 agente IA","Até 1.500 conversas com IA / mês","Até 2 automações activas","1 membro adicional na equipa","Dashboard, Inbox, CRM e IA"]},
              {name:"WhappNus Pro",price:"25.000",period:"/ mês",description:"Mais capacidade para equipas em crescimento.",featured:true,items:["2 WhatsApps + 2 agentes IA","Até 4.000 conversas com IA / mês","Até 5 automações activas","Até 3 membros adicionais","Todas as ferramentas essenciais"]},
              {name:"WhappNus Premium",price:"45.000",period:"/ mês",description:"Para operações com maior volume.",featured:false,items:["4 WhatsApps + 4 agentes IA","Até 10.000 conversas com IA / mês","Até 15 automações activas","Até 9 membros adicionais","Todas as ferramentas essenciais"]},
            ].map((plan) => (
              <div key={plan.name} className={`relative flex flex-col rounded-2xl border bg-background p-5 shadow-soft ${plan.featured ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                {plan.featured && <span className="mb-3 self-start rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">Mais escolhido</span>}
                <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-5 flex items-baseline gap-1"><span className="text-3xl font-bold tracking-tight">{plan.price}</span><span className="text-xs text-muted-foreground">Kz {plan.period}</span></div>
                <ul className="mt-6 flex-1 space-y-3">
                  {plan.items.map((item) => <li key={item} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span>{item}</span></li>)}
                </ul>
                <Button asChild className="mt-7 w-full" variant={plan.featured ? "default" : "outline"}>
                  <Link to="/auth/registo">{plan.price === "0" ? "Experimentar grátis" : "Começar agora"} <ArrowRight className="size-4" /></Link>
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">As conversas e os recursos são contabilizados por organização. Os dados e o histórico permanecem guardados quando uma assinatura expira.</p>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Logo className="text-base" />
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-foreground">Termos</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacidade</Link>
            <Link to="/deletion" className="hover:text-foreground">Eliminar dados</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
