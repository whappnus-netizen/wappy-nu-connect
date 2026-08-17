import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { MessagesSquare, Search, Filter, Send, UserPlus, ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { sendWhatsAppMessage } from "@/lib/whatsapp.functions";

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

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", orgId, status],
    enabled: Boolean(orgId),
    refetchInterval: 15000,
    queryFn: async () => {
      let q = supabase
        .from("conversations")
        .select("id, status, priority, last_message_at, contact_id, whatsapp_number_id, contacts(full_name, phone_e164)")
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

  const closeConversation = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase
        .from("conversations")
        .update({ status: "closed" })
        .eq("id", selected!)
        .eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const claim = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const { error: err } = await supabase
        .from("conversations")
        .update({ assigned_to: user.user?.id ?? null, status: "in_progress" })
        .eq("id", selected!)
        .eq("organization_id", orgId!);
      if (err) throw new Error(err.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["conversations", orgId] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <AppShell title="Inbox" description="Multiatendimento em tempo real">
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
                  {s === "all" ? "Todas" : s}
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
                  onClick={() => setSelected(c.id)}
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
                description="As conversas aparecem aqui quando o webhook oficial da Meta recebe a primeira mensagem no número ligado."
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
                Envio pela WhatsApp Cloud API oficial (janela de 24h aplica-se).
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
              <p className="text-xs text-muted-foreground">
                Estado: {active.status} · Prioridade: {active.priority}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem conversa selecionada.</p>
          )}
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
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              disabled={!active || closeConversation.isPending}
              onClick={() => closeConversation.mutate()}
            >
              <CheckCircle2 className="size-4" /> Encerrar
            </Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
