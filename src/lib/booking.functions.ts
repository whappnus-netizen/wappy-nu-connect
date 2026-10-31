import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
export const getBookingWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { requireOrgRole, serviceClient } = await import("./whatsapp.server");
    await requireOrgRole(data.organizationId, ["OWNER", "ADMIN", "SUPERVISOR", "AGENT"]);
    const admin = serviceClient();
    const { data: services, error } = await admin.from("booking_services").select("*").eq("organization_id", data.organizationId);
    if (error) throw new Error(error.message);
    return { services: services ?? [] };
  });
