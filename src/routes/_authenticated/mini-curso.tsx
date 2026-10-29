import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, PlayCircle, Smartphone, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/mini-curso")({
  head: () => ({
    meta: [
      { title: "Mini curso — WHAPPNUS" },
      { name: "description", content: "Aprenda a conectar o WhatsApp e configurar o seu agente de IA na WHAPPNUS." },
    ],
  }),
  component: MiniCursoPage,
});

const lessons = [
  {
    id: "whatsapp",
    title: "Como conectar o WhatsApp",
    description: "Veja como iniciar a ligação da sua conta WhatsApp à WHAPPNUS e concluir os passos no telemóvel.",
    icon: Smartphone,
    video: "https://preview--vidlink.base44.app/embed/RaDsRAVAbWAo",
  },
  {
    id: "ia",
    title: "Como criar e treinar o agente de IA",
    description: "Aprenda a criar o seu agente, definir o objectivo, a personalidade e as instruções para responder de acordo com o seu negócio.",
    icon: Sparkles,
    video: "https://preview--vidlink.base44.app/embed/CasnDqQkvqWw",
  },
];

function MiniCursoPage() {
  return (
    <AppShell title="Mini curso" description="Aprenda a configurar a WHAPPNUS passo a passo">
      <div className="mx-auto max-w-6xl space-y-7">
        <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BookOpen className="size-6" /></span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Centro de aprendizagem</p>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">Configure tudo sem ficar perdido.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Comece pelos dois tutoriais essenciais. Pode assistir novamente sempre que precisar e voltar ao painel para continuar a configuração.</p>
            </div>
          </div>
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          {lessons.map((lesson, index) => {
            const Icon = lesson.icon;
            return (
              <article key={lesson.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
                <div className="flex items-start gap-3 p-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">Aula {index + 1}</p>
                    <h3 className="mt-1 font-display text-lg font-semibold">{lesson.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{lesson.description}</p>
                  </div>
                </div>
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  <iframe
                    src={lesson.video}
                    title={lesson.title}
                    className="absolute inset-0 h-full w-full border-0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  <PlayCircle className="size-4 text-primary" />
                  <span>Assista à aula e siga os passos no seu painel</span>
                </div>
              </article>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground">Mais aulas serão adicionadas aqui à medida que a plataforma evoluir.</p>
      </div>
    </AppShell>
  );
}
