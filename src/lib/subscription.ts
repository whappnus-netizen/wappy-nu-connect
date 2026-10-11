import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

export type PlanLimits = {
  whatsapp_numbers?: number;
  agents?: number;
  ai_conversations_monthly?: number;
  automations?: number;
  team_members?: number;
};

export function useSubscriptionAccess(organizationId?: string) {
  const query = useQuery({
    queryKey: ["subscription-access", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [subscriptionResult, organizationResult] = await Promise.all([
        supabase.from("organization_subscriptions")
          .select("status,current_period_end,subscription_plans(name,code,limits)")
          .eq("organization_id", organizationId!)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("organizations")
          .select("status,suspension_reason")
          .eq("id", organizationId!)
          .maybeSingle(),
      ]);
      if (subscriptionResult.error) throw new Error(subscriptionResult.error.message);
      if (organizationResult.error) throw new Error(organizationResult.error.message);
      const subscription = subscriptionResult.data as any;
      const organization = organizationResult.data;
      const end = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : null;
      const active = Boolean(
        subscription &&
        ["active", "trialing"].includes(subscription.status) &&
        (end === null || end > Date.now()) &&
        !["suspended", "blocked", "cancelled"].includes(organization?.status ?? ""),
      );
      return {
        active,
        status: subscription?.status ?? "missing",
        planName: subscription?.subscription_plans?.name ?? "Sem plano",
        planCode: subscription?.subscription_plans?.code ?? null,
        limits: (subscription?.subscription_plans?.limits ?? {}) as PlanLimits,
        currentPeriodEnd: subscription?.current_period_end ?? null,
        organizationStatus: organization?.status ?? "unknown",
      };
    },
  });
  return { ...query, active: query.data?.active ?? false, limits: query.data?.limits ?? {} };
}
