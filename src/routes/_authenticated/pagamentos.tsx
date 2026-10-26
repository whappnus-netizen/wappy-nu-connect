import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import { CheckCircle2, Clock3, FileImage, Search, ShieldAlert, XCircle, ReceiptText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pagamentos")({
  head: () => ({ meta: [{ title: "Pagamentos — WHAPPNUS" }, { name: "description", content: "Registe, reveja e acompanhe pagamentos dos seus clientes." }] }),
  component: PaymentsPage,
});

type PaymentStatus = "pending_review" | "confirmed" | "rejected" | "needs_review" | "cancelled" | "refunded";
type Payment = {
  id: string; organization_id: string; contact_id: string | null; conversation_id: string | null;
  amount_aoa: number; currency: string; description: string; payment_method: string; reference: string | null;
  status: PaymentStatus; receipt_path: string | null; receipt_sha256: string | null; received_at: string;
  confirmed_at: string | null; review_note: string | null; created_at: string;
  contacts?: { full_name: string | null; phone_e164: string } | null;
};
const statusLabel: Record<PaymentStatus, string> = {
  pending_review: "Pendente", confirmed: "Confirmado", rejected: "Rejeitado",
  needs_review: "Em revisão", cancelled: "Cancelado", refunded: "Reembolsado",
};
const methodLabel: Record<string, string> = {
  cash: "Dinheiro", bank_transfer: "Transferência bancária", unitel_money: "Unitel Money",
  africell_money: "Africell Money", multicaixa_express: "Multicaixa Express", other: "Outro",
};
const money = (value: number) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 2 }).format(Number(value) || 0);
const sha256 = async (file: File) => {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

function PaymentsPage() {
  const { membership, user } = useAuth();
  const orgId = membership?.organization_id;
  const canReview = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [contactId, setContactId] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewError, setReviewError] = useState("");

  const paymentsQuery = useQuery({
    queryKey: ["customer-payments", orgId],
    enabled: Boolean(orgId),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_payments")
        .select("id,organization_id,contact_id,conversation_id,amount_aoa,currency,description,payment_method,reference,status,receipt_path,receipt_sha256,received_at,confirmed_at,review_note,created_at,contacts(full_name,phone_e164)")
        .eq("organization_id", orgId!).order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Payment[];
    },
  });
  const contactsQuery = useQuery({
    queryKey: ["payment-contacts", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("id,full_name,phone_e164").eq("organization_id", orgId!).order("full_name").limit(500);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const payments = paymentsQuery.data ?? [];
  const filtered = useMemo(() => payments.filter((p) => {
    const matchesStatus = filter === "all" || p.status === filter;
    const haystack = [p.description, p.reference ?? "", p.contacts?.full_name ?? "", p.contacts?.phone_e164 ?? ""].join(" ").toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  }), [payments, filter, search]);
  const totals = useMemo(() => ({
    confirmed: payments.filter((p) => p.status === "confirmed").reduce((sum, p) => sum + Number(p.amount_aoa), 0),
    pending: payments.filter((p) => p.status === "pending_review").length,
    review: payments.filter((p) => p.status === "needs_review").length,
  }), [payments]);

  const createPayment = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id) throw new Error("Não foi possível identificar a organização ou o utilizador.");
      const parsedAmount = Number(amount.replace(",", "."));
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Introduza um valor válido maior que zero.");
      if (description.trim().length < 2) throw new Error("Descreva o motivo do pagamento.");
      if (receipt && !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(receipt.type)) throw new Error("Anexe uma imagem JPG, PNG, WebP ou um PDF.");
      if (receipt && receipt.size > 10 * 1024 * 1024) throw new Error("O comprovativo deve ter no máximo 10 MB.");
      const idempotencyKey = crypto.randomUUID();
      let receiptPath: string | null = null;
      let receiptHash: string | null = null;
      if (receipt) {
        receiptHash = await sha256(receipt);
        const duplicate = await supabase.from("customer_payments").select("id,status").eq("organization_id", orgId).eq("receipt_sha256", receiptHash).maybeSingle();
        if (duplicate.error) throw new Error(duplicate.error.message);
        if (duplicate.data) throw new Error("Este comprovativo já foi registado nesta organização. Verifique o histórico antes de continuar.");
        const safeName = receipt.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-90) || "comprovativo";
        receiptPath = orgId + "/" + crypto.randomUUID() + "-" + safeName;
        const upload = await supabase.storage.from("customer-payment-receipts").upload(receiptPath, receipt, { contentType: receipt.type, upsert: false });
        if (upload.error) throw new Error("Não foi possível guardar o comprovativo: " + upload.error.message);
      }
      const { error } = await supabase.from("customer_payments").insert({
        organization_id: orgId, contact_id: contactId || null, amount_aoa: parsedAmount,
        description: description.trim(), payment_method: method, reference: reference.trim() || null,
        receipt_path: receiptPath, receipt_sha256: receiptHash, created_by: user.id, idempotency_key: idempotencyKey,
        status: "pending_review",
      });
      if (error) {
        if (receiptPath) await supabase.storage.from("customer-payment-receipts").remove([receiptPath]);
        if (error.code === "23505") throw new Error("Este comprovativo ou referência já foi registado. Confirme o histórico antes de repetir.");
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setAmount(""); setDescription(""); setMethod("bank_transfer"); setReference(""); setContactId(""); setReceipt(null);
      setFormError(""); setFormNotice("Pagamento registado como pendente. Só será considerado confirmado após revisão manual.");
      const input = document.getElementById("payment-receipt") as HTMLInputElement | null; if (input) input.value = "";
      void queryClient.invalidateQueries({ queryKey: ["customer-payments", orgId] });
    },
    onError: (error: Error) => { setFormNotice(""); setFormError(error.message); },
  });

  const reviewPayment = useMutation({
    mutationFn: async ({ payment, status }: { payment: Payment; status: PaymentStatus }) => {
      if (!orgId || !user?.id || !canReview) throw new Error("Apenas o proprietário ou administrador pode rever pagamentos.");
      const note = (reviewNotes[payment.id] ?? "").trim();
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status, review_note: note || null, updated_at: now };
      if (status === "confirmed") { patch.confirmed_by = user.id; patch.confirmed_at = now; patch.rejected_by = null; patch.rejected_at = null; }
      if (status === "rejected" || status === "needs_review") { patch.rejected_by = status === "rejected" ? user.id : null; patch.rejected_at = status === "rejected" ? now : null; patch.confirmed_by = null; patch.confirmed_at = null; }
      const { data, error } = await supabase.from("customer_payments").update(patch).eq("id", payment.id).eq("organization_id", orgId).in("status", ["pending_review", "needs_review"]).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Este pagamento já foi revisto ou não está disponível. Actualize a lista.");
    },
    onSuccess: () => { setReviewError(""); void queryClient.invalidateQueries({ queryKey: ["customer-payments", orgId] }); },
    onError: (error: Error) => setReviewError(error.message),
  });

  const openReceipt = async (path: string) => {
    const { data, error } = await supabase.storage.from("customer-payment-receipts").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { setReviewError("Não foi possível abrir o comprovativo. Verifique as permissões da organização."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <AppShell title="Pagamentos" description="Registe pagamentos de clientes e confirme-os após revisão manual.">
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="Total confirmado" value={money(totals.confirmed)} detail="Pagamentos confirmados manualmente" icon={<CheckCircle2 className="size-5" />} />
          <Metric title="Pendentes" value={String(totals.pending)} detail="Aguardam revisão" icon={<Clock3 className="size-5" />} />
          <Metric title="Em revisão" value={String(totals.review)} detail="Precisam de verificação adicional" icon={<ShieldAlert className="size-5" />} />
        </div>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2"><ReceiptText className="size-5 text-primary" /><div><h2 className="font-display font-semibold">Registar pagamento</h2><p className="text-sm text-muted-foreground">O registo não confirma automaticamente que o dinheiro foi recebido.</p></div></div>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); createPayment.mutate(); }}>
            <label className="space-y-1 text-sm"><span className="font-medium">Valor (Kz)</span><Input type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 15000" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Método</span><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}><option value="bank_transfer">Transferência bancária</option><option value="multicaixa_express">Multicaixa Express</option><option value="unitel_money">Unitel Money</option><option value="africell_money">Africell Money</option><option value="cash">Dinheiro</option><option value="other">Outro</option></select></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="font-medium">Descrição</span><Input required minLength={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Pagamento da encomenda #104" /></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Cliente (opcional)</span><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)}><option value="">Sem cliente associado</option>{(contactsQuery.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.full_name || c.phone_e164} — {c.phone_e164}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span className="font-medium">Referência (opcional)</span><Input maxLength={180} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referência bancária ou do recibo" /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="font-medium">Comprovativo (opcional, JPG/PNG/WebP/PDF até 10 MB)</span><Input id="payment-receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></label>
            {formError && <p role="alert" className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{formError}</p>}
            {formNotice && <p role="status" className="md:col-span-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{formNotice}</p>}
            <div className="md:col-span-2"><Button type="submit" disabled={createPayment.isPending}>{createPayment.isPending ? "A registar…" : "Registar como pendente"}</Button></div>
          </form>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><h2 className="font-display font-semibold">Histórico de pagamentos</h2><p className="text-sm text-muted-foreground">Os comprovativos ficam privados e separados por organização.</p></div>
            <div className="relative sm:w-64"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Pesquisar cliente, referência…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select aria-label="Filtrar estado" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as "all" | PaymentStatus)}><option value="all">Todos os estados</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
          {reviewError && <p role="alert" className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{reviewError}</p>}
          {paymentsQuery.isLoading ? <p className="p-6 text-sm text-muted-foreground">A carregar pagamentos…</p> : paymentsQuery.error ? <p role="alert" className="p-6 text-sm text-destructive">Não foi possível carregar pagamentos: {(paymentsQuery.error as Error).message}</p> : filtered.length === 0 ? <div className="p-10 text-center"><ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">Nenhum pagamento encontrado</p><p className="mt-1 text-sm text-muted-foreground">Registe o primeiro pagamento ou ajuste a pesquisa.</p></div> : (
            <div className="divide-y divide-border">
              {filtered.map((p) => <article key={p.id} className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{money(Number(p.amount_aoa))}</h3><Badge variant={p.status === "confirmed" ? "default" : p.status === "rejected" || p.status === "refunded" ? "destructive" : "secondary"}>{statusLabel[p.status]}</Badge></div><p className="mt-1 break-words text-sm">{p.description}</p><p className="mt-1 text-xs text-muted-foreground">{p.contacts?.full_name || p.contacts?.phone_e164 || "Cliente não associado"} · {methodLabel[p.payment_method] ?? p.payment_method} · {new Date(p.received_at).toLocaleString("pt-AO")}</p>{p.reference && <p className="mt-1 text-xs text-muted-foreground">Referência: {p.reference}</p>}{p.review_note && <p className="mt-2 rounded-md bg-secondary p-2 text-sm">Nota da revisão: {p.review_note}</p>}</div>
                  {p.receipt_path && <Button type="button" variant="outline" size="sm" onClick={() => void openReceipt(p.receipt_path!)}><FileImage className="mr-2 size-4" />Abrir comprovativo</Button>}
                </div>
                {canReview && ["pending_review", "needs_review"].includes(p.status) && <div className="space-y-2 rounded-lg border border-border bg-surface/60 p-3"><label className="block space-y-1 text-xs"><span className="font-medium">Nota de revisão (opcional)</span><Textarea rows={2} maxLength={1000} value={reviewNotes[p.id] ?? ""} onChange={(e) => setReviewNotes((prev) => ({ ...prev, [p.id]: e.target.value }))} placeholder="Ex.: Valor confirmado no extrato bancário." /></label><div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewPayment.isPending} onClick={() => reviewPayment.mutate({ payment: p, status: "confirmed" })}><CheckCircle2 className="mr-1 size-4" />Confirmar pagamento</Button><Button size="sm" variant="outline" disabled={reviewPayment.isPending} onClick={() => reviewPayment.mutate({ payment: p, status: "needs_review" })}><ShieldAlert className="mr-1 size-4" />Pedir verificação</Button><Button size="sm" variant="destructive" disabled={reviewPayment.isPending} onClick={() => reviewPayment.mutate({ payment: p, status: "rejected" })}><XCircle className="mr-1 size-4" />Rejeitar</Button></div></div>}
              </article>)}
            </div>
          )}
        </section>
        <p className="text-xs text-muted-foreground">A confirmação é manual. Um comprovativo, por si só, não prova que a transferência foi liquidada. Os registos e anexos não são partilhados entre organizações.</p>
      </div>
    </AppShell>
  );
}

function Metric({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">{title}</span>{icon}</div><p className="mt-3 font-display text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}
