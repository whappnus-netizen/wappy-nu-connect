import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { SUPABASE_URL, supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Criar organização — Wappy Nus" },
      { name: "description", content: "Configure a sua empresa para começar a atender clientes no WhatsApp." },
      { property: "og:title", content: "Criar organização — Wappy Nus" },
      { property: "og:description", content: "Primeiro passo na plataforma Wappy Nus." },
    ],
  }),
  component: OnboardingPage,
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function OnboardingPage() {
  const navigate = useNavigate();
  const { user, membership, refreshMembership } = useAuth();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [technicalError, setTechnicalError] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const requestedPlan = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("plan") ?? ""
    : "";
  const selectedPlanCode = ["start-monthly", "pro-monthly", "premium-monthly"].includes(requestedPlan)
    ? requestedPlan
    : (["start-monthly", "pro-monthly", "premium-monthly"].includes(String(user?.user_metadata?.selected_plan_code ?? ""))
      ? String(user?.user_metadata?.selected_plan_code)
      : "");

  async function claimPendingPayments(planCode: string): Promise<boolean> {
    const { data, error } = await supabase.functions.invoke("kursinha-webhook", {
      body: { action: "claim_pending_sales", plan_code: planCode },
    });
    if (error) {
      console.warn("[WhappNus] Não foi possível confirmar a compra agora.", error.message);
      toast.error("Não conseguimos verificar o pagamento neste momento. Tente novamente.");
      return false;
    }
    if (data?.ok === true && (data?.applied === true || data?.already_applied === true)) {
      setPaymentPending(false);
      // Remove the one-time intent so it cannot suppress a future free-trial flow.
      const { error: clearIntentError } = await supabase.auth.updateUser({ data: { selected_plan_code: null } });
      if (clearIntentError) console.warn("[WhappNus] Não foi possível limpar a intenção de compra.", clearIntentError.message);
      toast.success("Pagamento confirmado. O seu plano está activo.");
      return true;
    }
    if (data?.pending === true || data?.reason === "PAYMENT_NOT_CONFIRMED") {
      setPaymentPending(true);
      toast.info("Ainda estamos à espera da confirmação da Kursinha. Pode verificar novamente em instantes.");
      return false;
    }
    console.error("[WhappNus] A compra não pôde ser associada com segurança.", data);
    toast.error(data?.error ?? "Não foi possível associar esta compra. Contacte o suporte.");
    return false;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTechnicalError(null);

    if (!(SUPABASE_URL ?? "").includes("icqkoafhitudaqylnnfd.supabase.co")) {
      const message = `Configuração inválida: o frontend não está ligado ao projeto externo icqkoafhitudaqylnnfd.`;
      console.error("[Wappy Nus] Supabase externo incorreto", { supabaseUrl: SUPABASE_URL });
      setTechnicalError(message);
      toast.error(message);
      return;
    }

    setLoading(true);
    const [{ data: authData, error: authError }, { data: sessionData }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
    const authenticatedUser = authData.user;
    console.info("[Wappy Nus] Diagnóstico de autenticação do onboarding", {
      userId: authenticatedUser?.id ?? null,
      email: authenticatedUser?.email ?? null,
      sessionExists: Boolean(sessionData.session),
      contextUserMatches: Boolean(user && authenticatedUser?.id === user.id),
      authError: authError
        ? { code: authError.code, message: authError.message, status: authError.status }
        : null,
    });

    if (authError || !authenticatedUser || !sessionData.session) {
      const message = authError
        ? `Autenticação inválida — ${authError.code ?? "sem código"}: ${authError.message}`
        : "Não existe uma sessão autenticada. Entre novamente antes de criar a organização.";
      setLoading(false);
      setTechnicalError(message);
      toast.error(message);
      return;
    }

    // Persist the selected paid plan in Auth metadata before the organization trigger runs.
    // This prevents a paid customer from receiving a free trial while payment is being reconciled.
    if (selectedPlanCode && authenticatedUser.user_metadata?.selected_plan_code !== selectedPlanCode) {
      const { error: intentError } = await supabase.auth.updateUser({ data: { selected_plan_code: selectedPlanCode } });
      if (intentError) {
        setLoading(false);
        const message = "Não foi possível guardar o plano seleccionado. Actualize a página e tente novamente.";
        setTechnicalError(message);
        toast.error(message);
        return;
      }
    }

    // Auto-reparação do profile (idempotente, apenas para o próprio utilizador).
    const ensure = await supabase.rpc("ensure_my_profile");
    if (ensure.error) {
      console.warn("[Wappy Nus] ensure_my_profile falhou", ensure.error);
    }

    const rpcResult = await supabase.rpc("create_organization", {
      _name: name,
      _slug: slugify(name),
    });
    const { data, error } = rpcResult;
    console.info("[Wappy Nus] Resultado de create_organization", {
      data,
      error: error
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          }
        : null,
    });

    if (error) {
      const diagnostic = {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      };
      console.error("[Wappy Nus] create_organization falhou", diagnostic);
      setLoading(false);
      const message = [
        `Código: ${error.code || "—"}`,
        `Mensagem: ${error.message || "—"}`,
        `Details: ${error.details || "—"}`,
        `Hint: ${error.hint || "—"}`,
      ].join("\n");
      setTechnicalError(message);
      toast.error(`RPC create_organization falhou: ${error.message}`);
      return;
    }

    const created = Array.isArray(data) ? data[0] : data;
    const createdOrganizationId = created?.organization_id;
    const confirmedMembership = await refreshMembership();

    if (
      !createdOrganizationId ||
      !confirmedMembership ||
      confirmedMembership.organization_id !== createdOrganizationId ||
      confirmedMembership.role !== "OWNER"
    ) {
      console.error("[Wappy Nus] Onboarding incompleto após create_organization", {
        rpcData: data,
        createdOrganizationId,
        confirmedMembership,
      });
      setLoading(false);
      const message = !createdOrganizationId
        ? "O RPC terminou sem erro, mas não devolveu organization_id. O formato retornado não corresponde à assinatura esperada."
        : "O RPC criou a organização, mas a consulta de memberships não confirmou o acesso OWNER.";
      setTechnicalError(message);
      toast.error(message);
      return;
    }

    const contactPhone = String(authenticatedUser.user_metadata?.["phone"] ?? "").trim();
    if (contactPhone) {
      const { error: contactError } = await supabase.from("organizations")
        .update({ contact_phone: contactPhone, updated_at: new Date().toISOString() })
        .eq("id", createdOrganizationId);
      if (contactError) console.warn("[WhappNus] Não foi possível guardar o WhatsApp de contacto da organização.", contactError.message);
    }

    if (selectedPlanCode) {
      const activated = await claimPendingPayments(selectedPlanCode);
      setLoading(false);
      if (!activated) {
        setPaymentPending(true);
        return;
      }
    } else {
      setLoading(false);
      toast.success("Organização criada.");
    }
    navigate({ to: "/dashboard" });
  }

  return (
    <AppShell title="Onboarding" description="Configure a sua empresa">
      <div className="max-w-lg rounded-xl border border-border bg-card p-6">
        {membership ? (
          <>
            <h2 className="font-display text-base font-semibold">
              Já pertence a {membership.organizations?.name ?? "uma organização"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedPlanCode
                ? "A sua organização está pronta. Vamos validar a compra antes de libertar o acesso ao plano."
                : "Pode seguir directamente para o painel de atendimento."}
            </p>
            {paymentPending ? (
              <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                O pagamento ainda não foi confirmado pela Kursinha. Não precisa de criar outra conta nem outra organização. Assim que a confirmação chegar, carregue em verificar novamente.
              </div>
            ) : null}
            <Button className="mt-4" disabled={loading} onClick={async () => {
              if (selectedPlanCode) {
                setLoading(true);
                const activated = await claimPendingPayments(selectedPlanCode);
                setLoading(false);
                if (!activated) return;
              }
              navigate({ to: "/dashboard" });
            }}>
              {loading ? "A verificar pagamento..." : selectedPlanCode ? "Verificar pagamento e activar plano" : "Ir para o Dashboard"}
            </Button>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org">Nome da empresa</Label>
              <Input id="org" required value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Identificador: {name ? slugify(name) : "—"}
              </p>
              {selectedPlanCode ? (
                <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                  Plano seleccionado: <strong>{selectedPlanCode.replace("-monthly", "").toUpperCase()}</strong>. Use o mesmo e-mail informado no checkout da Kursinha. A activação será validada automaticamente depois de criar a organização.
                </p>
              ) : null}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "A criar..." : "Criar organização"}
            </Button>
            {technicalError ? (
              <div role="alert" className="whitespace-pre-wrap border-l-4 border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-semibold">Erro técnico do onboarding</p>
                <p className="mt-1">{technicalError}</p>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </AppShell>
  );
}