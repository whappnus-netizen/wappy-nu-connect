import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight, Bot, Check, ChevronDown, KanbanSquare, Menu, MessagesSquare, QrCode,
  Smartphone, Sparkles, UserPlus, X, Store, GraduationCap, Stethoscope, Search,
} from "lucide-react";
import "./premium-landing.css";
import heroPerson from "@/assets/hero-person.jpg";
import featTeam from "@/assets/feature-team.jpg";
import featAi from "@/assets/feature-ai.jpg";
import featCrm from "@/assets/feature-crm.jpg";

const nav = [
  ["Recursos", "#recursos"],
  ["Como funciona", "#como-funciona"],
  ["Para quem é", "#para-quem"],
  ["Preços", "#planos"],
] as const;

const features = [
  { icon: MessagesSquare, title: "Atendimento centralizado", text: "Todas as conversas do WhatsApp da empresa num só lugar, com responsável e histórico.", img: featTeam },
  { icon: Bot, title: "IA treinada com o seu negócio", text: "Defina produtos, serviços, regras e tom. A IA responde com base no que a sua empresa ensinar.", img: featAi },
  { icon: KanbanSquare, title: "Contactos e CRM", text: "Organize clientes e acompanhe cada oportunidade até ao próximo passo comercial.", img: featCrm },
];

const steps = [
  { icon: UserPlus, title: "Crie a sua conta", text: "Registe-se em poucos minutos e crie o espaço da sua empresa." },
  { icon: QrCode, title: "Ligue o WhatsApp", text: "Conecte o número da empresa por QR Code ou pela API oficial." },
  { icon: Sparkles, title: "Treine a sua IA", text: "Adicione as informações do negócio e comece a atender." },
];

const audiences = [
  { icon: Store, title: "Lojas e comércio", text: "Responda sobre produtos, preços e disponibilidade sem deixar clientes à espera." },
  { icon: Stethoscope, title: "Clínicas e serviços", text: "Organize marcações, dúvidas frequentes e acompanhamento de pacientes ou clientes." },
  { icon: GraduationCap, title: "Escolas e formações", text: "Esclareça inscrições, horários e propinas com informação sempre consistente." },
];

const plans = [
  { name: "Start", price: "10.000", description: "Para começar a atender com método.", features: ["1 número WhatsApp", "1 agente IA", "1.500 mensagens com IA/mês", "2 automações activas", "Inbox, contactos e CRM"] },
  { name: "Pro", price: "25.000", description: "Para equipas em crescimento.", features: ["2 números WhatsApp", "2 agentes IA", "4.000 mensagens com IA/mês", "5 automações activas", "Até 3 membros adicionais"], featured: true },
  { name: "Premium", price: "45.000", description: "Para operações com maior volume.", features: ["4 números WhatsApp", "4 agentes IA", "10.000 mensagens com IA/mês", "15 automações activas", "Até 9 membros adicionais"] },
];

const businessScenes = [
  { name: "Imobiliária", line: "Encontre o imóvel certo", image: featCrm, message: "Temos T3 disponíveis em Talatona.", reply: "Pode enviar fotos e valores?" },
  { name: "Loja de vendas", line: "O próximo cliente está à espera", image: featTeam, message: "Este modelo está disponível?", reply: "Sim! Quer ver as cores?" },
  { name: "Salão de beleza", line: "Agenda cheia. Atendimento organizado.", image: heroPerson, message: "Quero marcar para sábado.", reply: "Temos vaga às 10h ou 14h." },
  { name: "Clínica médica", line: "Mais cuidado. Menos espera.", image: featAi, message: "Como posso marcar uma consulta?", reply: "Temos disponibilidade amanhã." },
  { name: "Pastelaria", line: "Cada encomenda no momento certo", image: featTeam, message: "Fazem bolos por encomenda?", reply: "Sim! Para quantas pessoas?" },
  { name: "Restaurante", line: "Pedidos sem perder conversas", image: featCrm, message: "Quero consultar o menu.", reply: "Claro! Já envio o nosso menu." },
];

function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`wn-brand ${light ? "wn-brand-light" : ""}`}>
      <img src="/favicon.png" alt="" width={32} height={32} />
      WhappNus
    </span>
  );
}

function PhoneMock() {
  return (
    <div className="wn-phone" aria-label="Pré-visualização do Inbox da WhappNus">
      <div className="wn-phone-camera" aria-hidden="true" />
      <div className="wn-phone-screen" role="img" aria-label="Pré-visualização do Inbox da WhappNus: pesquisa, filtros e conversas abertas">
        <div className="wn-inbox-head">
          <Menu size={17} strokeWidth={2.2} />
          <div><strong>Inbox</strong><span>Multiatendimento em tempo real — receba, responda e organize</span></div>
        </div>
        <div className="wn-inbox-body">
          <div className="wn-inbox-search"><Search size={16} /><span>Pesquisar conversas</span></div>
          <div className="wn-inbox-filters">
            <span>Todas</span><span className="active">Abertas</span>
            <span>Pendentes</span><span>Em atendimento</span><span>Encerradas</span>
          </div>
          <div className="wn-inbox-list">
            {[
              ["~Mostro", "28/10/2026, 20:23:20", "2"],
              ["Celso Queiroz", "28/10/2026, 11:36:09", "20"],
              ["Isaac .M", "27/10/2026, 23:51:02", "12"],
              ["F.Miguel", "27/10/2026, 22:21:22", "18"],
              ["Irene Reis", "27/10/2026, 21:39:14", "17"],
              ["Bruno Tavares", "27/10/2026, 11:25:11", "4"],
              ["VNVDIGITAL", "27/10/2026, 10:48:03", "6"],
            ].map(([name, date, count]) => (
              <div className="wn-inbox-contact" key={name}>
                <div><strong>{name}</strong><span>{date}</span></div>
                <b>{count}</b><small>open</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PremiumLanding() {
  const [open, setOpen] = useState(false);
  return (
    <main className="wn">
      <header className="wn-header">
        <div className="wn-wrap wn-header-in">
          <Link to="/" aria-label="WhappNus — início"><Brand /></Link>
          <nav aria-label="Navegação principal" className="wn-nav">
            {nav.map(([l, h]) => <a key={h} href={h}>{l}</a>)}
          </nav>
          <div className="wn-header-cta">
            <Link to="/auth/login" className="wn-link">Entrar</Link>
            <Link to="/auth/registo" className="wn-btn wn-btn-primary">Criar conta grátis</Link>
          </div>
          <button type="button" className="wn-burger" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <nav aria-label="Navegação móvel" className="wn-mobile">
            {nav.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)}>{l}</a>)}
            <Link to="/auth/login" className="wn-btn wn-btn-outline">Entrar</Link>
            <Link to="/auth/registo" className="wn-btn wn-btn-primary">Criar conta grátis</Link>
          </nav>
        )}
      </header>

      <section className="wn-wrap wn-hero">
        <div className="wn-hero-copy">
          <h1>Ligue. Treine. Atenda. Tudo no <span>WhappNus.</span></h1>
          <p>Conecte o WhatsApp da sua empresa, ensine a IA sobre os seus produtos, serviços e regras, e responda aos clientes com mais rapidez e consistência.</p>
          <div className="wn-hero-ctas">
            <Link to="/auth/registo" className="wn-btn wn-btn-primary wn-btn-lg">Começar grátis <ArrowRight size={16} /></Link>
            <a href="#como-funciona" className="wn-btn wn-btn-outline wn-btn-lg">Ver como funciona <ChevronDown size={16} /></a>
          </div>
        </div>
        <div className="wn-hero-visual">
          <div className="wn-hero-blob" />
          <img src={heroPerson} alt="Empresário angolano a usar o WhatsApp no telemóvel" width={1024} height={1152} className="wn-hero-img" />
          <PhoneMock />
        </div>
      </section>

      <section id="recursos" className="wn-wrap">
        <div className="wn-panel">
          <div className="wn-head">
            <p className="wn-eyebrow">Recursos</p>
            <h2>Tudo o que precisa numa só plataforma</h2>
          </div>
          <div className="wn-features">
            {features.map((f) => (
              <article key={f.title} className="wn-feature">
                <div className="wn-feature-txt">
                  <span className="wn-ico"><f.icon size={20} /></span>
                  <div><h3>{f.title}</h3><p>{f.text}</p></div>
                </div>
                <img src={f.img} alt="" loading="lazy" width={1024} height={768} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="wn-wrap wn-section">
        <div className="wn-head">
          <p className="wn-eyebrow">Como funciona</p>
          <h2>Comece em 3 passos simples</h2>
        </div>
        <div className="wn-steps">
          {steps.map((s, i) => (
            <article key={s.title} className={`wn-step wn-step-${i + 1}`} tabIndex={0} aria-label={`Passo ${i + 1}: ${s.title}`}>
              <span className="wn-step-ico"><s.icon size={26} /></span>
              <div className="wn-step-txt">
                <b className="wn-step-n">{i + 1}</b>
                <div><h3>{s.title}</h3><p>{s.text}</p></div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="para-quem" className="wn-wrap wn-section wn-section-tight">
        <div className="wn-head">
          <p className="wn-eyebrow">Para quem é</p>
          <h2>Pensado para negócios que vivem do WhatsApp</h2>
        </div>
        <div className="wn-audience">
          {audiences.map((a) => (
            <article key={a.title} className="wn-aud-card">
              <span className="wn-ico"><a.icon size={20} /></span>
              <div><h3>{a.title}</h3><p>{a.text}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section id="planos" className="wn-wrap wn-section">
        <div className="wn-head">
          <p className="wn-eyebrow">Preços em Kwanza</p>
          <h2>Escolha o plano certo para crescer</h2>
        </div>
        <div className="wn-plans">
          {plans.map((p) => (
            <article key={p.name} className={`wn-plan ${p.featured ? "wn-plan-featured" : ""}`}>
              {p.featured && <span className="wn-plan-tag">Mais escolhido</span>}
              <h3>{p.name}</h3>
              <p className="wn-plan-desc">{p.description}</p>
              <p className="wn-price"><strong>{p.price}</strong> Kz<span>/mês</span></p>
              <ul>{p.features.map((f) => <li key={f}><Check size={16} /> {f}</li>)}</ul>
              <Link to="/auth/registo" className={`wn-btn ${p.featured ? "wn-btn-light" : "wn-btn-primary"}`}>Começar com {p.name}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="wn-wrap">
        <div className="wn-cta">
          <img src={featAi} alt="" loading="lazy" width={1024} height={768} className="wn-cta-img" />
          <div className="wn-cta-copy">
            <h2>Pronto para atender melhor no WhatsApp?</h2>
            <p>Crie a sua conta, ligue o número da empresa e prepare a sua IA hoje mesmo.</p>
          </div>
          <div className="wn-cta-btns">
            <Link to="/auth/registo" className="wn-btn wn-btn-light wn-btn-lg">Criar conta grátis <ArrowRight size={16} /></Link>
            <Link to="/auth/login" className="wn-btn wn-btn-ghost wn-btn-lg"><Smartphone size={16} /> Entrar</Link>
          </div>
        </div>
      </section>

      <section className="wn-showcase" aria-labelledby="wn-showcase-title">
        <div className="wn-showcase-head">
          <p className="wn-eyebrow">WHAPPNUS EM ACÇÃO</p>
          <h2 id="wn-showcase-title">O seu negócio. Uma experiência de atendimento extraordinária.</h2>
          <p>De uma primeira pergunta a uma venda ou marcação, cada conversa pode ser uma oportunidade bem atendida.</p>
        </div>
        <div className="wn-marquee" aria-label="Exemplos de negócios que podem utilizar a WhappNus">
          <div className="wn-marquee-track">
            {[...businessScenes, ...businessScenes].map((scene, index) => (
              <article className="wn-poster" key={scene.name + "-" + index} aria-label={scene.name + ": " + scene.line}>
                <img src={scene.image} alt="" loading="lazy" />
                <div className="wn-poster-shade" />
                <div className="wn-poster-copy"><span>WHAPPNUS <i /> {scene.name}</span><h3>{scene.line}</h3></div>
                <div className="wn-chat-window" aria-hidden="true">
                  <div className="wn-chat-top"><span className="wn-chat-avatar">W</span><span><b>{scene.name}</b><small>online agora</small></span><i>● ● ●</i></div>
                  <div className="wn-chat-feed"><div className="wn-chat-track">
                    <p className="wn-chat-in">{scene.message}</p><p className="wn-chat-out">{scene.reply}<small>✓✓</small></p>
                    <p className="wn-chat-in">Obrigado! Podemos avançar.</p><p className="wn-chat-out">Com todo o gosto. Estamos aqui para ajudar.<small>✓✓</small></p>
                  </div></div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="wn-wrap">
        <div className="wn-footer">
          <div className="wn-foot-brand">
            <Brand light />
            <p>Atendimento, IA e CRM no WhatsApp da sua empresa, numa plataforma feita para Angola.</p>
          </div>
          <div><h4>Plataforma</h4><a href="#recursos">Recursos</a><a href="#como-funciona">Como funciona</a><a href="#planos">Preços</a></div>
          <div><h4>Conta</h4><Link to="/auth/registo">Criar conta</Link><Link to="/auth/login">Entrar</Link></div>
          <div><h4>Legal</h4><Link to="/privacy">Privacidade</Link><Link to="/terms">Termos</Link><Link to="/deletion">Eliminação de dados</Link></div>
          <div><h4>Contacto</h4><a href="mailto:privacidade@whappnus.online">privacidade@whappnus.online</a><a href="https://whappnus.online">whappnus.online</a></div>
        </div>
        <div className="wn-footer-bottom">
          <span>© {new Date().getFullYear()} WhappNus. Todos os direitos reservados.</span>
          <span>Feito em Angola 🇦🇴</span>
        </div>
      </footer>
    </main>
  );
}
