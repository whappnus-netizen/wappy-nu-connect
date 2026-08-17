import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,15}$/, "Telefone deve estar em formato E.164, ex.: +244912345678");

const connectSchema = z.object({
  organizationId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(80),
  phoneE164: phone,
  wabaId: z.string().trim().min(5).max(64),
  phoneNumberId: z.string().trim().min(5).max(64),
  accessToken: z.string().trim().min(20).max(1000),
});

/** Liga um número WhatsApp Business oficial à organização (token fica no servidor). */
export const connectWhatsAppNumber = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => connectSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient, verifyMetaNumber } = await import("./whatsapp.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);

    const meta = await verifyMetaNumber(data.phoneNumberId, data.accessToken);

    const admin = serviceClient();
    const { data: row, error } = await admin
      .from("whatsapp_numbers")
      .upsert(
        {
          organization_id: data.organizationId,
          display_name: meta.verified_name ?? data.displayName,
          phone_e164: data.phoneE164,
          waba_id: data.wabaId,
          phone_number_id: data.phoneNumberId,
          status: "connected",
        },
        { onConflict: "organization_id,phone_e164" },
      )
      .select("id, display_name, phone_e164, status")
      .single();
    if (error) throw new Error(`Base de dados: ${error.message}`);

    const numberId = (row as { id: string }).id;
    const { error: credErr } = await admin.from("whatsapp_credentials").upsert(
      {
        organization_id: data.organizationId,
        whatsapp_number_id: numberId,
        access_token: data.accessToken,
      },
      { onConflict: "whatsapp_number_id" },
    );
    if (credErr) throw new Error(`Credenciais: ${credErr.message}`);

    return {
      id: numberId,
      displayName: (row as { display_name: string | null }).display_name,
      phoneE164: (row as { phone_e164: string }).phone_e164,
      verifiedName: meta.verified_name ?? null,
      qualityRating: meta.quality_rating ?? null,
    };
  });

/** Revalida o número na Graph API e actualiza o estado da ligação. */
export const checkWhatsAppNumber = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid(), numberId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient, metaTokenForNumber, verifyMetaNumber } = await import(
      "./whatsapp.server"
    );
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR"]);

    const admin = serviceClient();
    const { data: number, error } = await admin
      .from("whatsapp_numbers")
      .select("id, phone_number_id, organization_id")
      .eq("id", data.numberId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!number) throw new Error("Número não encontrado nesta organização.");

    const phoneNumberId = (number as { phone_number_id: string | null }).phone_number_id;
    if (!phoneNumberId) throw new Error("Número sem Phone Number ID da Meta.");

    try {
      const token = await metaTokenForNumber(data.numberId);
      const meta = await verifyMetaNumber(phoneNumberId, token);
      await admin
        .from("whatsapp_numbers")
        .update({ status: "connected", display_name: meta.verified_name ?? undefined })
        .eq("id", data.numberId);
      return { status: "connected" as const, qualityRating: meta.quality_rating ?? null, error: null };
    } catch (e) {
      await admin.from("whatsapp_numbers").update({ status: "error" }).eq("id", data.numberId);
      return { status: "error" as const, qualityRating: null, error: (e as Error).message };
    }
  });

/** Envia uma resposta pelo WhatsApp oficial e grava a mensagem outbound. */
export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        conversationId: z.string().uuid(),
        body: z.string().trim().min(1).max(4096),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient, metaTokenForNumber, sendMetaText } = await import(
      "./whatsapp.server"
    );
    const { userId } = await requireOrgRole(data.organizationId, [
      "OWNER",
      "ADMIN",
      "SUPERVISOR",
      "AGENT",
    ]);

    const admin = serviceClient();
    const { data: conv, error } = await admin
      .from("conversations")
      .select("id, whatsapp_number_id, contacts(phone_e164), whatsapp_numbers(phone_number_id)")
      .eq("id", data.conversationId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conv) throw new Error("Conversa não encontrada nesta organização.");

    const c = conv as unknown as {
      whatsapp_number_id: string | null;
      contacts: { phone_e164: string } | null;
      whatsapp_numbers: { phone_number_id: string | null } | null;
    };
    if (!c.contacts?.phone_e164) throw new Error("Conversa sem contacto com telefone.");
    if (!c.whatsapp_number_id || !c.whatsapp_numbers?.phone_number_id) {
      throw new Error("Conversa sem número WhatsApp ligado.");
    }

    const token = await metaTokenForNumber(c.whatsapp_number_id);
    const sent = await sendMetaText(
      c.whatsapp_numbers.phone_number_id,
      token,
      c.contacts.phone_e164,
      data.body,
    );

    const { error: insErr } = await admin.from("messages").insert({
      organization_id: data.organizationId,
      conversation_id: data.conversationId,
      direction: "outbound",
      message_type: "text",
      body: data.body,
      status: "sent",
      wa_message_id: sent.waMessageId,
      sent_by: userId,
    });
    if (insErr) throw new Error(`Mensagem enviada mas não gravada: ${insErr.message}`);

    await admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    return { ok: true, waMessageId: sent.waMessageId };
  });
