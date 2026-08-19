import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalList } from "@/components/app/legal-page";
import { Mail, Trash2, Clock, ShieldCheck, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/deletion")({
  head: () => ({
    meta: [
      { title: "Exclusão de Dados do Utilizador — Wappy Nus" },
      {
        name: "description",
        content:
          "Saiba como solicitar a eliminação da sua conta e dados na plataforma Wappy Nus.",
      },
      { property: "og:title", content: "Exclusão de Dados do Utilizador — Wappy Nus" },
      {
        property: "og:description",
        content:
          "Instruções e contacto para solicitar a eliminação completa dos dados de conta na Wappy Nus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeletionPage,
});

function DeletionPage() {
  return (
    <LegalPage title="Exclusão de Dados do Utilizador" updated="19 de Agosto de 2026">
      <p>
        Respeitamos o seu direito ao controlo dos seus dados. Esta página explica como pode solicitar
        a eliminação completa da sua conta e dos dados associados na plataforma Wappy Nus.
      </p>

      <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Mail className="size-4 text-primary" />
          Método de contacto
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Envie um email para{" "}
          <a href="mailto:privacidade@whappnus.online" className="font-medium text-primary hover:underline">
            privacidade@whappnus.online
          </a>{" "}
          com o assunto <strong>“Pedido de eliminação de dados”</strong>, a partir do endereço de
          email associado à sua conta.
        </p>
      </div>

      <LegalSection heading="Como solicitar a eliminação — passo a passo">
        <LegalList
          items={[
            "Passo 1: Inicie sessão na sua conta Wappy Nus e confirme o endereço de email principal.",
            "Passo 2: Envie o pedido de eliminação para privacidade@whappnus.online usando esse mesmo email.",
            "Passo 3: Inclua na mensagem o nome da sua empresa/organização e o endereço de email da conta.",
            "Passo 4: A nossa equipa confirmará a identidade e iniciará o processo de eliminação.",
            "Passo 5: Receberá uma confirmação por email assim que a eliminação for concluída.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="O que será eliminado">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { icon: Trash2, text: "Conta de utilizador e perfil" },
            { icon: Trash2, text: "Organização e membros associados" },
            { icon: Trash2, text: "Contactos, conversas e mensagens" },
            { icon: Trash2, text: "Dados do CRM, pipelines e oportunidades" },
            { icon: Trash2, text: "Automações, etiquetas e regras configuradas" },
            { icon: Trash2, text: "Credenciais e números WhatsApp ligados" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <item.icon className="size-4 text-primary" />
              <span className="text-sm">{item.text}</span>
            </div>
          ))}
        </div>
      </LegalSection>

      <LegalSection heading="Prazo de tratamento">
        <p className="flex items-start gap-3">
          <Clock className="mt-0.5 size-5 text-primary" />
          <span>
            O pedido será processado no prazo máximo de <strong>30 dias</strong> após a confirmação
            da identidade. Em casos complexos ou com grande volume de dados, poderemos notificá-lo
            sobre um prazo adicional razoável.
          </span>
        </p>
      </LegalSection>

      <LegalSection heading="Dados mantidos por obrigação legal">
        <p className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 size-5 text-primary" />
          <span>
            Alguns registos poderão ser mantidos pelo período exigido pela legislação angolana
            aplicável (ex.: obrigações fiscais ou contratuais). Nesses casos, os dados serão
            anonimizados ou isolados e não utilizados para outros fins.
          </span>
        </p>
      </LegalSection>

      <LegalSection heading="Segurança do processo">
        <p className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <span>
            A eliminação é irreversível. Antes de remover os dados, verificamos a identidade do
            solicitante para evitar exclusões não autorizadas. Recomendamos que exporte os dados
            importantes antes de enviar o pedido.
          </span>
        </p>
      </LegalSection>

      <LegalSection heading="Contacto directo">
        <p>
          Em caso de dúvida, contacte-nos através de{" "}
          <a href="mailto:privacidade@whappnus.online" className="text-primary hover:underline">
            privacidade@whappnus.online
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
