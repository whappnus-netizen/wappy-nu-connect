# WHAPPNUS AI Orchestrator — integração segura

## Arquitectura preservada

- Supabase continua a ser a fonte de verdade para organizações, utilizadores, agentes, conhecimento, exemplos de treino, histórico, créditos, conversas e operações.
- O WhatsApp Engine no Railway continua responsável pelas sessões QR Code, recepção e envio de mensagens. A integração não altera o serviço nem o volume de sessões.
- O backend WHAPPNUS continua a carregar o contexto do tenant e a validar regras de negócio.
- O AI Orchestrator é um serviço independente de geração: escolhe Gemini, OpenAI ou Anthropic e devolve texto normalizado.
- Redis é utilizado pelo Orchestrator apenas para rate limits partilhados e protecção anti-replay. Não armazena memória, treino, histórico ou sessões WhatsApp.

## Variáveis server-only na Netlify

Configurar no site `whappnus`, em context `all`, com scopes Builds e Functions:

- `WHAPPNUS_ORCHESTRATOR_URL=whappnus-ai-orchestrator-production.up.railway.app` (o backend normaliza para HTTPS; também aceita a URL completa)
- `WHAPPNUS_ORCHESTRATOR_API_KEY=<segredo partilhado com ORCHESTRATOR_API_KEY no Railway>` (ou alias compatível `ORCHESTRATOR_API_KEY`)
- `WHAPPNUS_TENANT_SIGNING_SECRET=<segredo partilhado com TENANT_SIGNING_SECRET no Railway>` (ou alias compatível `TENANT_SIGNING_SECRET`)
- `WHAPPNUS_AI_WORKER_SECRET=<segredo interno exclusivo para o worker agendado>`

Não usar prefixo `VITE_`, não colocar estes segredos no browser e não os versionar. As variáveis server-side do TanStack Start são injectadas durante o build; depois de as alterar é necessário novo deploy.

No Railway, o serviço WHAPPNUS-AI-ORCHESTRATOR recebe:
- `ORCHESTRATOR_API_KEY`
- `TENANT_SIGNING_SECRET`
- `REDIS_URL` (referência ao serviço Redis já provisionado)
- Uma ou mais credenciais dos provedores, configuradas separadamente.

Os dois primeiros segredos têm de coincidir exactamente com os valores correspondentes da Netlify. O backend dá prioridade aos nomes WHAPPNUS-prefixed; quando ausentes, aceita os nomes legacy `ORCHESTRATOR_API_KEY` e `TENANT_SIGNING_SECRET` para compatibilidade. O segredo do worker é independente e não é enviado ao Orchestrator.

## Health e readiness

O Orchestrator expõe dois endpoints públicos de diagnóstico:
- `GET /health`: confirma que o processo HTTP está activo e responde com `status: ok`.
- `GET /ready`: indica a prontidão dos provedores; devolve `ready` quando pelo menos um provedor está configurado e `degraded` quando nenhum está configurado.

Estes endpoints não substituem um teste autenticado de geração. A resposta `ready` também não garante que uma chamada real ao fornecedor terá sucesso.

## Contrato de autenticação

O backend faz server-to-server `POST /v1/chat/completions`:
- `X-Orchestrator-Key`: segredo de acesso ao serviço.
- `X-Tenant-Timestamp`: Unix timestamp em segundos.
- `X-Tenant-Nonce`: valor aleatório novo em cada pedido.
- `X-Tenant-Signature`: HMAC-SHA256 de `organization_id:timestamp:nonce`.

O backend autentica o utilizador e confirma que a organização pertence à sessão antes de chamar `generateViaWhappNusAI`. O Orchestrator valida assinatura, validade temporal e reutilização de nonce, e aplica quota Redis por organização.

O corpo inclui `organization_id`, `conversation_id`, `system_instructions`, mensagens recentes e metadados mínimos. Não envia credenciais Supabase, tokens WhatsApp nem dados de outras organizações.

## Multimodalidade

O backend descarrega anexos exclusivamente do bucket privado `whatsapp-incoming-media`, validando prefixo de organização/número, MIME e tamanho, e envia os bytes em base64 apenas no pedido:
- Imagem: JPEG, PNG, WebP, GIF (máximo 5 MB).
- Áudio: MPEG, WAV, OGG, MP4, WebM, FLAC (máximo 15 MB).
- Documento: PDF (máximo 10 MB).
- Vídeo e formatos não suportados: não são enviados ao modelo; o agente é instruído a não fingir que analisou o anexo.

O Orchestrator faz routing por capacidades: imagem nos três provedores; áudio no Gemini; PDF no Gemini e Anthropic.

## Worker de geração e entrega

O worker agendado da Netlify continua a consumir a fila durável existente no Supabase e a executar a mesma função de geração. A autenticação do callback interno usa `WHAPPNUS_AI_WORKER_SECRET`, separado das credenciais do Orchestrator. O estado de geração e entrega continua no Supabase, com idempotência e outbox; o WhatsApp Engine continua a executar o envio.

## Segurança e operação

- O browser nunca chama directamente o Orchestrator.
- O backend carrega agente, conhecimento e histórico com filtros de `organization_id`.
- A chave HMAC é gerada por nós e guardada apenas em variáveis privadas.
- Os logs não devem conter mensagens, payloads binários ou segredos.
- O backend de produção já não referencia o Router antigo nem exige `WHAPPNUS_NATIVE_AI_URL`; a pasta `native-ai/` é opcional e não está implantada no Railway. Se existirem variáveis antigas do Router noutros serviços, confirmar os consumidores antes de as remover numa alteração separada.
- As chaves Gemini/OpenAI/Anthropic são colocadas apenas no serviço Orchestrator no Railway, nunca na Netlify.


Deploy previews Netlify (`CONTEXT=deploy-preview`/`branch-deploy`) são bloqueados antes de carregar contexto, consumir créditos ou chamar o Orchestrator. Apenas `production` e desenvolvimento local (`dev`) podem executar inferência. Isto evita que previews com variáveis de produção usem quotas, dados ou a fila de clientes reais.

## Regras de negócio preservadas no backend

- Antes da geração e da análise de comprovativos, o backend chama o RPC idempotente `consume_ai_conversation`. O RPC é definido no Supabase e não é alterado por esta integração; várias chamadas na mesma conversa não descontam conversas adicionais.
- As ferramentas de agendamento vivem em `src/lib/ai-booking-tools.server.ts`. Só são activadas quando `booking_settings.enabled` está activo e as permissões do agente permitem a operação. Cada leitura/escrita é limitada por organização e, quando aplicável, pelo contacto. Criação, cancelamento e remarcação usam RPCs do Supabase e não dependem de texto livre do modelo.
- O backend executa análise multimodal de comprovativos apenas quando existe contexto recente de pagamento. A extracção é guardada em `customer_payments` como `pending_review`; nunca confirma nem aprova automaticamente uma transacção.
- `amount_aoa` só recebe um valor quando a moeda original foi identificada como AOA. Montantes em moeda estrangeira ou sem moeda legível ficam sem conversão automática, com o valor/moeda originais preservados nos dados de extracção.
- As opções `imageUnderstanding` e `audioUnderstanding` do agente são verificadas no backend antes de anexos serem enviados ao fornecedor.
- A transferência humana desactiva `conversations.ai_enabled` na organização e conversa correctas; o marcador interno é removido antes de enviar a resposta ao cliente.

## Testes obrigatórios antes de activar atendimento real

1. Deploy Preview do backend e verificação de build.
2. Health/readiness do Orchestrator e autenticação com assinatura válida.
3. Rejeição de assinatura inválida, timestamp expirado e nonce repetido.
4. Testes com duas organizações e contextos de conhecimento distintos.
5. Testes de texto, imagem, áudio e PDF com dados de teste.
6. Teste de fallback e falha de provedor.
7. Teste do worker, idempotência e entrega pelo WhatsApp Engine.
8. Teste de atendimento manual, IA desligada e handoff humano.
9. Teste final com um número de teste antes de activar tráfego de clientes.


## Política actual de modelos e fallback (fase de validação)

- Modelo principal: Gemini 3.1 Flash Lite (gemini-3.1-flash-lite), tanto para tarefas normais como complexas enquanto o modo avançado estiver desactivado.
- Gemini Pro (gemini-3.1-pro-preview) permanece preparado, mas só pode ser activado no Orchestrator com GEMINI_ADVANCED_ENABLED=true depois de confirmar quota e geração real.
- O modelo principal é configurado por GEMINI_PRIMARY_MODEL; a antiga variável GEMINI_FLASH_MODEL deixa de controlar a selecção.
- Fallback para OpenAI/Anthropic não é inferido pela existência de API keys. Apenas providers incluídos em FALLBACK_PROVIDER_ORDER podem ser utilizados.
- Quota zero, quota esgotada ou saldo insuficiente não devem provocar retries. HTTP 429 de rate limit tem um orçamento de retry mais pequeno.
- Antes de adicionar um provider ao fallback, executar uma geração real com a conta e o modelo exactos que serão utilizados em produção.

## Estado da validação de isolamento

O CI inclui uma regressão estática que verifica que o carregamento de agente/contexto usa organization_id e whatsapp_number_id, que o histórico é filtrado por organization_id e conversation_id, e que os anexos respeitam o prefixo da organização e do número.

Esta regressão não substitui o teste runtime com duas organizações reais. O teste runtime deve ser executado com duas organizações de teste, dois agentes e números WhatsApp separados, seguindo o runbook docs/TENANT_ISOLATION_AND_WHATSAPP_SMOKE_TEST.md.


## Controlo concorrente da quota de conversas

A função consume_ai_conversation foi corrigida numa migração pendente para usar um advisory transaction lock por organização, em vez de um lock por organização + conversa. O lock anterior permitia que duas primeiras mensagens de conversas diferentes, recebidas em simultâneo, lessem o mesmo contador e consumissem ambas a última unidade disponível.

Migração preparada: supabase/migrations/20261127110000_serialize_ai_conversation_usage_per_organization.sql.

Esta migração está apenas no branch/PR; não foi aplicada à base de dados de produção. Aplicá-la pelo processo aprovado do Supabase e validar com duas conversas simultâneas antes de depender dos limites mensais.


## Unificação do inbound WhatsApp (Meta + QR)

A rota Meta valida a assinatura x-hub-signature-256 e encaminha as mensagens recebidas para a Netlify Background Function whatsapp-inbound-background. O webhook responde rapidamente; a função valida WHAPPNUS_AI_WORKER_SECRET, resolve phone_number_id para um whatsapp_numbers activo e chama processIncomingMessage.

O provider QR continua a chamar processIncomingMessage directamente através do endpoint do bridge. Assim, ambos convergem na mesma pipeline de ingestão, contexto do agente, automações, IA e envio.

A rota Meta deixou de chamar directamente a RPC legada ingest_whatsapp_message. A ingestão comum é feita por ingest_provider_message, com a migração 20261127113000_harden_ingest_provider_message.sql a tornar a deduplicação concorrente segura e a separar conversas por organização/contacto/número WhatsApp.

A Background Function está bloqueada em Deploy Previews; só production/dev pode processar mensagens. A variável WHAPPNUS_AI_WORKER_SECRET já é utilizada pelo worker agendado de geração e tem de estar disponível no scope Functions.
