import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const addMemberInput = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(254),
  role: z.enum(["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]),
});

export const addExistingTeamMember = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => addMemberInput.parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    const { userId, role: callerRole } = await requireOrgRole(data.organizationId, ["OWNER", "ADMIN"]);
    if (data.role === "OWNER" && callerRole !== "OWNER") {
      throw new Error("Só um OWNER pode atribuir a função de proprietário.");
    }

    const admin = serviceClient();
    const email = data.email.trim().toLowerCase();
    const { data: profile, error: profileError } = await admin
      .from("profiles").select("id, email").eq("email", email).maybeSingle();
    if (profileError) throw new Error(`Falha ao procurar a conta: ${profileError.message}`);
    if (!profile) throw new Error("Não foi encontrada uma conta Wapnus com esse email. A pessoa deve criar uma conta primeiro.");

    const profileRow = profile as { id: string; email: string | null };
    if (profileRow.id === userId) throw new Error("A tua conta já pertence à organização.");

    const { data: existing, error: existingError } = await admin
      .from("memberships").select("user_id")
      .eq("organization_id", data.organizationId).eq("user_id", profileRow.id).maybeSingle();
    if (existingError) throw new Error(`Falha ao verificar a equipa: ${existingError.message}`);
    if (existing) throw new Error("Esta pessoa já pertence à organização.");

    const { error: insertError } = await admin.from("memberships").insert({
      organization_id: data.organizationId,
      user_id: profileRow.id,
      role: data.role,
    });
    if (insertError) throw new Error(`Não foi possível adicionar o membro: ${insertError.message}`);

    return { user_id: profileRow.id, email: profileRow.email, role: data.role };
  });
