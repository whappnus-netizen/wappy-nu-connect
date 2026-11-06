import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight, Bot, Check, ChevronDown, KanbanSquare, Menu, MessagesSquare, QrCode,
  Smartphone, Sparkles, UserPlus, X, Store, GraduationCap, Stethoscope,
} from "lucide-react";
import "./premium-landing.css";
import heroPerson from "@/assets/hero-person.jpg";
import inboxPreview from "@/assets/whappnus-inbox-preview.svg";
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
  { icon: MessagesSquare, title: "Atendimento centralizado e sem falhas", text: "Adeus às mensagens esquecidas. Organize todas as conversas do WhatsApp da sua empresa num só lugar e acompanhe cada oportunidade antes que o cliente procure a concorrência.", img: featTeam },
  { icon: Bot, title: "IA que interpreta áudios, imagens e documentos", text: "Treinada com o seu negócio, a WhappNus compreende mensagens de voz, analisa imagens e consulta as informações que disponibiliza para responder com mais contexto e precisão.", img: featAi },
  { icon: KanbanSquare, title: "Contactos, CRM e controlo total", text: "Acompanhe cada oportunidade, saiba quem precisa de atenção e organize o processo comercial sem ficar 24 horas agarrado ao telemóvel.", img: featCrm },
];

const steps = [
  { icon: UserPlus, title: "Crie a sua conta", text: "Registe-se em poucos minutos e crie o espaço da sua empresa." },
  { icon: QrCode, title: "Ligue o WhatsApp", text: "Conecte o número da empresa por QR Code ou pela API oficial." },
  { icon: Sparkles, title: "Treine a sua IA", text: "Adicione as informações do negócio e comece a atender." },
];

const audiences = [
  { icon: Store, title: "Lojas e comércio", text: "Responda automaticamente a perguntas sobre preços, tamanhos, cores, stock e entregas. O cliente recebe orientação enquanto ainda está pronto para comprar." },
  { icon: Stethoscope, title: "Clínicas e serviços", text: "Organize perguntas frequentes, horários e pedidos de marcação, para que cada pessoa saiba como avançar sem esperar horas por uma resposta." },
  { icon: GraduationCap, title: "Escolas e formações", text: "Esclareça inscrições, propinas, documentos e horários com respostas consistentes, mesmo quando a equipa está ocupada." },
];

const plans = [
  { code: "start-monthly", name: "Start", price: "5.000", description: "Para começar a atender com método.", features: ["1 número WhatsApp", "1 agente IA", "1.500 mensagens com IA/mês", "2 automações activas", "Inbox, contactos e CRM"] },
  { code: "pro-monthly", name: "Pro", price: "10.000", description: "Para equipas em crescimento.", features: ["2 números WhatsApp", "2 agentes IA", "4.000 mensagens com IA/mês", "5 automações activas", "Até 3 membros adicionais"], featured: true },
  { code: "premium-monthly", name: "Premium", price: "20.000", description: "Para operações com maior volume.", features: ["4 números WhatsApp", "4 agentes IA", "10.000 mensagens com IA/mês", "15 automações activas", "Até 9 membros adicionais"] },
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
    <div className="wn-phone" aria-label="Pré-visualização real do Inbox da WhappNus">
      <div className="wn-phone-camera" aria-hidden="true" />
      <div className="wn-phone-screen">
        <img
          src={inboxPreview}
          alt="Inbox da WhappNus com pesquisa de conversas, filtros e lista de clientes em atendimento"
          loading="eager"
          width={401}
          height={760}
        />
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

      <section className="wn-wrap wn-hero wn-hero-cinematic">
        <div className="wn-hero-simulation" aria-hidden="true">
          <div className="wn-demo-orbit wn-demo-orbit-one" />
          <div className="wn-demo-orbit wn-demo-orbit-two" />
          <div className="wn-demo-bubble wn-demo-audio">
            <span className="wn-demo-label">WHATSAPP · MENSAGEM DE ÁUDIO</span>
            <div className="wn-demo-audio-row"><span className="wn-demo-play">▶</span><span className="wn-demo-wave">{Array.from({ length: 27 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 13) % 22)}px` }} />)}</span><small>0:18</small></div>
            <p>“Boa tarde. Têm este produto disponível para entrega em Viana?”</p>
            <span className="wn-demo-ai-note">Áudio compreendido pela IA <b>✓</b></span>
          </div>
          <div className="wn-demo-bubble wn-demo-image">
            <span className="wn-demo-label">IMAGEM RECEBIDA</span>
            <div className="wn-demo-image-row"><img src={featCrm} alt="" /><span><b>Imagem analisada</b><small>Produto identificado · detalhes reconhecidos</small></span></div>
            <span className="wn-demo-ai-note">A IA analisou a fotografia <b>✓</b></span>
          </div>
          <div className="wn-demo-bubble wn-demo-text">
            <span className="wn-demo-label">MENSAGEM DE TEXTO</span>
            <p>“Quanto custa e quais são as formas de pagamento?”</p>
            <span className="wn-demo-reaction">❤️  👍  🔥</span>
          </div>
          <div className="wn-demo-bubble wn-demo-reply">
            <span className="wn-demo-label">RESPOSTA DA WHAPPNUS</span>
            <p>“Temos disponibilidade! Posso enviar os preços e ajudar a concluir a sua encomenda.”</p>
            <span className="wn-demo-check">✓✓ Entregue</span>
          </div>
        </div>
        <div className="wn-hero-copy">
          <p className="wn-hero-kicker">LIGA. TREINA. ATENDE. TUDO NO WHAPPNUS.</p>
          <h1>Não percas clientes no WhatsApp só porque <span>demoras a responder.</span></h1>
          <p>A WhappNus coloca um atendente inteligente no teu WhatsApp para responder na hora, compreender áudios e imagens e transformar conversas em vendas — mesmo quando estás ocupado ou a descansar.</p>
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
            <h2>Deixe de perder oportunidades por falta de resposta</h2>
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
          <h2>O teu negócio está a crescer, mas o teu atendimento continua igual?</h2>
          <p className="wn-section-intro">Se és tu quem vende, atende, negoceia e entrega, sabes como é cansativo gerir dezenas de mensagens por dia. A WhappNus adapta-se ao teu sector e ajuda-te a responder às perguntas repetitivas sobre preços, localização, disponibilidade e marcações.</p>
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
              <Link to="/assinar" search={{ plan: p.code }} className={`wn-btn ${p.featured ? "wn-btn-light" : "wn-btn-primary"}`}>Assinar {p.name}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="wn-wrap">
        <div className="wn-cta">
          <img src={featAi} alt="" loading="lazy" width={1024} height={768} className="wn-cta-img" />
          <div className="wn-cta-copy">
            <h2>O teu negócio precisa de vender mais, mas tu também precisas de ter paz.</h2>
            <p>Deixa de viver agarrado ao telemóvel. Responde a tempo, reduz oportunidades perdidas e dá aos teus potenciais clientes uma razão para comprar contigo — não com a concorrência.</p>
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
            <p>Mais tempo para gerir o negócio. Menos oportunidades perdidas no WhatsApp. Tecnologia feita para empresas angolanas.</p>
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
