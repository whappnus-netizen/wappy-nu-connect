/**
 * Wappy Nus — serviço de sessões WhatsApp por QR Code (bridge Baileys).
 *
 * PORQUE EXISTE ESTE SERVIÇO
 * A app Wappy Nus corre num runtime serverless que não consegue manter um
 * WebSocket permanente nem estado de autenticação em disco. Uma sessão
 * multi-device de WhatsApp exige as duas coisas. Este processo Node, hospedado
 * à parte (Railway, Render, Fly.io, VPS…), mantém as sessões e comunica com a
 * app por HTTP.
 *
 * LIMITES ÉTICOS/TÉCNICOS (obrigatórios)
 * - Usa a biblioteca de servidor Baileys (protocolo multi-device). Não há
 *   automação de interface, nem Puppeteer, nem scraping de ecrã.
 * - Não há disparo em massa, nem contorno de bloqueios da Meta.
 * - QR Code é uma ligação NÃO OFICIAL da Meta. A app deixa isso explícito.
 *
 * ISOLAMENTO MULTI-TENANT
 * sessionId = "<organization_id>:<whatsapp_number_id>". Cada sessão tem a sua
 * própria pasta de credenciais e o seu próprio socket. Nunca partilhadas.
 *
 * LOCK
 * Um sessionId só pode ter um socket. Pedidos concorrentes reaproveitam o
 * socket existente em vez de abrir outro.
 *
 * API (autenticada com Authorization: Bearer BRIDGE_SECRET)
 *   POST   /sessions                      { sessionId, organizationId, whatsappNumberId }
 *   GET    /sessions/:sessionId
 *   DELETE /sessions/:sessionId
 *   POST   /sessions/:sessionId/messages  { to, body }
 *   GET    /health
 *
 * EVENTOS ENVIADOS À APP (assinados com HMAC SHA-256 do corpo cru)
 *   POST {APP_EVENTS_URL}  header x-wappy-signature: sha256=<hmac>
 */
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

const PORT = process.env.PORT || 8787;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
const APP_EVENTS_URL = process.env.APP_EVENTS_URL;
const SESSIONS_DIR = process.env.SESSIONS_DIR || "./sessions";

if (!BRIDGE_SECRET) throw new Error("BRIDGE_SECRET é obrigatório.");
if (!APP_EVENTS_URL) throw new Error("APP_EVENTS_URL é obrigatório.");

const log = pino({ level: process.env.LOG_LEVEL || "info" });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/** sessionId -> { sock, status, qr, phoneNumber, displayName, error, attempts, starting } */
const sessions = new Map();

function parseSessionId(sessionId) {
  const [organizationId, whatsappNumberId] = String(sessionId).split(":");
  if (!organizationId || !whatsappNumberId) throw new Error("sessionId inválido.");
  return { organizationId, whatsappNumberId };
}

function authDir(sessionId) {
  return path.join(SESSIONS_DIR, sessionId.replace(/[^a-zA-Z0-9:_-]/g, "_"));
}

async function notifyApp(sessionId, event, extra = {}) {
  const { organizationId, whatsappNumberId } = parseSessionId(sessionId);
  const body = JSON.stringify({ organizationId, whatsappNumberId, event, ...extra });
  const signature = crypto.createHmac("sha256", BRIDGE_SECRET).update(body).digest("hex");
  try {
    const res = await fetch(APP_EVENTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wappy-signature": `sha256=${signature}` },
      body,
    });
    if (!res.ok) log.warn({ event, status: res.status }, "app rejeitou evento");
  } catch (e) {
    log.error({ event, err: e.message }, "falha a notificar a app");
  }
}

function publicState(s) {
  return {
    status: s?.status ?? "disconnected",
    qr: s?.qr ?? null,
    phoneNumber: s?.phoneNumber ?? null,
    displayName: s?.displayName ?? null,
    error: s?.error ?? null,
  };
}

function normalizeMessage(msg) {
  const key = msg.key || {};
  const content = msg.message || {};
  const jid = key.remoteJid || "";
  if (jid.endsWith("@g.us") || jid === "status@broadcast") return null; // sem grupos/status

  let type = "system";
  let body = null;
  if (content.conversation) {
    type = "text";
    body = content.conversation;
  } else if (content.extendedTextMessage?.text) {
    type = "text";
    body = content.extendedTextMessage.text;
  } else if (content.imageMessage) {
    type = "image";
    body = content.imageMessage.caption ?? null;
  } else if (content.audioMessage) {
    type = "audio";
  } else if (content.videoMessage) {
    type = "video";
    body = content.videoMessage.caption ?? null;
  } else if (content.documentMessage) {
    type = "document";
    body = content.documentMessage.fileName ?? null;
  }

  return {
    waMessageId: key.id,
    fromWaId: jid.split("@")[0],
    profileName: msg.pushName ?? null,
    messageType: type,
    body,
    mediaId: null,
    sentAt: msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString(),
    fromMe: Boolean(key.fromMe),
  };
}

async function startSession(sessionId) {
  const existing = sessions.get(sessionId);
  // LOCK: nunca dois sockets para o mesmo sessionId.
  if (existing && (existing.starting || existing.sock)) return existing;

  const state = existing ?? { attempts: 0 };
  state.starting = true;
  state.status = "connecting";
  state.error = null;
  sessions.set(sessionId, state);
  await notifyApp(sessionId, "connecting");

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir(sessionId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    browser: ["Wappy Nus", "Chrome", "1.0.0"],
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
  });

  state.sock = sock;
  state.starting = false;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      state.status = "qr_pending";
      await notifyApp(sessionId, "qr", { qr: state.qr });
    }

    if (connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.attempts = 0;
      state.phoneNumber = sock.user?.id ? `+${sock.user.id.split(":")[0]}` : null;
      state.displayName = sock.user?.name ?? null;
      await notifyApp(sessionId, "connected", {
        phoneNumber: state.phoneNumber,
        displayName: state.displayName,
      });
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      state.sock = null;

      if (code === DisconnectReason.loggedOut) {
        state.status = "disconnected";
        state.qr = null;
        fs.rmSync(authDir(sessionId), { recursive: true, force: true });
        sessions.delete(sessionId);
        await notifyApp(sessionId, "disconnected", { error: "Sessão terminada no telefone." });
        return;
      }

      // Reconexão com backoff progressivo (sem loop agressivo).
      state.attempts = (state.attempts ?? 0) + 1;
      if (state.attempts > 8) {
        state.status = "error";
        state.error = "Demasiadas tentativas de reconexão.";
        await notifyApp(sessionId, "error", { error: state.error });
        return;
      }
      const delay = Math.min(60_000, 2000 * 2 ** (state.attempts - 1));
      state.status = "reconnecting";
      await notifyApp(sessionId, "reconnecting", { error: lastDisconnect?.error?.message ?? null });
      setTimeout(() => {
        startSession(sessionId).catch((e) => log.error({ err: e.message }, "reconexão falhou"));
      }, delay);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const normalized = normalizeMessage(msg);
      if (!normalized || normalized.fromMe) continue; // nunca responder a mensagens próprias
      await notifyApp(sessionId, "message", { message: normalized });
    }
  });

  return state;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(BRIDGE_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
});

app.get("/health", (_req, res) => res.json({ ok: true, sessions: sessions.size }));

app.post("/sessions", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    parseSessionId(sessionId);
    const state = await startSession(sessionId);
    res.json(publicState(state));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/sessions/:sessionId", (req, res) => {
  res.json(publicState(sessions.get(req.params.sessionId)));
});

app.delete("/sessions/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  const state = sessions.get(sessionId);
  try {
    if (state?.sock) await state.sock.logout().catch(() => state.sock.end());
  } catch {
    /* ignora falhas de logout */
  }
  sessions.delete(sessionId);
  fs.rmSync(authDir(sessionId), { recursive: true, force: true });
  await notifyApp(sessionId, "disconnected");
  res.json({ ok: true });
});

app.post("/sessions/:sessionId/messages", async (req, res) => {
  const state = sessions.get(req.params.sessionId);
  if (!state?.sock || state.status !== "connected") {
    return res.status(409).json({ error: "sessão não está ligada" });
  }
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: "to e body são obrigatórios" });
  try {
    const jid = `${String(to).replace(/\D/g, "")}@s.whatsapp.net`;
    const sent = await state.sock.sendMessage(jid, { text: String(body) });
    return res.json({ waMessageId: sent?.key?.id ?? null });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => log.info(`Wappy Nus QR bridge a escutar na porta ${PORT}`));
