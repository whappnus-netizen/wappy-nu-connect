import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight, ArrowUpRight, Bot, Check, ChevronDown, CircleCheck,
  Globe2, MessageCircle, MessagesSquare, ShieldCheck, Smartphone,
  Sparkles, Users, Workflow, KanbanSquare, Zap, Clock3, Menu,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/app/app-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WHAPPNUS — Inteligência que atende, organiza e vende" },
      { name: "description", content: "Transforme o WhatsApp da sua empresa num canal organizado de atendimento e vendas. Atendimento em equipa, CRM e assistente inteligente, com planos em Kwanza." },
      { property: "og:title", content: "WHAPPNUS — Inteligência que atende, organiza e vende" },
      { property: "og:description", content: "Atendimento, organização comercial e automação WhatsApp numa única plataforma feita para negócios angolanos." },
    ],
  }),
  component: Landing,
});

const modules = [
  { icon: MessagesSquare, number: "01", title: "Uma caixa de entrada para toda a equipa", text: "Centralize as conversas, distribua atendimentos e saiba quem está a acompanhar cada cliente." },
  { icon: Bot, number: "02", title: "Um assistente que conhece o seu negócio", text: "Configure instruções e contexto para ajudar a responder com consistência, sem perder o controlo." },
  { icon: KanbanSquare, number: "03", title: "Transforme conversas em oportunidades", text: "Organize contactos, acompanhe cada oportunidade e mantenha o próximo passo sempre visível." },
  { icon: Workflow, number: "04", title: "Automatize o trabalho repetitivo", text: "Crie regras para organizar conversas e acelerar tarefas sem acrescentar complexidade à equipa." },
  { icon: Users, number: "05", title: "Saiba quem está a fazer o quê", text: "Atribuições e histórico ajudam a equipa a trabalhar com responsabilidade e continuidade." },
  { icon: ShieldCheck, number: "06", title: "A estrutura da sua empresa, protegida", text: "Cada organização trabalha no seu próprio espaço, com permissões e acesso controlado." },
];

const plans = [
  { name: "Start", price: "10.000", description: "Para começar a atender com método.", features: ["1 número WhatsApp", "1 agente IA", "1.500 conversas com IA/mês", "2 automações activas", "Inbox, contactos e CRM"], featured: false },
  { name: "Pro", price: "25.000", description: "Para equipas em crescimento.", features: ["2 números WhatsApp", "2 agentes IA", "4.000 conversas com IA/mês", "5 automações activas", "Até 3 membros adicionais"], featured: true },
  { name: "Premium", price: "45.000", description: "Para operações com maior volume.", features: ["4 números WhatsApp", "4 agentes IA", "10.000 conversas com IA/mês", "15 automações activas", "Até 9 membros adicionais"], featured: false },
];

function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" aria-label="WHAPPNUS — início"><Logo /></Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a className="transition hover:text-foreground" href="#plataforma">Plataforma</a>
            <a className="transition hover:text-foreground" href="#como-funciona">Como funciona</a>
            <a className="transition hover:text-foreground" href="#planos">Planos</a>
            <a className="transition hover:text-foreground" href="#angola">Feita para Angola</a>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Button asChild variant="ghost"><Link to="/auth/login">Entrar</Link></Button>
            <Button asChild className="rounded-full px-5 shadow-sm"><Link to="/auth/registo">Criar conta <ArrowRight className="ml-2 size-4" /></Link></Button>
          </div>
          <button type="button" aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} className="inline-flex size-10 items-center justify-center rounded-xl border border-border md:hidden"><Menu className="size-5" /></button>
        </div>
        {mobileOpen && <nav className="grid gap-1 border-t border-border bg-background px-5 py-4 md:hidden">
          {[["Plataforma","#plataforma"],["Como funciona","#como-funciona"],["Planos","#planos"],["Feita para Angola","#angola"]].map(([label,href]) => <a key={href} href={href} onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-3 text-sm hover:bg-muted">{label}</a>)}
          <Button asChild className="mt-2 rounded-full"><Link to="/auth/registo">Criar conta grátis</Link></Button>
          <Button asChild variant="outline" className="rounded-full"><Link to="/auth/login">Entrar</Link></Button>
        </nav>}
      </header>

      <section className="relative isolate">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_15%_20%,hsl(var(--primary)/0.15),transparent_42%),radial-gradient(ellipse_at_90%_10%,hsl(var(--primary)/0.08),transparent_34%)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10 lg:py-24">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-2 text-xs font-semibold text-primary sm:text-sm"><span className="size-2 rounded-full bg-primary" /> Atendimento inteligente. Relações que crescem.</div>
            <h1 className="mt-7 text-[2.65rem] font-semibold leading-[1.04] tracking-[-0.055em] sm:text-6xl lg:text-[4.35rem]">Transforme o seu WhatsApp num <span className="text-primary">poderoso canal de venda.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Atenda melhor, organize cada oportunidade e responda com mais consistência — numa plataforma feita para a realidade das empresas angolanas.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-full px-6 text-sm shadow-lg shadow-primary/15"><Link to="/auth/registo">Começar gratuitamente <ArrowRight className="ml-2 size-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6"><a href="#plataforma">Conhecer a plataforma <ChevronDown className="ml-2 size-4" /></a></Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-sm">
              {["Teste grátis de 7 dias", "Planos em Kwanza", "Sem cartão bancário para começar"].map(item => <span key={item} className="inline-flex items-center gap-1.5"><CircleCheck className="size-4 text-primary" />{item}</span>)}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[590px] lg:ml-auto">
            <div className="absolute -right-5 top-8 h-52 w-52 rounded-full bg-primary/15 blur-3xl" />
            <div className="absolute -bottom-4 left-4 h-44 w-44 rounded-full bg-emerald-300/15 blur-3xl" />
            <div className="relative rounded-[28px] border border-border/80 bg-card/90 p-3 shadow-2xl shadow-emerald-950/10 backdrop-blur sm:p-4">
              <div className="flex items-center justify-between border-b border-border px-3 pb-4 pt-2">
                <div className="flex items-center gap-2.5"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><MessageCircle className="size-5" /></div><div><p className="text-sm font-semibold">WHAPPNUS Inbox</p><p className="text-[11px] text-muted-foreground">Visão da equipa</p></div></div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold text-primary">DEMONSTRAÇÃO</span>
              </div>
              <div className="grid gap-3 p-2 sm:grid-cols-[0.82fr_1.18fr] sm:p-3">
                <div className="space-y-2">
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conversas recentes</p>
                  {[["AM","Ana Manuel","Olá, gostaria de saber os preços.","bg-amber-100 text-amber-800"],["JC","João Costa","Ainda têm disponibilidade?","bg-sky-100 text-sky-800"],["MC","Marta C.","Quero confirmar a encomenda.","bg-violet-100 text-violet-800"]].map(([initials,name,message,color],i) => <div key={name} className={`rounded-xl border p-2.5 ${i===0 ? "border-primary/30 bg-primary/5" : "border-border bg-background"}`}><div className="flex items-center gap-2"><span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${color}`}>{initials}</span><span className="truncate text-[11px] font-semibold">{name}</span><span className="ml-auto size-1.5 rounded-full bg-primary" /></div><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{message}</p></div>)}
                </div>
                <div className="rounded-2xl border border-border bg-background p-3 sm:p-4">
                  <div className="flex items-center gap-2 border-b border-border pb-3"><span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="size-4" /></span><div><p className="text-xs font-semibold">Assistente da empresa</p><p className="text-[10px] text-primary">A preparar resposta</p></div><span className="ml-auto rounded-full bg-muted px-2 py-1 text-[9px] text-muted-foreground">IA</span></div>
                  <div className="mt-4 space-y-3"><div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-muted px-3 py-2.5 text-[11px] leading-5">Olá! Gostaria de saber os preços e como funciona a entrega.</div><div className="max-w-[94%] rounded-2xl rounded-tl-sm border border-primary/15 bg-primary/5 px-3 py-3 text-[11px] leading-5">Olá, Ana! 😊 Claro, posso ajudar. Temos várias opções disponíveis. Para indicar a melhor, diga-me qual produto procura e em que zona pretende receber a encomenda.</div><div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground"><span className="size-1 rounded-full bg-primary" /><span className="size-1 rounded-full bg-primary/60" /><span className="size-1 rounded-full bg-primary/30" /> Resposta de exemplo</div></div>
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-border px-3 py-2 text-[10px] text-muted-foreground"><span>Mensagem pronta para revisão</span><Sparkles className="size-3.5 text-primary" /></div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-border px-2 pt-3 sm:px-3"><div className="rounded-xl bg-muted/70 p-3"><p className="text-[9px] text-muted-foreground sm:text-[10px]">Organização</p><p className="mt-1 text-xs font-semibold">Num só lugar</p></div><div className="rounded-xl bg-muted/70 p-3"><p className="text-[9px] text-muted-foreground sm:text-[10px]">Equipa</p><p className="mt-1 text-xs font-semibold">Em sintonia</p></div><div className="rounded-xl bg-muted/70 p-3"><p className="text-[9px] text-muted-foreground sm:text-[10px]">Próximo passo</p><p className="mt-1 text-xs font-semibold">Sempre visível</p></div></div>
            </div>
            <div className="absolute -left-3 top-[22%] hidden max-w-[190px] items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-xl sm:flex"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Zap className="size-5" /></span><div><p className="text-xs font-semibold">Resposta mais rápida</p><p className="mt-1 text-[10px] text-muted-foreground">Menos conversas esquecidas</p></div></div>
            <div className="absolute -right-2 bottom-[14%] hidden max-w-[190px] items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-xl sm:flex"><span className="flex size-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><Check className="size-5" /></span><div><p className="text-xs font-semibold">Tudo acompanhado</p><p className="mt-1 text-[10px] text-muted-foreground">Histórico num só lugar</p></div></div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:grid-cols-3 sm:px-8 lg:py-9">
          {[["01","Atendimento organizado","Cada conversa tem contexto e responsável."],["02","Mais continuidade","A equipa sabe onde o cliente ficou."],["03","Mais controlo","Acompanhe oportunidades sem depender da memória."]].map(([n,title,text]) => <div key={n} className="flex gap-4"><span className="pt-0.5 text-xs font-bold tracking-widest text-primary">{n}</span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></div>)}
        </div>
      </section>

      <section id="plataforma" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Uma operação mais inteligente</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Não é só responder mensagens. É gerir melhor cada relação.</h2><p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">As ferramentas certas, ligadas num fluxo simples — para que o atendimento deixe de ser um conjunto de conversas soltas e passe a fazer parte do seu processo comercial.</p></div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">{modules.map((m) => <article key={m.number} className="group rounded-2xl border border-border bg-card p-6 transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 sm:p-7"><div className="flex items-center justify-between"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground"><m.icon className="size-5" /></span><span className="text-xs font-semibold tracking-widest text-muted-foreground/60">{m.number}</span></div><h3 className="mt-6 text-lg font-semibold tracking-tight">{m.title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{m.text}</p></article>)}</div>
      </section>

      <section id="como-funciona" className="bg-[#082b20] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-24">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Simples por desenho</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Comece com o essencial. Evolua com confiança.</h2><p className="mt-5 max-w-xl text-base leading-7 text-emerald-50/75">Não precisa de uma equipa técnica para começar. Configure o seu espaço, ligue o WhatsApp e construa um processo que acompanha o crescimento do negócio.</p><Button asChild size="lg" className="mt-8 h-12 rounded-full bg-emerald-400 px-6 font-semibold text-emerald-950 hover:bg-emerald-300"><Link to="/auth/registo">Criar a minha conta <ArrowRight className="ml-2 size-4" /></Link></Button></div>
          <div className="grid gap-3 sm:grid-cols-2">{[{n:"01",icon:Smartphone,title:"Ligue o WhatsApp",text:"Siga o fluxo de ligação disponível na sua conta."},{n:"02",icon:Sparkles,title:"Prepare o assistente",text:"Defina o nome, o tom e as instruções do negócio."},{n:"03",icon:Users,title:"Organize a equipa",text:"Distribua conversas e mantenha o histórico acessível."},{n:"04",icon:Clock3,title:"Melhore ao longo do tempo",text:"Observe o atendimento e ajuste o processo."}].map(s => <div key={s.n} className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 sm:p-6"><div className="flex items-center justify-between"><s.icon className="size-5 text-emerald-300" /><span className="text-xs font-semibold tracking-widest text-emerald-100/50">{s.n}</span></div><h3 className="mt-5 text-base font-semibold">{s.title}</h3><p className="mt-2 text-sm leading-6 text-emerald-50/65">{s.text}</p></div>)}</div>
        </div>
      </section>

      <section id="planos" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-2xl text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Preços claros, em Kwanza</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">O plano certo para a fase do seu negócio.</h2><p className="mt-5 text-base leading-7 text-muted-foreground">Experimente durante 7 dias e escolha quando estiver pronto. Sem cartão bancário para começar.</p></div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 lg:grid-cols-3 lg:gap-5">{plans.map(plan => <article key={plan.name} className={`relative flex flex-col rounded-3xl border p-6 sm:p-8 ${plan.featured ? "border-primary bg-primary/[0.045] shadow-xl shadow-primary/10 lg:-translate-y-2" : "border-border bg-card"}`}>{plan.featured && <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">Mais escolhido</span>}<h3 className="text-lg font-semibold">WHAPPNUS {plan.name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{plan.description}</p><div className="mt-5 flex items-baseline gap-1"><span className="text-4xl font-semibold tracking-tight">{plan.price}</span><span className="text-sm text-muted-foreground">Kz / mês</span></div><div className="my-6 h-px bg-border" /><ul className="flex-1 space-y-3">{plan.features.map(f => <li key={f} className="flex gap-2.5 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" /><span>{f}</span></li>)}</ul><Button asChild className="mt-8 h-12 w-full rounded-full" variant={plan.featured ? "default" : "outline"}><Link to="/auth/registo">Começar com {plan.name} <ArrowRight className="ml-2 size-4" /></Link></Button></article>)}</div>
        <p className="mt-7 text-center text-xs leading-5 text-muted-foreground">Todos os planos são facturados mensalmente. A disponibilidade de funcionalidades depende da assinatura activa e dos limites indicados na conta.</p>
      </section>

      <section id="angola" className="relative overflow-hidden border-y border-emerald-900/20 bg-gradient-to-br from-emerald-950 via-[#063c2b] to-[#0b5a3e] text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 size-[430px] rounded-full border border-emerald-200/10 sm:size-[560px]" /><div className="pointer-events-none absolute -right-8 -top-8 size-[300px] rounded-full border border-emerald-200/10 sm:size-[420px]" /><div className="pointer-events-none absolute right-12 top-12 size-[210px] rounded-full border border-emerald-200/10 sm:size-[300px]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_0.7fr] lg:items-center lg:py-24">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Sem fronteiras</p><h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Feita para Angola. Pensada para o seu sucesso.</h2><p className="mt-6 max-w-2xl text-base leading-7 text-emerald-50/75 sm:text-lg">Uma plataforma alinhada com a realidade local: preços em Kwanza, negócios de diferentes dimensões e ferramentas para criar relações melhores com os seus clientes — onde quer que estejam.</p><div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg" className="h-12 rounded-full bg-emerald-300 px-6 font-semibold text-emerald-950 hover:bg-emerald-200"><Link to="/auth/registo">Começar hoje <ArrowRight className="ml-2 size-4" /></Link></Button><span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm text-emerald-50/80"><Globe2 className="size-4 text-emerald-300" /> Criada para crescer consigo</span></div></div>
          <div className="relative mx-auto flex aspect-square w-full max-w-[360px] items-center justify-center"><div className="absolute inset-6 rounded-full border border-emerald-200/15" /><div className="absolute inset-12 rounded-full border border-dashed border-emerald-200/20" /><div className="absolute inset-[4.5rem] rounded-full bg-emerald-300/10 blur-2xl" /><div className="relative flex size-36 items-center justify-center rounded-[2rem] border border-emerald-200/20 bg-white/[0.07] shadow-2xl backdrop-blur"><Globe2 className="size-20 stroke-[1.1] text-emerald-200" /></div>{[["top-6 left-1/2 -translate-x-1/2","AO"],["right-3 top-1/3","WA"],["bottom-10 left-7","CRM"],["bottom-12 right-7","IA"]].map(([pos,label]) => <span key={label} className={`absolute ${pos} rounded-xl border border-emerald-100/15 bg-emerald-900/70 px-3 py-2 text-xs font-semibold tracking-wider text-emerald-100 shadow-lg backdrop-blur`}>{label}</span>)}</div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-20 text-center sm:px-8 sm:py-24"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="size-7" /></div><h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-5xl">O próximo cliente pode já estar a escrever-lhe.</h2><p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">Prepare o seu atendimento para responder com clareza, acompanhar oportunidades e criar uma experiência mais consistente desde a primeira conversa.</p><Button asChild size="lg" className="mt-8 h-12 rounded-full px-7"><Link to="/auth/registo">Experimentar a WHAPPNUS <ArrowRight className="ml-2 size-4" /></Link></Button></section>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
          <div><Logo className="text-base" /><p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Inteligência que atende, organiza e vende. Atendimento, CRM e automação WhatsApp numa única plataforma.</p><p className="mt-4 text-xs text-muted-foreground">Feita para negócios angolanos · Preços em Kwanza</p></div>
          <div><h2 className="text-sm font-semibold">Plataforma</h2><nav className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground"><a href="#plataforma" className="hover:text-foreground">Funcionalidades</a><a href="#como-funciona" className="hover:text-foreground">Como funciona</a><a href="#planos" className="hover:text-foreground">Planos</a></nav></div>
          <div><h2 className="text-sm font-semibold">Informação</h2><nav className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground"><Link to="/privacy" className="hover:text-foreground">Política de Privacidade</Link><Link to="/terms" className="hover:text-foreground">Termos de Serviço</Link><Link to="/deletion" className="hover:text-foreground">Eliminar dados</Link><Link to="/auth/login" className="hover:text-foreground">Entrar na conta <ArrowUpRight className="ml-1 inline size-3.5" /></Link></nav></div>
        </div><div className="border-t border-border"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>© {new Date().getFullYear()} WHAPPNUS. Todos os direitos reservados.</span><span>Inteligência que atende, organiza e vende.</span></div></div>
      </footer>
    </main>
  );
}
