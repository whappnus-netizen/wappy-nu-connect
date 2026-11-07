import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, MessageSquare, Plus, Send, Clock3, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/suporte")({
  component: SupportPage,
});

type Ticket = {
  id: string; subject: string; category: string; priority: string; status: string;
  last_message_at: string; created_at: string;
};
type SupportMessage = {
  id: string; ticket_id: string; author_user_id: string; author_type: "customer" | "admin";
  body: string; created_at: string;
};

const statusText: Record<string, string> = {
  open: "Aberto", in_progress: "Em atendimento", waiting_customer: "A aguardar resposta",
  resolved: "Resolvido", closed: "Encerrado",
};
const categoryText: Record<string, string> = {
  account: "Conta e acesso", billing: "Pagamentos e renovação", whatsapp: "Ligação WhatsApp",
  ai: "Atendente IA", bookings: "Agendamentos", technical: "Problema técnico", other: "Outro assunto",
};
const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" =>
  status === "resolved" || status === "closed" ? "outline" :
  status === "in_progress" ? "default" : status === "waiting_customer" ? "secondary" : "destructive";

function SupportPage() {
  const { user, membership } = useAuth();
  const orgId = membership?.organization_id;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("normal");
  const [firstMessage, setFirstMessage] = useState("");
  const [reply, setReply] = useState("");

  const tickets = useQuery({
    queryKey: ["support-tickets", orgId],
    enabled: Boolean(orgId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("support_tickets")
        .select("id,subject,category,priority,status,last_message_at,created_at")
        .eq("organization_id", orgId!)
        .order("last_message_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Ticket[];
    },
  });
  const activeId = selectedId && tickets.data?.some(t => t.id === selectedId)
    ? selectedId : tickets.data?.[0]?.id ?? null;
  const selectedTicket = tickets.data?.find(t => t.id === activeId) ?? null;
  const messages = useQuery({
    queryKey: ["support-messages", activeId],
    enabled: Boolean(activeId),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("support_messages")
        .select("id,ticket_id,author_user_id,author_type,body,created_at")
        .eq("ticket_id", activeId!)
        .order("created_at", { ascending: true }).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as SupportMessage[];
    },
  });

  const createTicket = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("A tua conta ainda não está associada a uma organização.");
      const { data, error } = await supabase.rpc("create_support_ticket_with_message", {
        p_organization_id: orgId, p_subject: subject.trim(), p_category: category,
        p_priority: priority, p_body: firstMessage.trim(),
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async (id) => {
      setShowNew(false); setSubject(""); setFirstMessage(""); setCategory("other"); setPriority("normal");
      setSelectedId(id);
      await queryClient.invalidateQueries({ queryKey: ["support-tickets", orgId] });
      toast.success("Pedido de suporte enviado. A nossa equipa irá responder neste ticket.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const sendReply = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !activeId) throw new Error("Não foi possível identificar o ticket.");
      const { error } = await supabase.from("support_messages").insert({
        ticket_id: activeId, organization_id: orgId, author_user_id: user.id,
        author_type: "customer", body: reply.trim(), is_internal: false,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setReply("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["support-messages", activeId] }),
        queryClient.invalidateQueries({ queryKey: ["support-tickets", orgId] }),
      ]);
      toast.success("Mensagem enviada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCount = useMemo(() => (tickets.data ?? []).filter(t => !["resolved", "closed"].includes(t.status)).length, [tickets.data]);

  return (
    <AppShell title="Suporte" description="Fala directamente com a equipa WHAPPNUS.">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Central de suporte</h2><p className="mt-1 text-sm text-muted-foreground">Abre um ticket e acompanha todas as respostas no mesmo lugar.</p></div>
          <Button onClick={() => setShowNew(v => !v)}><Plus className="mr-2 size-4" />Novo pedido</Button>
        </div>

        {showNew && <Card>
          <CardHeader><CardTitle className="text-base">Criar pedido de suporte</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">Assunto<Input value={subject} onChange={e => setSubject(e.target.value)} maxLength={160} placeholder="Ex.: Não consigo ligar o WhatsApp" /></label>
              <label className="grid gap-2 text-sm">Categoria<select value={category} onChange={e => setCategory(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3">{Object.entries(categoryText).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="grid gap-2 text-sm">Prioridade<select value={priority} onChange={e => setPriority(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
            </div>
            <label className="grid gap-2 text-sm">Descreve o problema<Textarea value={firstMessage} onChange={e => setFirstMessage(e.target.value)} rows={5} maxLength={10000} placeholder="Explica o que aconteceu, quando começou e o que já tentaste fazer." /></label>
            <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button><Button disabled={subject.trim().length < 4 || firstMessage.trim().length < 1 || createTicket.isPending} onClick={() => createTicket.mutate()}>{createTicket.isPending ? "A enviar…" : "Enviar pedido"}</Button></div>
          </CardContent>
        </Card>}

        <div className="grid min-h-[520px] gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="min-h-0">
            <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base">Os meus tickets</CardTitle><Badge variant="secondary">{openCount} activos</Badge></div></CardHeader>
            <CardContent className="max-h-[620px] space-y-2 overflow-y-auto px-3">
              {tickets.isLoading ? <p className="p-4 text-sm text-muted-foreground">A carregar pedidos…</p> :
               tickets.error ? <p className="p-4 text-sm text-destructive">{(tickets.error as Error).message}</p> :
               !tickets.data?.length ? <div className="p-4 text-center text-sm text-muted-foreground">Ainda não tens pedidos de suporte.</div> :
               tickets.data.map(ticket => <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={`w-full rounded-lg border p-3 text-left transition ${activeId === ticket.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                 <div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-semibold">{ticket.subject}</span><Badge variant={statusVariant(ticket.status)}>{statusText[ticket.status] ?? ticket.status}</Badge></div>
                 <p className="mt-2 text-xs text-muted-foreground">{categoryText[ticket.category] ?? "Outro assunto"}</p>
                 <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="size-3" />{new Date(ticket.last_message_at).toLocaleString("pt-AO")}</p>
               </button>)}
            </CardContent>
          </Card>

          <Card className="flex min-h-[520px] flex-col">
            {selectedTicket ? <>
              <CardHeader className="border-b pb-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><CardTitle className="text-base">{selectedTicket.subject}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Ticket #{selectedTicket.id.slice(0,8)} · {categoryText[selectedTicket.category]}</p></div><Badge variant={statusVariant(selectedTicket.status)}>{statusText[selectedTicket.status] ?? selectedTicket.status}</Badge></div></CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                <div className="flex-1 space-y-3 overflow-y-auto">
                  {messages.isLoading ? <p className="text-sm text-muted-foreground">A carregar mensagens…</p> :
                   messages.error ? <p className="text-sm text-destructive">{(messages.error as Error).message}</p> :
                   (messages.data ?? []).map(message => <div key={message.id} className={`max-w-[88%] rounded-xl p-3 text-sm ${message.author_type === "admin" ? "mr-auto bg-muted" : "ml-auto bg-primary/10"}`}>
                     <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">{message.author_type === "admin" ? "Equipa WHAPPNUS" : "A tua equipa"}<span className="font-normal">{new Date(message.created_at).toLocaleString("pt-AO")}</span></div>
                     <p className="whitespace-pre-wrap break-words">{message.body}</p>
                   </div>)}
                </div>
                <div className="border-t pt-3"><Textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} maxLength={10000} placeholder="Escreve uma resposta ou acrescenta informação…" /><div className="mt-2 flex justify-end"><Button disabled={!reply.trim() || sendReply.isPending} onClick={() => sendReply.mutate()}><Send className="mr-2 size-4" />{sendReply.isPending ? "A enviar…" : "Enviar mensagem"}</Button></div></div>
              </CardContent>
            </> : <div className="flex flex-1 items-center justify-center p-8"><EmptyState icon={LifeBuoy} title="Estamos aqui para ajudar" description="Selecciona um ticket existente ou cria um novo pedido para falar com a equipa WHAPPNUS." /></div>}
          </Card>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4" />Os teus pedidos são privados e só ficam visíveis para os membros autorizados da tua organização e para a equipa de suporte WHAPPNUS.</p>
      </div>
    </AppShell>
  );
}
