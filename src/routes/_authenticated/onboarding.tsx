import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

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
  const { user, membership } = useAuth();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    // Criação atómica (organização + OWNER) via função security definer no Supabase.
    const { error } = await supabase.rpc("create_organization", {
      _name: name,
      _slug: slugify(name),
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? "Não foi possível criar a organização.");
      return;
    }
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
          </form>
        )}
      </div>
    </AppShell>
  );
}