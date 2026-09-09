import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Smartphone,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  QrCode,
  Cloud,
  Power,
  AlertTriangle,
  Loader2,
} from "lucide-react";
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
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { connectWhatsAppNumber, checkWhatsAppNumber } from "@/lib/whatsapp.functions";
import {
  startQrSession,
  refreshQrSession,
  disconnectQrSession,
  reconnectQrSession,
} from "@/lib/whatsapp.qr.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Wappy Nus" },
      {
        name: "description",
        content:
          "Ligue o WhatsApp da sua empresa pela Cloud API oficial da Meta ou por QR Code, com sessões isoladas por organização.",
      },
      { property: "og:title", content: "WhatsApp — Wappy Nus" },
      { property: "og:description", content: "Cloud API oficial da Meta ou ligação por QR Code." },
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
  provider: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  last_synced_at: string | null;
};

type WaSession = {
  id: string;
  whatsapp_number_id: string | null;
  provider: string;
  status: string;
  phone_number: string | null;
  display_name: string | null;
  qr_code: string | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  last_error: string | null;
};

const statusLabel: Record<string, string> = {
  pending: "Pendente",
  disconnected: "Desligado",
  connecting: "A ligar…",
  qr_pending: "Aguarda leitura do QR",
  connected: "Ligado",
  reconnecting: "A reconectar…",
  disabled: "Desactivado",
  suspended: "Suspenso",
  error: "Erro",
};

const providerLabel: Record<string, string> = {
  meta_cloud: "Cloud API (oficial)",
  qr: "QR Code",
};

function WhatsAppPage() {
  const { membership, membershipLoading } = useAuth();
  const orgId = membership?.organization_id;
  const role = membership?.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<"meta_cloud" | "qr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeQrNumber, setActiveQrNumber] = useState<string | null>(null);

  const webhookUrl = "https://whappnus.online/api/public/whatsapp/webhook";

  const { data: numbers, isLoading } = useQuery({
    queryKey: ["whatsapp_numbers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("whatsapp_numbers")
        .select(
          "id, display_name, phone_e164, status, provider, waba_id, phone_number_id, last_synced_at",
        )
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: true });
      if (err) throw new Error(err.message);
      return (data ?? []) as WaNumber[];
    },
  });

  // Sessões QR — sem session_data: as credenciais nunca saem do servidor.
  const { data: sessions } = useQuery({
    queryKey: ["whatsapp_sessions", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("whatsapp_sessions")
        .select(
          "id, whatsapp_number_id, provider, status, phone_number, display_name, qr_code, last_connected_at, last_disconnected_at, last_error",
        )
        .eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
      return (data ?? []) as WaSession[];
    },
  });

  // 7. QR Code em tempo real: cada novo QR gerado no servidor chega aqui.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`wa-sessions-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_sessions",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["whatsapp_sessions", orgId] });
          void queryClient.invalidateQueries({ queryKey: ["whatsapp_numbers", orgId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const connectFn = useServerFn(connectWhatsAppNumber);
  const checkFn = useServerFn(checkWhatsAppNumber);
  const startQrFn = useServerFn(startQrSession);
  const refreshQrFn = useServerFn(refreshQrSession);
  const disconnectQrFn = useServerFn(disconnectQrSession);
  const reconnectQrFn = useServerFn(reconnectQrSession);

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
      setMethod(null);
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

  const startQr = useMutation({
    mutationFn: async (form: { displayName: string; phoneE164: string }) =>
      startQrFn({ data: { organizationId: orgId!, ...form } }),
    onSuccess: (res) => {
      setError(res.error ?? null);
      setActiveQrNumber(res.numberId);
      setMethod(null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_numbers", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_sessions", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const refreshQr = useMutation({
    mutationFn: async (numberId: string) => refreshQrFn({ data: { organizationId: orgId!, numberId } }),
    onSuccess: (res) => {
      setError(res.error ?? null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_sessions", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const disconnectQr = useMutation({
    mutationFn: async (numberId: string) =>
      disconnectQrFn({ data: { organizationId: orgId!, numberId } }),
    onSuccess: () => {
      setActiveQrNumber(null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_sessions", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_numbers", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const reconnectQr = useMutation({
    mutationFn: async (numberId: string) =>
      reconnectQrFn({ data: { organizationId: orgId!, numberId } }),
    onSuccess: (res) => {
      setError(res.error ?? null);
      void queryClient.invalidateQueries({ queryKey: ["whatsapp_sessions", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const sessionFor = (numberId: string) =>
    (sessions ?? []).find((s) => s.whatsapp_number_id === numberId) ?? null;

  const qrSession = activeQrNumber ? sessionFor(activeQrNumber) : null;

  function submitMeta(e: React.FormEvent<HTMLFormElement>) {
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

  function submitQr(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startQr.mutate({
      displayName: String(fd.get("displayName") ?? ""),
      phoneE164: String(fd.get("phoneE164") ?? "").replace(/\s/g, ""),
    });
  }

  return (
    <AppShell
      title="WhatsApp"
      description="Números e ligações WhatsApp da sua organização"
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!orgId || !canManage} onClick={() => setMethod("meta_cloud")}>
            <Cloud className="size-4" /> Cloud API
          </Button>
          <Button size="sm" disabled={!orgId || !canManage} onClick={() => setMethod("qr")}>
            <QrCode className="size-4" /> Conectar por QR Code
          </Button>
        </div>
      }
    >
      {/* Escolha do método */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="font-display text-sm font-semibold">Meta WhatsApp Cloud API</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ligação oficial da Meta, recomendada para produção: mensagens de modelo, verificação da
                empresa e estabilidade suportada pela Meta.
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

        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-start gap-3">
            <QrCode className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="font-display text-sm font-semibold">WhatsApp por QR Code</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Liga o WhatsApp do telemóvel como dispositivo ligado, sem processo de aprovação. Ideal para
                começar rápido.
              </p>
              <p className="mt-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>
                  Esta é uma ligação <strong>não oficial da Meta</strong>. Não é coberta pelo suporte da Meta e
                  pode ser interrompida pelo WhatsApp. Para uso regulado, use a Cloud API oficial.
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {!canManage && !membershipLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Apenas OWNER ou ADMIN podem ligar ou desligar números.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Lista de números */}
      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">A carregar…</p>
        ) : (numbers?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum número ligado"
            description="Escolha “Cloud API” para a ligação oficial da Meta, ou “Conectar por QR Code” para ligar o WhatsApp do seu telemóvel."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {numbers!.map((n) => {
              const session = sessionFor(n.id);
              const isQr = n.provider === "qr";
              const status = isQr ? (session?.status ?? n.status) : n.status;
              return (
                <div key={n.id} className="rounded-xl border border-border bg-card p-5 shadow-soft">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{session?.display_name ?? n.display_name ?? n.phone_e164}</p>
                    <Badge variant={status === "connected" ? "default" : "secondary"}>
                      {statusLabel[status] ?? status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {session?.phone_number ?? n.phone_e164}
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    Método: {providerLabel[n.provider ?? "meta_cloud"] ?? n.provider}
                  </p>

                  <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {isQr ? (
                      <>
                        <div className="flex justify-between gap-2">
                          <dt>Última ligação</dt>
                          <dd>
                            {session?.last_connected_at
                              ? new Date(session.last_connected_at).toLocaleString("pt-PT")
                              : "—"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Última desconexão</dt>
                          <dd>
                            {session?.last_disconnected_at
                              ? new Date(session.last_disconnected_at).toLocaleString("pt-PT")
                              : "—"}
                          </dd>
                        </div>
                        {session?.last_error ? (
                          <div className="pt-1 text-destructive">{session.last_error}</div>
                        ) : null}
                      </>
                    ) : (
                      <>
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
                          <dd>
                            {n.last_synced_at ? new Date(n.last_synced_at).toLocaleString("pt-PT") : "—"}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {isQr ? (
                      <>
                        {status === "connected" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || disconnectQr.isPending}
                            onClick={() => disconnectQr.mutate(n.id)}
                          >
                            <Power className="size-4" /> Desconectar
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={!canManage || reconnectQr.isPending}
                            onClick={() => {
                              setActiveQrNumber(n.id);
                              reconnectQr.mutate(n.id);
                            }}
                          >
                            <QrCode className="size-4" /> Ligar / ver QR
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={refreshQr.isPending}
                          onClick={() => refreshQr.mutate(n.id)}
                        >
                          <RefreshCw className="size-4" /> Actualizar estado
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={check.isPending}
                        onClick={() => check.mutate(n.id)}
                      >
                        <RefreshCw className="size-4" /> Testar ligação
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Diálogo: Cloud API */}
      <Dialog open={method === "meta_cloud"} onOpenChange={(o) => setMethod(o ? "meta_cloud" : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ligar número WhatsApp oficial</DialogTitle>
            <DialogDescription>
              Vai ligar um número da <strong>WhatsApp Cloud API</strong> da Meta à organização{" "}
              <strong>{membership?.organizations?.name ?? "actual"}</strong>. O token de sistema é enviado
              directamente para o servidor, validado na Graph API e guardado numa tabela acessível apenas ao
              servidor — nunca fica no navegador.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitMeta} className="space-y-3">
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
            <DialogFooter>
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? "A validar na Meta…" : "Ligar número"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo: iniciar ligação por QR */}
      <Dialog open={method === "qr"} onOpenChange={(o) => setMethod(o ? "qr" : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp por QR Code</DialogTitle>
            <DialogDescription>
              Indique o número que vai ligar. A sessão é criada apenas para a organização{" "}
              <strong>{membership?.organizations?.name ?? "actual"}</strong> e nunca é partilhada.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitQr} className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="qrDisplayName">Nome de exibição</Label>
              <Input id="qrDisplayName" name="displayName" placeholder="Atendimento Wappy Nus" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="qrPhone">Telefone (E.164)</Label>
              <Input id="qrPhone" name="phoneE164" placeholder="+244912345678" required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={startQr.isPending}>
                {startQr.isPending ? "A criar sessão…" : "Gerar QR Code"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Diálogo: QR Code em tempo real */}
      <Dialog
        open={Boolean(activeQrNumber)}
        onOpenChange={(o) => {
          if (!o) setActiveQrNumber(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              1. Abra o WhatsApp no seu telefone. 2. Vá em Dispositivos conectados. 3. Toque em Conectar
              dispositivo. 4. Escaneie o QR Code abaixo.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-2">
            {qrSession?.status === "connected" ? (
              <div className="w-full space-y-1 rounded-lg border border-border p-4 text-sm">
                <p className="font-display text-base font-semibold">WhatsApp conectado</p>
                <p className="text-muted-foreground">
                  Número: {qrSession.phone_number ?? "—"}
                </p>
                <p className="text-muted-foreground">Conta: {qrSession.display_name ?? "—"}</p>
                <p className="text-muted-foreground">
                  Última conexão:{" "}
                  {qrSession.last_connected_at
                    ? new Date(qrSession.last_connected_at).toLocaleString("pt-PT")
                    : "—"}
                </p>
              </div>
            ) : qrSession?.qr_code ? (
              <img
                src={qrSession.qr_code}
                alt="QR Code para ligar o WhatsApp ao Wappy Nus"
                className="size-64 rounded-lg border border-border bg-white p-2"
              />
            ) : (
              <div className="flex size-64 items-center justify-center rounded-lg border border-dashed border-border">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Estado:{" "}
              {qrSession?.status === "connected"
                ? "WhatsApp conectado"
                : qrSession?.status === "qr_pending"
                  ? "Aguardando leitura…"
                  : qrSession?.status === "connecting"
                    ? "Conectando…"
                    : qrSession?.status === "reconnecting"
                      ? "Reconectando…"
                      : qrSession?.status === "error"
                        ? "Erro na ligação"
                        : "QR Code expirado. A gerar novo código…"}
            </p>
            {qrSession?.last_error ? (
              <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {qrSession.last_error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              size="sm"
              variant="outline"
              disabled={!activeQrNumber || refreshQr.isPending}
              onClick={() => refreshQr.mutate(activeQrNumber!)}
            >
              <RefreshCw className="size-4" /> Gerar novo QR
            </Button>
            {qrSession?.status === "connected" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage || disconnectQr.isPending}
                onClick={() => disconnectQr.mutate(activeQrNumber!)}
              >
                <Power className="size-4" /> Desconectar
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
