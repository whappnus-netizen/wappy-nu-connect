import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Utilização — Wappy Nus" },
      { name: "description", content: "Condições de utilização da plataforma Wappy Nus para empresas em Angola." },
      { property: "og:title", content: "Termos de Utilização — Wappy Nus" },
      { property: "og:description", content: "Condições de utilização da plataforma Wappy Nus." },
    ],
  }),
  component: () => (
    <LegalPage title="Termos de Utilização">
      <p>
        Ao utilizar o Wappy Nus, a sua empresa concorda em usar a plataforma apenas com números WhatsApp
        legitimamente detidos e aprovados na WhatsApp Business Platform da Meta.
      </p>
      <p>
        É proibido o envio de mensagens não solicitadas, o uso de automações que violem as políticas da Meta e a
        partilha de credenciais entre organizações distintas.
      </p>
      <p>
        Cada organização é responsável pelos dados dos seus contactos e pelo cumprimento da legislação angolana
        aplicável à protecção de dados pessoais.
      </p>
      <p className="text-sm text-muted-foreground">
        Documento inicial. Deve ser revisto por assessoria jurídica antes do lançamento comercial.
      </p>
    </LegalPage>
  ),
});

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Voltar</Link>
      <h1 className="mt-4 text-3xl font-bold">{title}</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}
