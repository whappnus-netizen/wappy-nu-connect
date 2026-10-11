import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";

export type PlanLimits = {
  whatsapp_numbers?: number;
  agents?: number;
  ai_conversations_monthly?: number;
  automations?: number;
  team_members?: number;
};
export type PlanFeatures = Record<string, boolean>;

export function useSubscriptionAccess(organizationId?: string) {
  const query = useQuery({
    queryKey: ["subscription-access", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [subscriptionResult, organizationResult] = await Promise.all([
        supabase.from("organization_subscriptions")
          .select("status,current_period_start,current_period_end,amount_aoa,billing_interval,subscription_plans(name,code,limits,features,price_aoa,trial_days)")
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
      const plan = subscription?.subscription_plans as {
        name?: string; code?: string; limits?: PlanLimits; features?: PlanFeatures; price_aoa?: number; trial_days?: number;
      } | null;
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
        planName: plan?.name ?? "Sem plano",
        planCode: plan?.code ?? null,
        priceAoa: Number(subscription?.amount_aoa ?? plan?.price_aoa ?? 0),
        features: (plan?.features ?? {}) as PlanFeatures,
        limits: (plan?.limits ?? {}) as PlanLimits,
        currentPeriodStart: subscription?.current_period_start ?? null,
        currentPeriodEnd: subscription?.current_period_end ?? null,
        organizationStatus: organization?.status ?? "unknown",
        suspensionReason: organization?.suspension_reason ?? null,
      };
    },
  });
  return { ...query, active: query.data?.active ?? false, limits: query.data?.limits ?? {}, features: query.data?.features ?? {}, planName: query.data?.planName ?? "A verificar plano", planCode: query.data?.planCode ?? null };
}
