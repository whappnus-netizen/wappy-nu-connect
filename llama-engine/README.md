# WHAPPNUS Llama Engine V2

Novo motor conversacional independente da WHAPPNUS.

## Objectivo

Executar toda a inferência de linguagem através de um único modelo Llama servido por Ollama. Este serviço substitui, após validação e cutover controlado, os caminhos Native AI e Legacy AI.

## Princípios

- Um único provider de inferência: Ollama.
- Um único modelo configurado explicitamente por deployment (Llama).
- Isolamento rigoroso por organização, agente e conversa.
- Prompts, conhecimento e memória novos; nenhuma importação automática de prompts/memórias legados.
- Histórico operacional de mensagens preservado.
- Geração e entrega separadas, com idempotência, leases e retries limitados.
- Sem fallback silencioso para Gemini, OpenAI ou outro provider.
- Observabilidade sem expor prompts privados, tokens ou dados pessoais.
- API versionada e compatível com integração progressiva pela aplicação WHAPPNUS.

## Fluxo-alvo

1. WhatsApp Gateway recebe e normaliza a mensagem.
2. Orchestrator resolve organização, número, conversa e agente activo.
3. Prompt Builder compõe identidade, objectivo, personalidade, instruções e conhecimento.
4. Memory Engine recupera apenas memória validada da mesma organização/conversa/agente.
5. Ollama executa o modelo Llama.
6. Response Validator verifica formato, continuidade, limites e repetição.
7. Delivery Worker envia a resposta e confirma o estado de entrega.

## Persistência

A persistência será desenhada sobre o Supabase existente, depois de auditar o schema, RLS, RPCs, constraints e políticas. Não criar tabelas nem executar migrations até fechar o desenho e verificar compatibilidade.

Entidades lógicas previstas:
- agentes e versões de prompt por organização;
- documentos/itens de conhecimento;
- memória de conversa (resumo, factos com proveniência e estado);
- jobs de geração;
- outbox de entrega e tentativas.

## Segurança e cutover

- Não apagar tabelas, mensagens, contactos, organizações ou sessões WhatsApp.
- Prompts/memórias antigas ficam inactivas e não são lidas pelo V2.
- O V2 será desenvolvido e testado isoladamente.
- Não activar workers em produção enquanto Native/Legacy ainda puderem consumir as mesmas filas.
- O cutover exige backup, verificação de filas, idempotência, plano de rollback e aprovação explícita.

## Configuração esperada

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL` (modelo Llama exacto, sem fallback)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (apenas no servidor; nunca no frontend/logs)
- `PORT`
- limites de timeout, concorrência e retries definidos por configuração validada.

## Estado

Scaffold inicial. Implementação, schema, testes, integração e deploy ainda não concluídos.
