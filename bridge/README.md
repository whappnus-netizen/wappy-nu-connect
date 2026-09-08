# Wappy Nus — serviço de sessões WhatsApp por QR Code

Este é o **único componente que precisa de ser alojado fora do Wappy Nus**.

## Porquê

Uma sessão WhatsApp multi-device (Baileys) precisa de:

- um WebSocket permanente ao WhatsApp,
- credenciais gravadas em disco entre reinícios.

O Wappy Nus corre num runtime serverless (pedidos curtos, sem disco
persistente), por isso não pode manter a sessão. Este processo Node mantém-na e
fala com a app por HTTP. Depois de escanear o QR, pode fechar o navegador: a
sessão continua ligada enquanto este serviço estiver a correr.

## Não faz

Sem Puppeteer, sem automação de interface, sem scraping de ecrã, sem envios em
massa, sem contorno de bloqueios. Apenas o protocolo multi-device oficial do
WhatsApp através da biblioteca Baileys. **QR Code é uma ligação não oficial da
Meta** — para produção regulada use a Cloud API oficial, que continua
disponível no Wappy Nus.

## Alojar

Qualquer sítio com processo persistente e volume: Railway, Render, Fly.io,
Hetzner/VPS com Docker.

```bash
docker build -t wappy-qr-bridge ./bridge
docker run -d --name wappy-qr-bridge -p 8787:8787 \
  -e BRIDGE_SECRET="<segredo-forte-partilhado>" \
  -e APP_EVENTS_URL="https://whappnus.online/api/public/whatsapp/qr/events" \
  -v wappy-sessions:/data \
  wappy-qr-bridge
```

### Variáveis do serviço

| Variável         | Descrição                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `BRIDGE_SECRET`  | Segredo partilhado com a app (autentica e assina os eventos).     |
| `APP_EVENTS_URL` | `https://whappnus.online/api/public/whatsapp/qr/events`           |
| `SESSIONS_DIR`   | Pasta das credenciais (por omissão `/data/sessions` no Docker).   |
| `PORT`           | Porta HTTP (por omissão `8787`).                                  |

### Variáveis a definir no Wappy Nus

| Variável                      | Valor                                            |
| ----------------------------- | ------------------------------------------------ |
| `WHATSAPP_QR_BRIDGE_URL`      | URL público deste serviço, ex. `https://bridge.whappnus.online` |
| `WHATSAPP_QR_BRIDGE_SECRET`   | O mesmo valor de `BRIDGE_SECRET`                  |

O `BRIDGE_SECRET` nunca chega ao navegador: só é lido no servidor.

## Escala

Uma instância aguenta várias sessões. Se um dia precisar de mais instâncias,
encaminhe cada `sessionId` (`organization_id:whatsapp_number_id`) sempre para a
mesma instância — o lock por sessão vive em memória do processo.
