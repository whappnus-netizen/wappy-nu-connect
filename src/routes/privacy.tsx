import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalList } from "@/components/app/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Wappy Nus" },
      {
        name: "description",
        content:
          "Saiba como o Wappy Nus recolhe, armazena e protege os dados da sua empresa e dos seus contactos em Angola.",
      },
      { property: "og:title", content: "Política de Privacidade — Wappy Nus" },
      {
        property: "og:description",
        content:
          "Tratamento, segurança e direitos sobre os dados pessoais e empresariais na plataforma Wappy Nus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade" updated="19 de Agosto de 2026">
      <p>
        A Wappy Nus, operada em Angola, compromete-se a proteger a privacidade dos utilizadores e
        das empresas que usam a nossa plataforma. Este documento explica que dados recolhemos, porquê
        e como os tratamos.
      </p>

      <LegalSection heading="1. Quem somos">
        <p>
          Wappy Nus é uma plataforma SaaS de multiatendimento WhatsApp, CRM, automações e IA,
          destinada a empresas angolanas. O responsável pelo tratamento de dados é a equipa Wappy
          Nus, contactável através de suporte@whappnus.online.
        </p>
      </LegalSection>

      <LegalSection heading="2. Dados que recolhemos">
        <LegalList
          items={[
            "Dados de conta: nome, endereço de email e identificador único gerado pelo sistema de autenticação.",
            "Dados da organização: nome comercial, slug, sector de actividade e configurações de atendimento.",
            "Dados de contactos: nomes, números de telefone, histórico de conversas e notas inseridas pelos agentes.",
            "Dados de utilização: registos de actividade, atribuições de conversas, estágios do CRM e automações configuradas.",
            "Dados técnicos: endereço IP, logs de erro e informações do navegador, utilizados apenas para segurança e diagnóstico.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. Finalidade do tratamento">
        <p>
          Os dados são tratados exclusivamente para prestar o serviço contratado: gestão de
          conversas, organização de contactos, execução de automações, geração de respostas
          assistidas por IA e manutenção da segurança da plataforma.
        </p>
      </LegalSection>

      <LegalSection heading="4. Base legal e consentimento">
        <p>
          O tratamento fundamenta-se na execução do contrato de prestação de serviços e, quando
          aplicável, no consentimento livre e informado do utilizador. Ao criar uma conta e usar a
          plataforma, o utilizador aceita esta política.
        </p>
      </LegalSection>

      <LegalSection heading="5. Partilha de dados">
        <p>
          Não vendemos dados a terceiros. A partilha limita-se a prestadores estritamente
          necessários ao funcionamento da plataforma, nomeadamente:
        </p>
        <LegalList
          items={[
            "Infraestrutura de base de dados e autenticação (cloud segura).",
            "WhatsApp Business Platform da Meta, para envio e recepção de mensagens oficiais.",
            "Serviços de processamento de erros e métricas, sem identificação pessoal.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="6. Segurança">
        <p>
          A plataforma utiliza encriptação em trânsito (TLS), isolamento por organização (Row Level
          Security) e controlo de acessos baseado em papéis. As chaves de API e credenciais
          privilegiadas permanecem exclusivamente no lado do servidor.
        </p>
      </LegalSection>

      <LegalSection heading="7. Retenção">
        <p>
          Os dados são mantidos enquanto a conta estiver activa. Após o encerramento da conta, os
          dados pessoais são eliminados no prazo de 30 dias, salvo obrigação legal de conservação.
        </p>
      </LegalSection>

      <LegalSection heading="8. Direitos do utilizador">
        <LegalList
          items={[
            "Aceder aos dados associados à sua conta.",
            "Rectificar informações incorrectas.",
            "Solicitar a eliminação total dos dados (ver página /deletion).",
            "Opor-se ao tratamento baseado em interesses legítimos, quando aplicável.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="9. Alterações">
        <p>
          Esta política pode ser actualizada. A data da última revisão aparece no topo da página.
          Recomendamos a consulta periódica.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contacto">
        <p>
          Para questões sobre privacidade, envie um email para{" "}
          <a href="mailto:privacidade@whappnus.online" className="text-primary hover:underline">
            privacidade@whappnus.online
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
