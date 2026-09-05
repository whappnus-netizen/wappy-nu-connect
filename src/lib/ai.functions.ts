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
    const { requireOrgRole } = await import("./whatsapp.server");
    const { generateOrgAiReply } = await import("./ai.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);
    return generateOrgAiReply(data.organizationId, data.message, data.history ?? []);
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
    const { generateOrgAiReply } = await import("./ai.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);

    const admin = serviceClient();
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

    const result = await generateOrgAiReply(
      data.organizationId,
      last.content,
      history.slice(0, -1),
    );
    return result;
  });
