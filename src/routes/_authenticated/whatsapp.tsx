import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Smartphone, ShieldCheck, RefreshCw, Copy, Check } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { connectWhatsAppNumber, checkWhatsAppNumber } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Wappy Nus" },
      { name: "description", content: "Ligue números WhatsApp Business à sua organização via Cloud API oficial da Meta." },
      { property: "og:title", content: "WhatsApp — Wappy Nus" },
      { property: "og:description", content: "Configuração de números via WhatsApp Cloud API oficial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WhatsAppPage,
});

type WaNumber = {
  id: string;
  display_name: string | null;
  phone_e164: string;
  status: string;
  waba_id: string | null;
  phone_number_id: string | null;
  last_synced_at: string | null;
};

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  connected: "Ligado",
  disabled: "Desactivado",
  error: "Erro",
};

function WhatsAppPage() {
  const { membership, membershipLoading } = useAuth();
  const orgId = membership?.organization_id;
  const role = membership?.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/whatsapp/webhook` : "";

  const { data: numbers, isLoading } = useQuery({
    queryKey: ["whatsapp_numbers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("whatsapp_numbers")
        .select("id, display_name, phone_e164, status, waba_id, phone_number_id, last_synced_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });
      if (err) throw new Error(err.message);
      return (data ?? []) as WaNumber[];
    },
  });

  const connectFn = useServerFn(connectWhatsAppNumber);
  const checkFn = useServerFn(checkWhatsAppNumber);

  const connect = useMutation({
    mutationFn: async (form: {
      displayName: string;
      phoneE164: string;
      wabaId: string;
      phoneNumberId: string;
      accessToken: string;
    }) => connectFn({ data: { organizationId: orgId!, ...form } }),
    onSuccess: () => {
      setError(null);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_numbers", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const check = useMutation({
    mutationFn: async (numberId: string) => checkFn({ data: { organizationId: orgId!, numberId } }),
    onSuccess: (res) => {
      setError(res.status === "error" ? res.error : null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_numbers", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    connect.mutate({
      displayName: String(fd.get("displayName") ?? ""),
      phoneE164: String(fd.get("phoneE164") ?? "").replace(/\s/g, ""),
      wabaId: String(fd.get("wabaId") ?? ""),
      phoneNumberId: String(fd.get("phoneNumberId") ?? ""),
      accessToken: String(fd.get("accessToken") ?? ""),
    });
  }

  return (
    <AppShell
      title="WhatsApp"
      description="Números e contas WhatsApp Business"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={!orgId || !canManage}>
              Adicionar número
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Ligar número WhatsApp oficial</DialogTitle>
              <DialogDescription>
                Vai ligar um número da <strong>WhatsApp Cloud API</strong> da Meta à organização{" "}
                <strong>{membership?.organizations?.name ?? "actual"}</strong>. São necessárias permissões{" "}
                <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>. O token
                de sistema é enviado directamente para o servidor, validado na Graph API e guardado numa
                tabela acessível apenas ao servidor — nunca fica no navegador.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="displayName">Nome de exibição</Label>
                <Input id="displayName" name="displayName" placeholder="Atendimento Wappy Nus" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="phoneE164">Telefone (E.164)</Label>
                <Input id="phoneE164" name="phoneE164" placeholder="+244912345678" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wabaId">WhatsApp Business Account ID</Label>
                <Input id="wabaId" name="wabaId" placeholder="1234567890" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="phoneNumberId">Phone Number ID</Label>
                <Input id="phoneNumberId" name="phoneNumberId" placeholder="0987654321" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="accessToken">Token de sistema (permanente)</Label>
                <Input id="accessToken" name="accessToken" type="password" autoComplete="off" required />
              </div>
              {error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={connect.isPending}>
                  {connect.isPending ? "A validar na Meta…" : "Ligar número"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="font-display text-sm font-semibold">Apenas infraestrutura oficial</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O Wappy Nus liga-se exclusivamente à WhatsApp Cloud API da Meta. Não usamos WhatsApp Web
              automatizado, QR-code bots nem bibliotecas não oficiais.
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-medium">URL do webhook a configurar no Meta Developers:</p>
              <div className="flex items-center gap-2">
                <code className="truncate rounded bg-secondary px-2 py-1 text-xs">{webhookUrl}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(webhookUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!canManage && !membershipLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Apenas OWNER ou ADMIN podem ligar novos números.
        </p>
      ) : null}
      {error && !open ? (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">A carregar…</p>
        ) : (numbers?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum número ligado"
            description="Clique em “Adicionar número” e introduza o WABA ID, Phone Number ID e token de sistema da sua app Meta para ligar o WhatsApp oficial."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {numbers!.map((n) => (
              <div key={n.id} className="rounded-xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{n.display_name ?? n.phone_e164}</p>
                  <Badge variant={n.status === "connected" ? "default" : "secondary"}>
                    {statusLabel[n.status] ?? n.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{n.phone_e164}</p>
                <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>WABA ID</dt>
                    <dd className="font-mono">{n.waba_id ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Phone Number ID</dt>
                    <dd className="font-mono">{n.phone_number_id ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Última sincronização</dt>
                    <dd>{n.last_synced_at ? new Date(n.last_synced_at).toLocaleString("pt-PT") : "—"}</dd>
                  </div>
                </dl>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  disabled={check.isPending}
                  onClick={() => check.mutate(n.id)}
                >
                  <RefreshCw className="size-4" /> Testar ligação
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
