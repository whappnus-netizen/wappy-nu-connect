import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({ organizationId: z.string().uuid() });

type ConversationContact = { contact_id: string | null; assigned_to: string | null; created_at: string };
type DealContact = { contact_id: string | null };
type StageRow = { id: string; name: string };
type ContactRow = { id: string; full_name: string | null; profile_name: string | null };

async function loadBackfillContext(organizationId: string) {
  const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
  await requireOrgRole(organizationId, ["OWNER", "ADMIN"]);
  const admin = serviceClient();

  const [conversationsResult, dealsResult, stageResult, organizationResult] = await Promise.all([
    admin.from("conversations").select("contact_id, assigned_to, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
    admin.from("deals").select("contact_id").eq("organization_id", organizationId),
    admin.from("pipeline_stages").select("id, name").eq("organization_id", organizationId).order("position", { ascending: true }).limit(1).maybeSingle(),
    admin.from("organizations").select("currency").eq("id", organizationId).maybeSingle(),
  ]);
  if (conversationsResult.error) throw new Error(`Não foi possível consultar as conversas: ${conversationsResult.error.message}`);
  if (dealsResult.error) throw new Error(`Não foi possível consultar as oportunidades: ${dealsResult.error.message}`);
  if (stageResult.error) throw new Error(`Não foi possível consultar o funil: ${stageResult.error.message}`);
  if (organizationResult.error) throw new Error(`Não foi possível consultar a moeda da organização: ${organizationResult.error.message}`);
  if (!stageResult.data) throw new Error("O CRM ainda não tem uma etapa inicial configurada.");

  const conversations = (conversationsResult.data ?? []) as ConversationContact[];
  const existingDeals = (dealsResult.data ?? []) as DealContact[];
  const contactIds = [...new Set(conversations.map((row) => row.contact_id).filter((id): id is string => Boolean(id)))];
  const represented = new Set(existingDeals.map((row) => row.contact_id).filter((id): id is string => Boolean(id)));
  const candidateIds = contactIds.filter((id) => !represented.has(id));
  const assignedOwnerByContact = new Map<string, string>();
  for (const row of conversations) {
    if (row.contact_id && row.assigned_to && !assignedOwnerByContact.has(row.contact_id)) {
      assignedOwnerByContact.set(row.contact_id, row.assigned_to);
    }
  }

  return {
    admin,
    organizationId,
    contactIds,
    candidateIds,
    representedCount: contactIds.filter((id) => represented.has(id)).length,
    stage: stageResult.data as StageRow,
    currency: (organizationResult.data as { currency?: string } | null)?.currency || "AOA",
    assignedOwnerByContact,
  };
}

export const previewExistingConversationDeals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const context = await loadBackfillContext(data.organizationId);
    return {
      contactsWithConversations: context.contactIds.length,
      alreadyRepresented: context.representedCount,
      opportunitiesToCreate: context.candidateIds.length,
      initialStage: context.stage.name,
    };
  });

export const syncExistingConversationDeals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const context = await loadBackfillContext(data.organizationId);
    if (context.candidateIds.length === 0) {
      return { createdCount: 0, skippedCount: context.representedCount, failedCount: 0 };
    }

    const { data: contactsData, error: contactsError } = await context.admin
      .from("contacts").select("id, full_name, profile_name")
      .eq("organization_id", context.organizationId).in("id", context.candidateIds);
    if (contactsError) throw new Error(`Não foi possível consultar os contactos: ${contactsError.message}`);
    const contacts = (contactsData ?? []) as ContactRow[];
    let createdCount = 0;
    let skippedCount = context.representedCount;
    let failedCount = 0;

    for (const contact of contacts) {
      const { data: existing, error: existingError } = await context.admin
        .from("deals").select("id").eq("organization_id", context.organizationId)
        .eq("contact_id", contact.id).limit(1).maybeSingle();
      if (existingError) { failedCount += 1; continue; }
      if (existing) { skippedCount += 1; continue; }

      const contactName = contact.full_name?.trim() || contact.profile_name?.trim();
      const title = contactName ? `Oportunidade — ${contactName}` : "Oportunidade WhatsApp";
      const { error: insertError } = await context.admin.from("deals").insert({
        organization_id: context.organizationId,
        contact_id: contact.id,
        stage_id: context.stage.id,
        owner_id: context.assignedOwnerByContact.get(contact.id) ?? null,
        title,
        currency: context.currency,
        status: "open",
      });
      if (insertError) failedCount += 1;
      else createdCount += 1;
    }

    return { createdCount, skippedCount, failedCount };
  });
