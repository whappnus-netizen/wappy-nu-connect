import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessagesSquare, Search, Filter, Paperclip, StickyNote, Send, UserPlus, ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Wappy Nus" },
      { name: "description", content: "Caixa de entrada única para o atendimento WhatsApp da sua equipa." },
      { property: "og:title", content: "Inbox — Wappy Nus" },
      { property: "og:description", content: "Multiatendimento com filas, etiquetas e transferência." },
    ],
  }),
  component: InboxPage,
});

type Conversation = {
  id: string;
  subject: string | null;
  status: string;
  priority: string;
  last_message_at: string | null;
  contacts: { full_name: string | null; phone_e164: string } | null;
};

const statuses = ["all", "open", "pending", "in_progress", "closed"] as const;

function InboxPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const [search, setSearch] = useState("");

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", orgId, status],
    enabled: Boolean(orgId),
    queryFn: async () => {
      let q = supabase
        .from("conversations")
        .select("id, subject, status, priority, last_message_at, contacts(full_name, phone_e164)")
        .eq("organization_id", orgId!)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return [] as Conversation[];
      return (data ?? []) as unknown as Conversation[];
    },
  });

  const list = (conversations ?? []).filter((c) =>
    search
      ? `${c.contacts?.full_name ?? ""} ${c.contacts?.phone_e164 ?? ""} ${c.subject ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())
      : true,
  );

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
                <button key={c.id} className="w-full rounded-lg p-3 text-left hover:bg-secondary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.contacts?.full_name ?? c.contacts?.phone_e164 ?? "Contacto"}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{c.subject ?? "Sem assunto"}</p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="flex min-h-[60vh] flex-col rounded-xl border border-border bg-card">
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessagesSquare}
              title="Selecione uma conversa"
              description="As mensagens aparecem aqui depois de ligar um número WhatsApp oficial e receber a primeira conversa."
            />
          </div>
          <div className="border-t border-border p-3">
            <Textarea placeholder="Escreva a resposta…" rows={3} disabled />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled><Send className="size-4" /> Enviar</Button>
              <Button size="sm" variant="outline" disabled><Paperclip className="size-4" /> Anexo</Button>
              <Button size="sm" variant="outline" disabled><StickyNote className="size-4" /> Nota interna</Button>
              <span className="text-xs text-muted-foreground">Envio activo após configurar a Cloud API.</span>
            </div>
          </div>
        </section>

        <aside className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold">Contacto</h2>
          <p className="text-sm text-muted-foreground">Sem conversa selecionada.</p>
          <div className="space-y-2 border-t border-border pt-4">
            <Button size="sm" variant="outline" className="w-full justify-start" disabled><UserPlus className="size-4" /> Atribuir a agente</Button>
            <Button size="sm" variant="outline" className="w-full justify-start" disabled><ArrowRightLeft className="size-4" /> Transferir</Button>
            <Button size="sm" variant="outline" className="w-full justify-start" disabled><CheckCircle2 className="size-4" /> Encerrar</Button>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
