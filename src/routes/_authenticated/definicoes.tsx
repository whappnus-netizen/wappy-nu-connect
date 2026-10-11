import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/definicoes")({
  head: () => ({ meta: [{ title: "Definições — Wapnus" }] }),
  component: SettingsPage,
});

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"><span className="text-sm text-muted-foreground">{label}</span><span className="break-all text-right text-sm font-medium">{value}</span></div>;
}

function SettingsPage() {
  const { user, membership } = useAuth();
  const orgId = membership?.organization_id;
  const canEdit = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Africa/Luanda");
  const [currency, setCurrency] = useState("AOA");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(membership?.organizations?.name ?? "");
    setTimezone(membership?.organizations?.timezone ?? "Africa/Luanda");
    setCurrency(membership?.organizations?.currency ?? "AOA");
  }, [membership?.organizations?.name, membership?.organizations?.timezone, membership?.organizations?.currency]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Não foi encontrada uma organização activa.");
      if (!canEdit) throw new Error("Apenas OWNER ou ADMIN podem alterar as definições da organização.");
      if (name.trim().length < 2) throw new Error("O nome da organização deve ter pelo menos 2 caracteres.");
      if (!timezone.trim()) throw new Error("Indique um fuso horário.");
      if (!/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) throw new Error("A moeda deve ser um código de 3 letras, por exemplo AOA.");
      const { error: updateError } = await supabase.from("organizations").update({
        name: name.trim(),
        timezone: timezone.trim(),
        currency: currency.trim().toUpperCase(),
        updated_at: new Date().toISOString(),
      }).eq("id", orgId);
      if (updateError) throw new Error(updateError.message);
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Definições da organização guardadas.");
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => { setNotice(null); setError(e.message); },
  });

  return (
    <AppShell title="Definições" description="Configurações da organização e da conta">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Organização</h2>
          <div className="mt-2">
            <Row label="Identificador" value={membership?.organizations?.slug ?? "—"} />
            <Row label="A sua função" value={membership?.role ?? "—"} />
          </div>
          <form className="mt-4 space-y-4 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="space-y-1.5"><Label htmlFor="org-name">Nome da organização</Label><Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={!canEdit || save.isPending} required /></div>
            <div className="space-y-1.5"><Label htmlFor="org-timezone">Fuso horário (IANA)</Label><Input id="org-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Africa/Luanda" disabled={!canEdit || save.isPending} required /><p className="text-xs text-muted-foreground">Exemplo para Angola: Africa/Luanda.</p></div>
            <div className="space-y-1.5"><Label htmlFor="org-currency">Moeda (código ISO)</Label><Input id="org-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="AOA" disabled={!canEdit || save.isPending} required /></div>
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">{notice}</p>}
            {canEdit ? <Button type="submit" disabled={save.isPending}>{save.isPending ? "A guardar…" : "Guardar definições"}</Button> : <p className="text-xs text-muted-foreground">Contacte o OWNER ou ADMIN para alterar estas definições.</p>}
          </form>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Conta</h2>
          <div className="mt-2">
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="Nome" value={(user?.user_metadata?.["full_name"] as string) ?? "—"} />
            <Row label="Fuso horário da organização" value={timezone} />
            <Row label="Moeda da organização" value={currency} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2"><h2 className="font-display text-sm font-semibold">Módulos</h2><Badge variant="secondary">Fase 1</Badge></div>
          <p className="mt-2 text-sm text-muted-foreground">WhatsApp por QR Code e Cloud API, multiatendimento, CRM, automações por palavra-chave e IA. Campanhas, webhooks avançados, integrações e analytics avançados permanecem para uma fase futura.</p>
        </section>
      </div>
    </AppShell>
  );
}
