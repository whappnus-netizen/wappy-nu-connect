import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalList } from "@/components/app/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Termos de Serviço — Wappy Nus" },
      {
        name: "description",
        content:
          "Condições de utilização da plataforma Wappy Nus para empresas em Angola.",
      },
      { property: "og:title", content: "Termos de Serviço — Wappy Nus" },
      {
        property: "og:description",
        content:
          "Termos e condições de utilização do SaaS Wappy Nus: responsabilidades, WhatsApp Cloud API e uso aceitável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Termos de Serviço" updated="19 de Agosto de 2026">
      <p>
        Ao aceder e utilizar a plataforma Wappy Nus, o utilizador ou a empresa representada aceita
        integralmente os presentes Termos de Serviço. Se não concordar, deve abster-se de usar a
        plataforma.
      </p>

      <LegalSection heading="1. Descrição do serviço">
        <p>
          Wappy Nus é uma plataforma SaaS que permite às empresas gerir atendimento via WhatsApp
          oficial, organizar contactos e oportunidades comerciais (CRM), configurar automações e
          utilizar funcionalidades assistidas por IA.
        </p>
      </LegalSection>

      <LegalSection heading="2. Elegibilidade e conta">
        <LegalList
          items={[
            "A plataforma destina-se a empresas e profissionais com capacidade jurídica para contratar.",
            "O utilizador é responsável pela exactidão dos dados de registo e pela confidencialidade das credenciais.",
            "Cada conta é pessoal e intransmissível sem autorização prévia.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. WhatsApp Cloud API">
        <p>
          A ligação a números WhatsApp é feita exclusivamente através da WhatsApp Business Platform
          da Meta. O cliente deve:
        </p>
        <LegalList
          items={[
            "Possuir legitimamente o número de telefone associado.",
            "Cumprir as políticas comerciais e de mensagens da Meta.",
            "Arcar com quaisquer custos de uso da API cobrados pela Meta, quando aplicável.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. Uso aceitável">
        <p>É expressamente proibido:</p>
        <LegalList
          items={[
            "Enviar mensagens não solicitadas, spam ou conteúdo enganoso.",
            "Usar a plataforma para actividades ilegais, fraudulentas ou difamatórias.",
            "Partilhar credenciais entre organizações distintas.",
            "Tentar contornar controles de segurança, RLS ou papéis de acesso.",
            "Carregar dados de contactos sem base legal adequada.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. Responsabilidades do cliente">
        <p>
          O cliente é responsável pelos dados dos seus contactos, pelo cumprimento da legislação
          angolana de protecção de dados e pela conduta dos seus agentes na plataforma. A Wappy Nus
          não se responsabiliza por conteúdos gerados pelos utilizadores.
        </p>
      </LegalSection>

      <LegalSection heading="6. Pagamentos e planos">
        <p>
          Os planos, preços e ciclos de facturação serão apresentados na área de definições ou num
          documento comercial específico. O incumprimento de pagamentos pode levar à suspensão do
          serviço.
        </p>
      </LegalSection>

      <LegalSection heading="7. Suspensão e rescisão">
        <p>
          A Wappy Nus pode suspender ou encerrar contas que violem estes termos, sem aviso prévio
          nos casos de uso abusivo ou ilegal. O cliente pode encerrar a conta a qualquer momento
          solicitando a eliminação dos dados.
        </p>
      </LegalSection>

      <LegalSection heading="8. Propriedade intelectual">
        <p>
          A Wappy Nus detém todos os direitos sobre a plataforma, marcas, código e design. O cliente
          mantém a propriedade dos seus dados.
        </p>
      </LegalSection>

      <LegalSection heading="9. Limitação de responsabilidade">
        <p>
          A Wappy Nus não garante disponibilidade ininterrupta nem isenta a plataforma de falhas de
          terceiros (ex.: indisponibilidade da Meta ou da infraestrutura cloud). A responsabilidade
          limita-se ao valor pago pelo serviço nos últimos 12 meses, quando aplicável.
        </p>
      </LegalSection>

      <LegalSection heading="10. Lei aplicável e contacto">
        <p>
          Estes termos regem-se pela legislação da República de Angola. Para esclarecimentos,
          contacte{" "}
          <a href="mailto:suporte@whappnus.online" className="text-primary hover:underline">
            suporte@whappnus.online
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
