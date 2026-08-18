# Remix of Wappy Nus: Your WhatsApp Hub

Wappy Nus — Prompt Mestre 01: Fundação da Plataforma SaaS

Quero que você construa a fundação inicial de uma plataforma SaaS chamada Wappy Nus.

O Wappy Nus será uma plataforma SaaS voltada inicialmente para empresas de Angola, com foco em centralizar, organizar e automatizar o atendimento de clientes através do WhatsApp.

1. OBJETIVO DO PROJETO

O produto deve ser construído como uma plataforma SaaS profissional, escalável, multiempresa e preparada para crescimento futuro.

A referência conceitual do produto é a categoria de plataformas de atendimento e automação de WhatsApp como FrontZapp, mas não copie identidade visual, código, textos, marca ou elementos proprietários de terceiros.

O Wappy Nus deve ter identidade própria e ser pensado especificamente para empresas angolanas.

O produto deve trabalhar com moeda e contexto comercial de Angola.

2. ESCOPO DA PRIMEIRA FASE

Nesta primeira fase, NÃO implemente ainda:

campanhas avançadas;

BI/analytics avançado;

recuperação de vendas;

marketplace de integrações;

sistema avançado de créditos;

funcionalidades enterprise avançadas;

módulos que não sejam necessários para o MVP operacional.

A primeira versão deve concentrar-se em:

WhatsApp;

Multiatendimento;

CRM;

Automação;

IA.

Esses cinco módulos devem formar o núcleo operacional inicial do Wappy Nus.

3. ARQUITETURA FUTURA

Embora os módulos futuros não sejam implementados agora, a arquitetura deve ser criada de forma modular.

Não quero uma aplicação monolítica e difícil de evoluir.

Crie uma arquitetura que permita posteriormente adicionar:

campanhas;

webhooks;

integrações externas;

analytics;

BI;

relatórios avançados;

recuperação de vendas;

faturação;

créditos;

marketplace;

outras automações.

A estrutura atual deve permitir adicionar esses módulos posteriormente sem precisar reconstruir toda a aplicação.

4. STACK

Utilize:

Lovable para desenvolvimento da aplicação;

Supabase externo como backend principal;

PostgreSQL através do Supabase;

Supabase Auth;

Supabase Storage quando necessário;

Supabase Realtime quando necessário;

Supabase Edge Functions para operações server-side;

arquitetura preparada para integração com a WhatsApp Cloud API oficial da Meta.

IMPORTANTE:

Não utilizar WhatsApp Web automatizado, QR-code bots, bibliotecas não oficiais ou qualquer solução que possa colocar números de clientes em risco.

O produto deve ser preparado para utilização da infraestrutura oficial do WhatsApp Business Platform/Cloud API.

5. SUPABASE EXTERNO

O projeto deve utilizar um projeto Supabase externo que eu já possuo.

Criar no projeto uma área/configuração claramente identificada para inserir os dados do meu Supabase:

SUPABASE_URL:
https://nhpjqndkwynupwdjjryw.supabase.co

SUPABASE_ANON_KEY:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocGpxbmRrd3ludXB3ZGpqcnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1Njk4OTIsImV4cCI6MjEwMjE0NTg5Mn0.H7AYZhTke0lPZYX0Igw6UEN7-_0k9RLdYg3JbEVJqxk

Não quero que nenhuma service_role key seja colocada no código frontend.

Não exponha credenciais sensíveis.

Utilize as credenciais apropriadas no frontend e deixe operações privilegiadas para ambiente server-side/Edge Functions.

Se a conexão com o Supabase externo precisar ser feita através da interface nativa da Lovable, explique exatamente o procedimento necessário, mas prepare o projeto considerando esse Supabase como backend oficial.

6. REGRA FUNDAMENTAL SOBRE O BANCO

Quero que você seja responsável por projetar a estrutura inicial do banco de dados.

Não crie simplesmente tabelas isoladas.

Modele corretamente:

relacionamentos;

chaves estrangeiras;

índices;

constraints;

timestamps;

estados/status;

segurança;

multi-tenancy;

Row Level Security.

Depois de criar ou projetar a estrutura, gere o SQL/migration completo necessário para eu executar no meu Supabase externo.

IMPORTANTE:

Sempre que houver uma alteração estrutural no banco durante as próximas etapas do projeto, gere uma migration SQL claramente identificada.

O nosso fluxo de desenvolvimento será:

PROMPT
→ LOVABLE
→ SQL/MIGRATION
→ SUPABASE EXTERNO
→ TESTE
→ PRÓXIMO MÓDULO.

7. MULTI-TENANCY

O Wappy Nus será uma plataforma SaaS multiempresa.

Uma empresa não pode visualizar dados de outra empresa.

Projete a estrutura considerando:

organizations;

users;

memberships;

roles;

permissions.

Cada utilizador deve pertencer a uma organização.

Todo dado empresarial deve estar associado à organização correta.

Implementar Row Level Security para impedir acesso cruzado entre organizações.

8. ROLES INICIAIS

Crie pelo menos:

OWNER
ADMIN
SUPERVISOR
AGENT

O sistema deve ser preparado para adicionar outras permissões posteriormente.

Cada papel deve possuir permissões próprias.

9. ESTRUTURA PRINCIPAL DA APLICAÇÃO

Crie a estrutura inicial da aplicação com:

Área pública

Landing Page;

Login;

Cadastro;

Recuperação de senha;

Termos;

Privacidade.

Área autenticada

Dashboard;

Inbox / Atendimento;

WhatsApp;

Contactos;

CRM;

Automações;

IA;

Equipe;

Configurações.

Área administrativa futura

Deixe a arquitetura preparada para:

empresas;

utilizadores;

planos;

assinaturas;

consumo;

faturação;

suporte;

configurações globais.

Não precisa implementar todo o painel administrativo agora.

10. DASHBOARD

Crie um dashboard inicial profissional.

O dashboard deve apresentar, inicialmente:

conversas abertas;

conversas pendentes;

conversas em atendimento;

contactos;

leads;

agentes online;

automações ativas;

utilização da IA.

Não invente métricas falsas.

Quando ainda não existirem dados, exiba estados vazios apropriados.

11. MÓDULO WHATSAPP

Crie a estrutura para gerenciamento de números/conexões WhatsApp.

O sistema deve estar preparado para:

uma organização possuir um ou vários números;

cada número possuir identificação própria;

guardar status da conexão;

guardar configurações;

associar o número à organização;

receber eventos/webhooks futuramente;

enviar mensagens futuramente;

registrar mensagens e eventos.

Não implemente integração fictícia com WhatsApp.

Se ainda não tivermos as credenciais da Meta, construa a arquitetura e o módulo de configuração, mas não simule uma conexão real como se estivesse funcionando.

12. INBOX / MULTIATENDIMENTO

Crie uma interface profissional de atendimento inspirada na experiência de ferramentas modernas de suporte.

A interface deve ter:

lista de conversas;

pesquisa;

filtros;

status;

etiquetas;

prioridade;

agente responsável;

informações do contacto;

histórico;

campo de resposta;

anexos;

notas internas;

transferência de conversa;

atribuição a agente;

encerramento/reabertura.

Estruture o sistema para permitir vários agentes trabalhando simultaneamente.

Utilize realtime quando necessário.

13. CONTACTOS

Criar módulo de contactos contendo:

nome;

telefone;

email;

empresa;

etiquetas;

origem;

observações;

agente responsável;

data de criação;

última interação;

status.

Preparar o sistema para que um contacto possa possuir múltiplas conversas.

14. CRM

Criar CRM inicial com:

leads;

oportunidades;

pipeline;

etapas;

responsável;

valor potencial;

origem;

etiquetas;

notas;

histórico de atividades.

Criar pipeline visual em formato Kanban.

O CRM deve ser modular para futuramente receber outros fluxos comerciais.

15. AUTOMAÇÕES

Criar o primeiro motor de automações.

A arquitetura deve permitir regras do tipo:

QUANDO
→ evento acontece

SE
→ condição for verdadeira

ENTÃO
→ ação acontece.

Exemplos:

Quando uma nova conversa chegar
→ enviar mensagem automática.

Quando uma mensagem contiver determinada palavra
→ executar determinada ação.

Quando o horário estiver fora do expediente
→ enviar resposta configurada.

Quando um novo contacto for criado
→ atribuir etiqueta.

Quando uma conversa entrar em determinada etapa
→ atribuir agente.

Não construir ainda um sistema excessivamente complexo.

Começar com um motor simples, mas arquiteturalmente expansível.

16. IA

Criar o módulo inicial de IA.

A IA deverá posteriormente poder:

responder perguntas;

auxiliar agentes;

sugerir respostas;

classificar conversas;

resumir conversas;

identificar intenção;

criar respostas automáticas;

trabalhar com base de conhecimento.

Nesta primeira etapa, crie principalmente a estrutura do módulo, configurações e interfaces necessárias.

Não coloque nenhuma API key de IA diretamente no frontend.

Preparar a arquitetura para uso de Edge Functions/secrets.

17. CONFIGURAÇÕES

Criar configurações por organização para:

nome da empresa;

logotipo;

telefone;

email;

horário de atendimento;

mensagens automáticas;

equipe;

WhatsApp;

IA;

automações.

18. BANCO DE DADOS INICIAL

Projete uma estrutura inicial coerente contendo, quando necessário, entidades como:

organizations;

profiles;

memberships;

roles;

permissions;

whatsapp_accounts;

whatsapp_numbers;

contacts;

conversations;

conversation_participants;

messages;

conversation_assignments;

tags;

contact_tags;

conversation_tags;

pipelines;

pipeline_stages;

deals;

automation_rules;

automation_actions;

ai_settings;

ai_conversations;

internal_notes;

activity_logs.

Não crie tabelas apenas porque foram citadas acima.

Analise os relacionamentos e crie somente o que for realmente necessário para a primeira arquitetura.

Utilize UUIDs quando apropriado.

Adicione created_at e updated_at nas entidades relevantes.

Crie índices para campos utilizados frequentemente em pesquisa, filtros e relacionamento.

19. SEGURANÇA

Prioridade máxima:

RLS;

isolamento por organização;

autenticação;

autorização baseada em função;

proteção de rotas;

validação de dados;

nenhuma chave secreta no frontend;

nenhuma credencial sensível hardcoded;

Edge Functions para operações privilegiadas.

20. DESIGN

A interface deve parecer uma plataforma SaaS B2B moderna.

Visual:

profissional;

tecnológico;

limpo;

premium;

simples de utilizar;

responsivo;

preparado para desktop e mobile.

Criar identidade própria para Wappy Nus.

Não copiar visualmente a FrontZapp.

Utilizar componentes consistentes, estados de loading, empty states, error states e feedback visual.

21. EXPERIÊNCIA DO USUÁRIO

O primeiro acesso deve conduzir o utilizador por um onboarding simples:

Cadastro
→ criar organização
→ configurar empresa
→ adicionar equipe
→ configurar WhatsApp
→ entrar no Inbox.

A experiência deve ser simples para uma empresa que nunca utilizou uma plataforma desse tipo.

22. PRINCÍPIO DE DESENVOLVIMENTO

Não tente implementar o produto inteiro de uma vez.

Nesta primeira execução, quero que você:

Estruture o projeto;

conecte/prepara o Supabase externo;

configure autenticação;

crie a arquitetura multi-tenant;

crie a estrutura inicial do banco;

implemente RLS;

crie o layout principal;

crie dashboard;

crie sidebar/navegação;

crie as páginas base dos módulos;

deixe a arquitetura preparada para desenvolvimento dos módulos seguintes.

Não avance para funcionalidades complexas sem necessidade.

23. ENTREGÁVEIS DESTA EXECUÇÃO

Depois de concluir esta etapa, mostre claramente:

A. O que foi criado.

B. O que já está conectado.

C. O que ainda depende de configuração externa.

D. A estrutura das tabelas criadas.

E. O SQL/migration completo necessário para o Supabase.

F. As policies RLS criadas.

G. As próximas etapas recomendadas.

IMPORTANTE:

Não invente que uma integração externa está funcional quando ela ainda não estiver configurada.

24. FLUXO OBRIGATÓRIO DO PROJETO

A partir deste momento, siga sempre este processo:

PROMPT
→ IMPLEMENTAÇÃO NA LOVABLE
→ RELATÓRIO DO QUE FOI CRIADO
→ SQL/MIGRATION NECESSÁRIO
→ EXECUÇÃO NO SUPABASE EXTERNO
→ TESTES
→ CORREÇÕES
→ PRÓXIMO MÓDULO.

Quando eu trouxer o resultado da Lovable para esta conversa, analise o resultado e diga exatamente qual deve ser o próximo passo.

25. REGRA FINAL

Não quero apenas uma landing page bonita.

Quero a fundação real de um SaaS.

Priorize:

ARQUITETURA
SEGURANÇA
MULTI-TENANCY
SUPABASE
ESCALABILIDADE
WHATSAPP OFICIAL
EXPERIÊNCIA DO USUÁRIO
MODULARIDADE.

O produto final deve poder evoluir progressivamente de:

FASE 1:
WhatsApp + Multiatendimento + CRM + Automação + IA

para posteriormente:

FASE 2:
Campanhas + Webhooks + Integrações + Analytics + Recuperação de vendas + recursos avançados.

Não implemente a Fase 2 agora, mas construa a Fase 1 de maneira que ela possa receber a Fase 2 posteriormente.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://wappy-nu-connect.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d5ed7cbf-9bd5-49f3-a7c4-499641cb92dd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
