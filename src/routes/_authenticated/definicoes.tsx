import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/app-shell";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, Building2, UserRound } from "lucide-react";
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
  const [photoTarget, setPhotoTarget] = useState<"profile" | "organization">("profile");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  useEffect(() => {
    setName(membership?.organizations?.name ?? "");
    setTimezone(membership?.organizations?.timezone ?? "Africa/Luanda");
    setCurrency(membership?.organizations?.currency ?? "AOA");
  }, [membership?.organizations?.name, membership?.organizations?.timezone, membership?.organizations?.currency]);

  const assetsQuery = useQuery({
    queryKey: ["settings-assets", user?.id, orgId],
    enabled: Boolean(user?.id && orgId),
    queryFn: async () => {
      const [profileResult, organizationResult] = await Promise.all([
        supabase.from("profiles").select("avatar_url").eq("id", user!.id).maybeSingle(),
        supabase.from("organizations").select("logo_url").eq("id", orgId!).maybeSingle(),
      ]);
      if (profileResult.error) throw new Error(profileResult.error.message);
      if (organizationResult.error) throw new Error(organizationResult.error.message);
      return {
        avatarUrl: profileResult.data?.avatar_url ?? null,
        logoUrl: organizationResult.data?.logo_url ?? null,
      };
    },
  });

  const uploadPhoto = useMutation({
    mutationFn: async () => {
      if (!user?.id || !orgId) throw new Error("Sessão ou organização não encontrada.");
      if (!photoFile) throw new Error("Escolha primeiro uma imagem.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
        throw new Error("Use uma imagem JPG, PNG ou WebP.");
      }
      if (photoFile.size > 5 * 1024 * 1024) throw new Error("A imagem não pode ultrapassar 5 MB.");
      if (photoTarget === "organization" && !canEdit) {
        throw new Error("Apenas OWNER ou ADMIN pode alterar o logótipo da organização.");
      }

      const extension = photoFile.type === "image/png" ? "png" : photoFile.type === "image/webp" ? "webp" : "jpg";
      const path = photoTarget === "profile"
        ? `profiles/${user.id}/avatar.${extension}`
        : `${orgId}/logo.${extension}`;
      const { error: storageError } = await supabase.storage.from("wapnus-assets").upload(path, photoFile, {
        upsert: true,
        contentType: photoFile.type,
        cacheControl: "3600",
      });
      if (storageError) throw new Error(storageError.message);
      const publicUrl = supabase.storage.from("wapnus-assets").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;

      if (photoTarget === "profile") {
        const { data, error: updateError } = await supabase.from("profiles")
          .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
          .eq("id", user.id).select("avatar_url").maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!data) throw new Error("A imagem foi carregada, mas o perfil não foi actualizado. Actualize a página e tente novamente.");
      } else {
        const { data, error: updateError } = await supabase.from("organizations")
          .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
          .eq("id", orgId).select("logo_url").maybeSingle();
        if (updateError) throw new Error(updateError.message);
        if (!data) throw new Error("A imagem foi carregada, mas o logótipo não foi actualizado. Confirme a sua função na organização.");
      }
      return publicUrl;
    },
    onSuccess: async () => {
      setPhotoFile(null);
      toast.success(photoTarget === "profile" ? "Foto pessoal actualizada." : "Logótipo da organização actualizado.");
      await queryClient.invalidateQueries({ queryKey: ["settings-assets", user?.id, orgId] });
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-sm font-semibold">Foto pessoal ou imagem da empresa</h2>
          <p className="mt-1 text-sm text-muted-foreground">Carregue uma foto de perfil ou o logótipo da organização. JPG, PNG ou WebP, até 5 MB.</p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button type="button" variant={photoTarget === "profile" ? "default" : "outline"} onClick={() => setPhotoTarget("profile")} className="w-full">
              <UserRound className="mr-2 size-4" /> Foto pessoal
            </Button>
            <Button type="button" variant={photoTarget === "organization" ? "default" : "outline"} onClick={() => setPhotoTarget("organization")} disabled={!canEdit} className="w-full">
              <Building2 className="mr-2 size-4" /> Logótipo da empresa
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
              {(photoTarget === "profile" ? assetsQuery.data?.avatarUrl : assetsQuery.data?.logoUrl) ? (
                <img
                  src={photoTarget === "profile" ? assetsQuery.data?.avatarUrl ?? undefined : assetsQuery.data?.logoUrl ?? undefined}
                  alt={photoTarget === "profile" ? "Foto de perfil actual" : "Logótipo actual da organização"}
                  className="size-full object-cover"
                />
              ) : (
                photoTarget === "profile" ? <UserRound className="size-8 text-muted-foreground" /> : <Building2 className="size-8 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="settings-photo">Escolher imagem</Label>
                <Input
                  id="settings-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                  disabled={uploadPhoto.isPending || (photoTarget === "organization" && !canEdit)}
                  className="h-auto py-2"
                />
                {photoFile && <p className="break-all text-xs text-muted-foreground">{photoFile.name} · {(photoFile.size / 1024 / 1024).toFixed(2)} MB</p>}
                {photoTarget === "organization" && !canEdit && <p className="text-xs text-muted-foreground">Apenas OWNER ou ADMIN pode alterar o logótipo.</p>}
              </div>
              <Button
                type="button"
                onClick={() => uploadPhoto.mutate()}
                disabled={!photoFile || uploadPhoto.isPending || (photoTarget === "organization" && !canEdit)}
                className="w-full sm:w-auto"
              >
                {uploadPhoto.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Camera className="mr-2 size-4" />}
                {uploadPhoto.isPending ? "A carregar imagem…" : "Guardar imagem"}
              </Button>
            </div>
          </div>
          {assetsQuery.isError && <p role="alert" className="mt-3 text-sm text-destructive">Não foi possível carregar as imagens actuais: {(assetsQuery.error as Error).message}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center gap-2"><h2 className="font-display text-sm font-semibold">Módulos</h2><Badge variant="secondary">Fase 1</Badge></div>
          <p className="mt-2 text-sm text-muted-foreground">WhatsApp por QR Code e Cloud API, multiatendimento, CRM, automações por palavra-chave e IA. Campanhas, webhooks avançados, integrações e analytics avançados permanecem para uma fase futura.</p>
        </section>
      </div>
    </AppShell>
  );
}
