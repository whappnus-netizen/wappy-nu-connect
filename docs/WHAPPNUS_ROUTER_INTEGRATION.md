# WHAPPNUS Intelligence Router — integração no backend

## Arquitectura

- Frontend: Netlify / TanStack Start.
- Backend de aplicação: server functions e rotas server-side do próprio projecto.
- WhatsApp: Bailer API (QR) e Meta Cloud API, conforme o número.
- Inferência: WHAPPNUS Intelligence Router no Railway.
- Dados, agentes, histórico, créditos, permissões e operações: Supabase + backend WHAPPNUS.

O browser nunca deve chamar o Router directamente nem receber a chave privada.

## Variáveis server-only na Netlify

Configurar nos scopes de Functions/Runtime (e Build quando a aplicação precisar durante o build):

- `WHAPPNUS_ROUTER_URL=https://whappnus-intelligence-router-production.up.railway.app`
- `WHAPPNUS_ROUTER_API_KEY=<mesmo segredo configurado como ROUTER_API_KEY no Railway>`\n\nA função agendada da Netlify reutiliza esta variável server-only para autenticar o endpoint interno do worker; não é necessária uma terceira chave.

Não usar prefixo `VITE_` nestas variáveis. Não colocar a chave em código, ficheiros versionados, logs ou variáveis expostas ao browser.

O Router mantém `ROUTER_API_KEY` no Railway. Não substituir esse nome no Router por uma variável de frontend.

## Contrato

O backend chama `POST /v1/chat/completions` com Bearer auth, `stream:false`, prompt tenant-scoped, histórico recente e metadados não autoritativos. A resposta é lida de `choices[0].message.content`; o caminho seleccionado vem de `whappnus.selected_path`.

O backend carrega `ai_agent_context` com organização, número WhatsApp e agente opcional. O Router não recebe credenciais Supabase e não tem autoridade para executar operações.

## Comportamento e limites actuais

- Texto: ligado ao endpoint de chat do Router.
- Áudio: o backend descarrega o ficheiro do bucket privado `whatsapp-incoming-media` e encaminha-o para `/v1/audio/transcriptions`. Requer Faster-Whisper instalado e operacional no Router.
- Imagens: interpretação indisponível enquanto `vision_enabled=false` / modelo de visão não configurado. O backend não inventa conteúdo visual.
- Comprovativos: extracção automática desactivada nesta integração inicial. Os comprovativos continuam sujeitos a revisão humana; uma imagem nunca confirma um pagamento.
- Agendamentos, encomendas, CRM, pagamentos e cancelamentos: não são executados pelo Router. Só o backend pode validar e executar estas operações. A integração actual não deve ser considerada uma implementação completa de todas as ferramentas operacionais.
- Handoff: quando o Router devolve `handoff_required=true`, o backend pausa a IA na conversa e regista o evento. A notificação proactiva da equipa depende dos mecanismos de notificações já existentes e deve ser validada separadamente.

## Entrega e tempo de execução

A geração nesta branch é síncrona, com timeout de 25 segundos para texto e 30 segundos para transcrição. A fila durável antiga dependia do serviço Native AI Engine removido e do seu worker/callback. Não declarar a entrega durável como migrada até existir e ser testado um worker server-side activo que consuma jobs, faça retries limitados e conclua a entrega idempotente. O callback antigo foi desactivado para impedir que um serviço removido continue a chamar a aplicação.

## Gate antes de produção

1. Confirmar as duas variáveis server-only na Netlify.
2. Confirmar `GET /ready` HTTP 200 no Router.
3. Fazer deploy de preview e testar agente com dados fictícios.\n4. Depois de publicar, confirmar que a função agendada `ai-generation-worker` executa e que o endpoint interno responde apenas com o segredo server-side.
5. Testar duas organizações com preços e regras diferentes.
6. Testar prompt injection, pergunta fora do conhecimento, pedido de humano e nota de voz.
7. Confirmar que nenhum pedido de operação é apresentado como concluído sem validação do backend.
8. Medir latência e verificar logs sem conteúdo privado nem segredos.
9. Só depois activar para números reais, gradualmente.

