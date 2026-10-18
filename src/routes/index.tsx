import { createFileRoute } from "@tanstack/react-router";
import { PremiumLanding } from "@/components/landing/premium-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WhappNus — Inteligência que atende, organiza e vende" },
      { name: "description", content: "Transforme o WhatsApp da sua empresa num canal organizado de atendimento e vendas. Atendimento em equipa, CRM e assistente inteligente, com planos em Kwanza." },
      { property: "og:title", content: "WhappNus — Inteligência que atende, organiza e vende" },
      { property: "og:description", content: "Atendimento, organização comercial e automação WhatsApp numa única plataforma feita para negócios angolanos." },
      { name: "theme-color", content: "#050b09" },
    ],
  }),
  component: PremiumLanding,
});
