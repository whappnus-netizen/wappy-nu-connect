/**
 * Wappy Nus — helpers SERVER-ONLY do WhatsApp Cloud API.
 *
 * Este ficheiro nunca chega ao browser (`*.server.ts` é bloqueado no bundle
 * do cliente) e é a única camada autorizada a usar:
 *   - SUPABASE_SERVICE_ROLE_KEY (bypass de RLS, apenas para o webhook/RPC)
 *   - tokens de sistema da Meta (nunca expostos ao cliente)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";

const FALLBACK_URL = "https://icqkoafhitudaqylnnfd.supabase.co";

export function supabaseUrl(): string {
  return process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? FALLBACK_URL;
}

function anonKey(): string {
  const key = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"];
  if (!key) throw new Error("SUPABASE_ANON_KEY não está configurada no servidor.");
  return key;
}

/** Cliente com service_role: só para webhook e operações privilegiadas verificadas. */
export function serviceClient(): SupabaseClient {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não está configurada no servidor. Adicione-a nos secrets do projeto.",
    );
  }
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type OrgRole = "OWNER" | "ADMIN" | "SUPERVISOR" | "AGENT";

/** Valida o bearer token da sessão e confirma o papel do utilizador na organização. */
export async function requireOrgRole(
  organizationId: string,
  roles: OrgRole[],
): Promise<{ userId: string; role: OrgRole }> {
  const header = getRequestHeader("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Sessão ausente. Faça login novamente.");

  const auth = createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) throw new Error("Sessão inválida ou expirada.");

  const admin = serviceClient();
  const { data: membership, error: mErr } = await admin
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (mErr) throw new Error(`Falha ao validar permissões: ${mErr.message}`);
  if (!membership) throw new Error("Não pertence a esta organização.");

  const role = (membership as { role: OrgRole }).role;
  if (!roles.includes(role)) throw new Error(`Permissão insuficiente (${role}).`);
  return { userId: data.user.id, role };
}

/** Token de sistema da Meta para um número: credencial da organização ou fallback global. */
export async function metaTokenForNumber(numberId: string): Promise<string> {
  const admin = serviceClient();
  const { data } = await admin
    .from("whatsapp_credentials")
    .select("access_token")
    .eq("whatsapp_number_id", numberId)
    .maybeSingle();
  const token = (data as { access_token?: string } | null)?.access_token ?? process.env["META_ACCESS_TOKEN"];
  if (!token) throw new Error("Nenhum token da Meta configurado para este número.");
  return token;
}

/** Confirma que o Phone Number ID + token são válidos (via provider activo). */
export async function verifyMetaNumber(phoneNumberId: string, token: string) {
  const { whatsappProvider } = await import("./whatsapp/provider.server");
  const info = await whatsappProvider().verifyNumber(phoneNumberId, token);
  return {
    id: info.id,
    display_phone_number: info.displayPhoneNumber ?? undefined,
    verified_name: info.verifiedName ?? undefined,
    quality_rating: info.qualityRating ?? undefined,
  };
}

/** Envia mensagem de texto pelo provider activo (Meta oficial ou mock). */
export async function sendMetaText(phoneNumberId: string, token: string, to: string, body: string) {
  const { whatsappProvider } = await import("./whatsapp/provider.server");
  return whatsappProvider().sendText({ phoneNumberId, token, to, body });
}

/**
 * Worker da fila (outbox): reserva atomicamente trabalhos `queued` e envia-os
 * pelo provider activo. Nunca deixa um trabalho preso em `processing`.
 */
export async function processMessageJobs(limit = 10) {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("claim_message_jobs", { _limit: limit });
  if (error) throw new Error(`Fila: ${error.message}`);

  type Job = {
    id: string;
    organization_id: string;
    conversation_id: string | null;
    message_id: string | null;
    whatsapp_number_id: string | null;
    job_type: string;
    payload: { to?: string; body?: string; phone_number_id?: string } | null;
  };
  const jobs = (data ?? []) as Job[];
  let sent = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const to = job.payload?.to;
      const body = job.payload?.body;
      let phoneNumberId = job.payload?.phone_number_id ?? null;

      if (!phoneNumberId && job.whatsapp_number_id) {
        const { data: num } = await admin
          .from("whatsapp_numbers")
          .select("phone_number_id")
          .eq("id", job.whatsapp_number_id)
          .maybeSingle();
        phoneNumberId = (num as { phone_number_id?: string } | null)?.phone_number_id ?? null;
      }
      if (job.job_type !== "send_text") throw new Error(`Tipo de trabalho não suportado: ${job.job_type}`);
      if (!to || !body || !phoneNumberId || !job.whatsapp_number_id) {
        throw new Error("Trabalho sem destino, corpo ou número WhatsApp.");
      }

      const token = await metaTokenForNumber(job.whatsapp_number_id);
      const result = await sendMetaText(phoneNumberId, token, to, body);

      await admin
        .from("message_jobs")
        .update({ status: "sent", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
      if (job.message_id) {
        await admin
          .from("messages")
          .update({ status: "sent", wa_message_id: result.waMessageId })
          .eq("id", job.message_id);
      }
      sent += 1;
    } catch (e) {
      const message = (e as Error).message.slice(0, 500);
      await admin.from("message_jobs").update({ status: "queued", last_error: message }).eq("id", job.id);
      if (job.message_id) {
        await admin.from("messages").update({ status: "failed" }).eq("id", job.message_id);
      }
      failed += 1;
    }
  }

  return { claimed: jobs.length, sent, failed };
}


/** Valida a assinatura X-Hub-Signature-256 do webhook da Meta. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = process.env["META_APP_SECRET"];
  if (!secret) return false;
  if (!signature || !signature.startsWith("sha256=")) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const received = signature.slice("sha256=".length);
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}
