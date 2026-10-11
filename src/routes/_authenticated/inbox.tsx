import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { MessagesSquare, Search, Filter, Send, UserPlus, ArrowRightLeft, CheckCircle2, Clock3, RotateCcw, Plus } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp.functions";
import { setConversationAi } from "@/lib/whatsapp.qr.functions";
import { Switch } from "@/components/ui/switch";


export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Wappy Nus" },
      { name: "description", content: "Caixa de entrada única para o atendimento WhatsApp da sua equipa." },
      { property: "og:title", content: "Inbox — Wappy Nus" },
      { property: "og:description", content: "Multiatendimento com filas, etiquetas e transferência." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InboxPage,
});

type Conversation = {
  id: string;
  status: string;
  priority: string;
  last_message_at: string | null;
  contact_id: string | null;
  whatsapp_number_id: string | null;
  ai_enabled: boolean | null;
  assigned_to: string | null;
  whatsapp_numbers: { provider: string | null } | null;

  contacts: { full_name: string | null; phone_e164: string } | null;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
};

const statuses = ["all", "open", "pending", "in_progress", "closed"] as const;

function InboxPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", orgId, status],
    enabled: Boolean(orgId),
    refetchInterval: 15000,
    queryFn: async () => {
      let q = supabase
        .from("conversations")
        .select(
          "id, status, priority, last_message_at, contact_id, whatsapp_number_id, ai_enabled, assigned_to, contacts(full_name, phone_e164), whatsapp_numbers(provider)",
        )

        .eq("organization_id", orgId!)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (status !== "all") q = q.eq("status", status);
      const { data, error: err } = await q;
      if (err) throw new Error(err.message);
      return (data ?? []) as unknown as Conversation[];
    },
  });

  const list = (conversations ?? []).filter((c) =>
    search
      ? `${c.contacts?.full_name ?? ""} ${c.contacts?.phone_e164 ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      : true,
  );

  const active = list.find((c) => c.id === selected) ?? null;

  const { data: messages } = useQuery({
    queryKey: ["messages", selected],
    enabled: Boolean(selected),
    refetchInterval: 10000,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("messages")
        .select("id, direction, message_type, body, status, created_at, sent_at")
        .eq("conversation_id", selected!)
        .order("created_at", { ascending: true })
        .limit(200);
      if (err) throw new Error(err.message);
      return (data ?? []) as Message[];
    },
  });

  // Realtime: novas mensagens da organização actual
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`inbox-${orgId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `organization_id=eq.${orgId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["messages"] });
          void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  const sendFn = useServerFn(sendWhatsAppMessage);
  const send = useMutation({
    mutationFn: async () =>
      sendFn({ data: { organizationId: orgId!, conversationId: selected!, body: draft.trim() } }),
    onSuccess: () => {
      setDraft("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["messages", selected] });
      void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // 13. Controle humano: liga/desliga a IA automática nesta conversa.
  const setAiFn = useServerFn(setConversationAi);
  const toggleAi = useMutation({
    mutationFn: async (enabled: boolean) =>
      setAiFn({ data: { organizationId: orgId!, conversationId: selected!, enabled } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
    onError: (e: Error) => setError(e.message),
  });


  const updateStatus = useMutation({
    mutationFn: async (nextStatus: "open" | "pending" | "in_progress" | "closed") => {
      const { error: err } = await supabase.from("conversations")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", selected!).eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: (_data, nextStatus) => {
      setError(null);
      if (status !== "all") setStatus(nextStatus);
      void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // 13. Ao assumir o atendimento, a IA automática desliga-se nesta conversa.
  const claim = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const { error: err } = await supabase
        .from("conversations")
        .update({ assigned_to: user.user?.id ?? null, status: "in_progress", ai_enabled: false })
        .eq("id", selected!)
        .eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      if (status !== "all") setStatus("in_progress");
      void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const createLead = useMutation({
    mutationFn: async () => {
      if (!orgId || !active?.contact_id) throw new Error("Esta conversa não tem um contacto associado.");
      const { data: existing, error: existingError } = await supabase
        .from("deals").select("id").eq("organization_id", orgId)
        .eq("contact_id", active.contact_id).eq("status", "open").limit(1).maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) throw new Error("Este contacto já tem uma oportunidade aberta no CRM.");

      const { data: stage, error: stageError } = await supabase
        .from("pipeline_stages").select("id").eq("organization_id", orgId)
        .order("position", { ascending: true }).limit(1).maybeSingle();
      if (stageError) throw new Error(stageError.message);
      if (!stage) throw new Error("O funil do CRM ainda não tem etapas configuradas.");

      const contactLabel = active.contacts?.full_name || active.contacts?.phone_e164 || "Contacto";
      const { error: insertError } = await supabase.from("deals").insert({
        organization_id: orgId,
        title: `Novo lead — ${contactLabel}`,
        contact_id: active.contact_id,
        stage_id: stage.id,
        currency: membership?.organizations?.currency ?? "AOA",
        status: "open",
      });
      if (insertError) throw new Error(insertError.message);
    },
    onSuccess: () => {
      setError(null);
      setNotice("Oportunidade criada no CRM, associada a este contacto.");
      void queryClient.invalidateQueries({ queryKey: ["crm", orgId] });
    },
    onError: (e: Error) => { setNotice(null); setError(e.message); },
  });

  return (
    <AppShell title="Inbox" description="Multiatendimento em tempo real — receba, responda, assuma e organize conversas">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr_300px]">
        <section className="rounded-xl border border-border bg-card">
          <div className="space-y-3 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Pesquisar conversas" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    status === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {{ all: "Todas", open: "Abertas", pending: "Pendentes", in_progress: "Em atendimento", closed: "Encerradas" }[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">A carregar…</p>
            ) : list.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                <Filter className="mb-2 size-4" />
                Sem conversas para este filtro.
              </div>
            ) : (
              list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelected(c.id); setNotice(null); setError(null); }}
                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                    selected === c.id ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.contacts?.full_name ?? c.contacts?.phone_e164 ?? "Contacto"}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleString("pt-PT") : "Sem mensagens"}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="flex min-h-[60vh] flex-col rounded-xl border border-border bg-card">
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={MessagesSquare}
                title="Selecione uma conversa"
                description="Escolha uma conversa recebida através do WhatsApp ligado por QR Code ou pela API oficial, para consultar o histórico e responder."
              />
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {(messages ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem mensagens nesta conversa.</p>
              ) : (
                (messages ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-secondary text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      {m.body ?? `[${m.message_type}]`}
                    </p>
                    <p className="mt-1 text-[10px] opacity-70">
                      {new Date(m.sent_at ?? m.created_at).toLocaleTimeString("pt-PT")} · {m.status}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
          <div className="border-t border-border p-3">
            <Textarea
              placeholder={active ? "Escreva a resposta…" : "Selecione uma conversa para responder"}
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!active || send.isPending}
            />
            {error ? (
              <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!active || !draft.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                <Send className="size-4" /> {send.isPending ? "A enviar…" : "Enviar"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {active?.whatsapp_numbers?.provider === "qr"
                  ? "Envio pela ligação WhatsApp — QR (não oficial da Meta)."
                  : "Envio pela WhatsApp Cloud API oficial (janela de 24h aplica-se)."}
              </span>
            </div>
          </div>
        </section>

        <aside className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold">Contacto</h2>
          {active ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{active.contacts?.full_name ?? "Sem nome"}</p>
              <p className="text-muted-foreground">{active.contacts?.phone_e164}</p>
              <Badge variant="secondary" className="text-[10px]">
                {active.whatsapp_numbers?.provider === "qr" ? "WhatsApp — QR" : "WhatsApp — Cloud API"}
              </Badge>
              <p className="text-xs text-muted-foreground">
                Estado: {active.status} · Prioridade: {active.priority}
              </p>
              <div className="mt-3 space-y-2">
                <Button size="sm" variant="outline" className="w-full" disabled={!active.contact_id || createLead.isPending || Boolean(notice)} onClick={() => createLead.mutate()}>
                  <Plus className="mr-1 size-4" />{createLead.isPending ? "A criar oportunidade…" : "Criar oportunidade no CRM"}
                </Button>
                {notice && <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">{notice}</p>}
                {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div>
                  <p className="text-xs font-medium">IA automática</p>
                  <p className="text-[11px] text-muted-foreground">
                    {active.assigned_to
                      ? "Atendimento humano activo"
                      : active.ai_enabled
                        ? "A IA responde automaticamente"
                        : "As mensagens ficam só na caixa de entrada"}
                  </p>
                </div>
                <Switch
                  checked={Boolean(active.ai_enabled)}
                  disabled={toggleAi.isPending}
                  onCheckedChange={(v) => toggleAi.mutate(v)}
                />
              </div>

            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem conversa selecionada.</p>
          )}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado da conversa</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="w-full" disabled={!active || updateStatus.isPending || active.status === "pending"} onClick={() => updateStatus.mutate("pending")}><Clock3 className="mr-1 size-4" />Pendente</Button>
              <Button size="sm" variant="outline" className="w-full" disabled={!active || updateStatus.isPending || active.status === "open"} onClick={() => updateStatus.mutate("open")}><RotateCcw className="mr-1 size-4" />Reabrir</Button>
              <Button size="sm" variant="outline" className="w-full" disabled={!active || updateStatus.isPending || active.status === "in_progress"} onClick={() => updateStatus.mutate("in_progress")}>Em atendimento</Button>
              <Button size="sm" variant="outline" className="w-full" disabled={!active || updateStatus.isPending || active.status === "closed"} onClick={() => updateStatus.mutate("closed")}><CheckCircle2 className="mr-1 size-4" />Encerrar</Button>
            </div>
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={!active || claim.isPending}
              onClick={() => claim.mutate()}
            >
              <UserPlus className="size-4" /> Assumir atendimento
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start" disabled>
              <ArrowRightLeft className="size-4" /> Transferir
            </Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
