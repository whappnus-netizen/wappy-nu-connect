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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTechnicalError(null);

    if (!SUPABASE_URL.includes("icqkoafhitudaqylnnfd.supabase.co")) {
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

    setLoading(false);
    toast.success("Organização criada.");
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
              Pode seguir directamente para o painel de atendimento.
            </p>
            <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>
              Ir para o Dashboard
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