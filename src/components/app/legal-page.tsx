import { Link } from "@tanstack/react-router";
import { Logo } from "./app-shell";
import { Mail, MapPin, Shield } from "lucide-react";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link to="/" className="hover:opacity-90">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground">
              Termos
            </Link>
            <Link to="/deletion" className="text-muted-foreground hover:text-foreground">
              Eliminar dados
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
          <div className="mb-8 flex items-center gap-3 text-primary">
            <Shield className="size-6" />
            <span className="text-xs font-semibold uppercase tracking-wider">Documento legal</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {updated ? (
            <p className="mt-2 text-sm text-muted-foreground">Última actualização: {updated}</p>
          ) : null}
          <article className="mt-8 space-y-6 text-sm leading-7 text-foreground/90">
            {children}
          </article>
        </div>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-5xl px-5 py-8">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <Logo className="text-base" />
              <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                Plataforma angolana de multiatendimento WhatsApp, CRM, automações e IA para empresas.
              </p>
            </div>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Mail className="size-3.5" /> suporte@whappnus.online
              </span>
              <span className="flex items-center gap-2">
                <MapPin className="size-3.5" /> Angola
              </span>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground">Política de Privacidade</Link>
            <Link to="/terms" className="hover:text-foreground">Termos de Serviço</Link>
            <Link to="/deletion" className="hover:text-foreground">Exclusão de Dados</Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} Wappy Nus. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold text-foreground">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-2">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
