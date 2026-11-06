import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth/login" });
    // A conta principal do proprietário não deve entrar na área de cliente nem
    // criar uma organização sem necessidade; o painel usa armazenamento separado.
    if (data.user.email?.trim().toLowerCase() === "sthomasshelby51@gmail.com") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth/login" });
    }

    // A paid-first account must stay in onboarding until its exact plan is active.
    // This also blocks manual navigation to /dashboard while Kursinha confirmation is pending.
    const planIntent = String(data.user.user_metadata?.selected_plan_code ?? "");
    if (
      location.pathname !== "/onboarding" &&
      ["start-monthly", "pro-monthly", "premium-monthly"].includes(planIntent)
    ) {
      const memberships = await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", data.user.id)
        .eq("role", "OWNER")
        .limit(2);
      const organizationIds = [...new Set((memberships.data ?? []).map((item) => item.organization_id))];
      if (memberships.error || organizationIds.length !== 1) {
        throw redirect({ to: "/onboarding" });
      }

      const activePlan = await supabase
        .from("organization_subscriptions")
        .select("id,current_period_end,subscription_plans!inner(code)")
        .eq("organization_id", organizationIds[0])
        .eq("status", "active")
        .eq("subscription_plans.code", planIntent)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const periodEnd = activePlan.data?.current_period_end
        ? new Date(activePlan.data.current_period_end).getTime()
        : null;
      if (
        activePlan.error ||
        !activePlan.data ||
        (periodEnd !== null && (!Number.isFinite(periodEnd) || periodEnd <= Date.now()))
      ) {
        throw redirect({ to: "/onboarding" });
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
