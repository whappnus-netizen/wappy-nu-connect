import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

/** Testa o agente da organização autenticada (nunca usa dados de outra org). */
export const testOrgAiAgent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        organizationId: z.string().uuid(),
        message: z.string().trim().min(1).max(2000),
        history: z.array(turn).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { generateViaWhappNusAI } = await import("./ai-engine.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);

    const admin = serviceClient();
    const { data: number, error } = await admin
      .from("whatsapp_numbers")
      .select("id")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!number?.id) throw new Error("Esta organização ainda não tem um WhatsApp conectado.");

    const result = await generateViaWhappNusAI({
      organizationId: data.organizationId,
      whatsappNumberId: number.id,
      text: data.message,
    });
    return {
      reply: result.text,
      model: result.model,
      agentName: result.agentId ?? "Mia",
      provider: result.provider,
      intent: result.intent,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
      usedKnowledge: result.usedKnowledge,
    };
  });

/**
 * Gera a resposta da IA para uma conversa real de WhatsApp.
 * Preparado para o webhook oficial da Meta: recebe organização + conversa,
 * lê o histórico dessa conversa e devolve a resposta a enviar pela Cloud API.
 */
export const draftAiReplyForConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ organizationId: z.string().uuid(), conversationId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { generateViaWhappNusAI } = await import("./ai-engine.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);

    const admin = serviceClient();
    const { data: conversation, error: conversationError } = await admin
      .from("conversations")
      .select("whatsapp_number_id")
      .eq("organization_id", data.organizationId)
      .eq("id", data.conversationId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation?.whatsapp_number_id) throw new Error("A conversa não está ligada a um WhatsApp.");

    const { data: rows, error } = await admin
      .from("messages")
      .select("direction, body, created_at")
      .eq("organization_id", data.organizationId)
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);

    const history = (rows ?? [])
      .slice()
      .reverse()
      .map((m) => ({
        role: (m as { direction: string }).direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: ((m as { body: string | null }).body ?? "").trim(),
      }))
      .filter((m) => m.content.length > 0);

    const last = [...history].reverse().find((m) => m.role === "user");
    if (!last) throw new Error("Conversa sem mensagem do cliente para responder.");

    const result = await generateViaWhappNusAI({
      organizationId: data.organizationId,
      whatsappNumberId: conversation.whatsapp_number_id as string,
      conversationId: data.conversationId,
      text: last.content,
    });
    return {
      reply: result.text,
      model: result.model,
      agentName: result.agentId ?? "Mia",
      provider: result.provider,
      intent: result.intent,
      confidence: result.confidence,
      latencyMs: result.latencyMs,
      usedKnowledge: result.usedKnowledge,
    };
  });
