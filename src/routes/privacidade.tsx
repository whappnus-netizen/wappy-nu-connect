import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./termos";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Wappy Nus" },
      { name: "description", content: "Como o Wappy Nus recolhe, armazena e protege dados de empresas e contactos." },
      { property: "og:title", content: "Política de Privacidade — Wappy Nus" },
      { property: "og:description", content: "Tratamento e protecção de dados na plataforma Wappy Nus." },
    ],
  }),
  component: () => (
    <LegalPage title="Política de Privacidade">
      <p>
        Os dados de cada organização são armazenados em PostgreSQL (Supabase) e isolados por Row Level Security:
        uma empresa nunca acede a dados de outra.
      </p>
      <p>
        Recolhemos dados de conta (nome, email), dados da organização e dados de conversas/contactos criados pelo
        uso da plataforma. Chaves privilegiadas ficam exclusivamente no servidor.
      </p>
      <p>Pode solicitar exportação ou eliminação dos dados da sua organização a qualquer momento.</p>
    </LegalPage>
  ),
});
