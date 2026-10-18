import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth";
import { Copy, ExternalLink, Loader2, Wallet, Users, Clock3, CheckCircle2, UserRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/parcerias")({
  head: () => ({ meta: [{ title: "Programa de parceiros — WHAPPNUS" }] }),
  component: AffiliatePage,
});

type AffiliateProfile = {
  user_id: string;
  full_name: string;
  age: number;
  mother_name: string | null;
  whatsapp_phone: string;
  profile_photo_path: string | null;
  partner_type: "content" | "commercial" | "strategic";
  tier: "initial" | "pro" | "elite";
  status: "pending" | "approved" | "rejected" | "suspended";
  referral_code: string;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  facebook_url: string | null;
  application_notes: string | null;
  payout_method: "iban" | "unitel_money" | "africell_money" | "other";
  payout_account_name: string;
  bank_name: string | null;
  payout_iban: string | null;
  payout_phone: string | null;
  payout_other_details: string | null;
  rejection_reason: string | null;
};
type AffiliatePortal = {
  profile: AffiliateProfile | null;
  photoUrl: string | null;
  referrals: Array<{ id: string; referral_code: string; status: string; created_at: string; expires_at: string; converted_at: string | null }>;
  commissions: Array<{ id: string; sale_id: string; plan_code: string; commission_type: string; rate: number; base_amount_aoa: number; amount_aoa: number; status: string; eligible_at: string; created_at: string }>;
  payouts: Array<{ id: string; amount_aoa: number; status: string; requested_at: string; reviewed_at: string | null; paid_at: string | null; payment_reference: string | null; admin_note: string | null; rejection_reason: string | null }>;
  stats: { referralCount: number; paidCount: number; pending: number; available: number; totalPaid: number };
  minPayout: number;
};

async function affiliateCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("affiliate-api", { body: { action, ...payload } });
  if (error) {
    let message = error.message || "Não foi possível comunicar com o programa de parceiros.";
    try {
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        const body = await context.clone().json() as { error?: string };
        if (body.error) message = body.error;
      }
    } catch { /* keep the SDK message */ }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error ?? "Não foi possível concluir o pedido.");
  return data.data as T;
}

const money = (value: number | string) => new Intl.NumberFormat("pt-AO", { style: "currency", currency: "AOA", maximumFractionDigits: 0 }).format(Number(value) || 0);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("pt-AO", { dateStyle: "medium" }).format(new Date(value)) : "—";
const statusText: Record<string, string> = { pending: "Em validação", pending_review: "A aguardar revisão", approved: "Disponível", requested: "Solicitado", paid: "Pago", rejected: "Rejeitado", reversed: "Anulado", converted: "Convertido", active: "A acompanhar" };
const partnerText: Record<string, string> = { content: "Influencer / criador de conteúdo", commercial: "Parceiro comercial", strategic: "Parceiro estratégico" };

function AffiliatePage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const portal = useQuery({
    queryKey: ["affiliate-portal", user?.id],
    queryFn: () => affiliateCall<AffiliatePortal>("portal.get"),
    enabled: Boolean(user?.id),
    retry: false,
    refetchInterval: 30_000,
  });
  const profile = portal.data?.profile;
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [motherName, setMotherName] = useState("");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [partnerType, setPartnerType] = useState<"content" | "commercial" | "strategic">("content");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [facebook, setFacebook] = useState("");
  const [applicationNotes, setApplicationNotes] = useState("");
  const [payoutMethod, setPayoutMethod] = useState<"iban" | "unitel_money" | "africell_money" | "other">("iban");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [payoutPhone, setPayoutPhone] = useState("");
  const [otherPayoutDetails, setOtherPayoutDetails] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busyCopy, setBusyCopy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName(String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""));
    setWhatsappPhone(String(user.user_metadata?.phone ?? ""));
  }, [user?.id]);

  useEffect(() => {
    if (!profile || profile.status === "approved") return;
    setFullName(profile.full_name ?? "");
    setAge(String(profile.age ?? ""));
    setMotherName(profile.mother_name ?? "");
    setWhatsappPhone(profile.whatsapp_phone ?? String(user?.user_metadata?.phone ?? ""));
    setPartnerType(profile.partner_type ?? "content");
    setInstagram(profile.instagram_handle ?? "");
    setTiktok(profile.tiktok_handle ?? "");
    setFacebook(profile.facebook_url ?? "");
    setApplicationNotes(profile.application_notes ?? "");
    setPayoutMethod(profile.payout_method ?? "iban");
    setPayoutAccountName(profile.payout_account_name ?? "");
    setBankName(profile.bank_name ?? "");
    setIban(profile.payout_iban ?? "");
    setPayoutPhone(profile.payout_phone ?? "");
    setOtherPayoutDetails(profile.payout_other_details ?? "");
  }, [profile?.user_id, profile?.status]);

  const submitApplication = useMutation({
    mutationFn: async () => {
      if (!fullName.trim() || !Number.isInteger(Number(age)) || Number(age) < 18 || Number(age) > 120) {
        throw new Error("Indica o nome completo e uma idade válida (18 anos ou mais).");
      }
      if (photoFile && !["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
        throw new Error("A fotografia deve estar em JPG, PNG ou WebP.");
      }
      if (photoFile && photoFile.size > 5 * 1024 * 1024) throw new Error("A fotografia não pode ultrapassar 5 MB.");
      let profilePhotoPath = profile?.profile_photo_path ?? "";
      if (photoFile) {
        const signed = await affiliateCall<{ path: string; token: string }>("photo.upload-url", { mimeType: photoFile.type });
        const { error } = await supabase.storage.from("affiliate-photos").uploadToSignedUrl(signed.path, signed.token, photoFile, { contentType: photoFile.type });
        if (error) throw new Error("Não foi possível carregar a fotografia. Tenta novamente.");
        profilePhotoPath = signed.path;
      }
      return affiliateCall("application.submit", {
        fullName: fullName.trim(),
        age: Number(age),
        motherName: motherName.trim() || null,
        whatsappPhone: whatsappPhone.trim(),
        partnerType,
        instagram: instagram.trim() || null,
        tiktok: tiktok.trim() || null,
        facebook: facebook.trim() || null,
        applicationNotes: applicationNotes.trim() || null,
        payoutMethod,
        payoutAccountName: payoutAccountName.trim(),
        bankName: payoutMethod === "iban" ? bankName.trim() : null,
        iban: payoutMethod === "iban" ? iban.replace(/\s/g, "").toUpperCase() : null,
        payoutPhone: ["unitel_money", "africell_money"].includes(payoutMethod) ? payoutPhone.trim() : null,
        otherPayoutDetails: payoutMethod === "other" ? otherPayoutDetails.trim() : null,
        profilePhotoPath: profilePhotoPath || null,
      });
    },
    onSuccess: async () => {
      toast.success("Candidatura enviada. A equipa WHAPPNUS vai analisá-la.");
      setPhotoFile(null);
      await client.invalidateQueries({ queryKey: ["affiliate-portal", user?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const requestPayout = useMutation({
    mutationFn: () => affiliateCall<{ requestId: string }>("payout.request"),
    onSuccess: async () => {
      toast.success("Pedido de pagamento enviado para validação manual.");
      await client.invalidateQueries({ queryKey: ["affiliate-portal", user?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const shareLink = profile?.referral_code ? `${typeof window !== "undefined" ? window.location.origin : "https://whappnus.online"}/auth/registo?ref=${encodeURIComponent(profile.referral_code)}` : "";

  async function copyLink() {
    if (!shareLink) return;
    setBusyCopy(true);
    try {
      await navigator.clipboard.writeText(shareLink);
      toast.success("Link de indicação copiado.");
    } catch {
      toast.error("Não foi possível copiar automaticamente. Seleciona e copia o link.");
    } finally {
      setBusyCopy(false);
    }
  }

  if (portal.isLoading) {
    return <AppShell title="Programa de parceiros" description="Indica a WHAPPNUS e acompanha as tuas comissões"><div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />A carregar o programa…</div></AppShell>;
  }

  if (portal.error) {
    return <AppShell title="Programa de parceiros" description="Indica a WHAPPNUS e acompanha as tuas comissões"><div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{(portal.error as Error).message}<div className="mt-3"><Button variant="outline" onClick={() => void portal.refetch()}>Tentar novamente</Button></div></div></AppShell>;
  }

  const data = portal.data;
  const p = data?.profile;

  if (p?.status === "approved") {
    return (
      <AppShell title="Programa de parceiros" description={partnerText[p.partner_type] + " · Nível " + ({ initial: "Inicial", pro: "Pro", elite: "Elite" }[p.tier] ?? p.tier)}>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-primary" />A tua parceria está ativa</CardTitle>
              <CardDescription>Partilha o teu link. A comissão só é criada quando o pagamento do cliente for confirmado pela Kursinha.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={shareLink} aria-label="Link de indicação" />
                <Button type="button" onClick={() => void copyLink()} disabled={busyCopy || !shareLink}><Copy className="mr-2 size-4" />Copiar link</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Indicações" value={String(data?.stats.referralCount ?? 0)} icon={<Users className="size-4" />} />
                <Stat label="Clientes pagantes" value={String(data?.stats.paidCount ?? 0)} icon={<CheckCircle2 className="size-4" />} />
                <Stat label="Saldo disponível" value={money(data?.stats.available ?? 0)} icon={<Wallet className="size-4" />} />
                <Stat label="Saldo pendente" value={money(data?.stats.pending ?? 0)} icon={<Clock3 className="size-4" />} />
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-semibold">Levantamento manual</p><p className="mt-1 text-xs text-muted-foreground">Podes solicitar a partir de {money(data?.minPayout ?? 10000)} de saldo aprovado. A transferência é feita pela equipa após validação.</p></div>
                <Button onClick={() => requestPayout.mutate()} disabled={requestPayout.isPending || (data?.stats.available ?? 0) < (data?.minPayout ?? 10000)}>{requestPayout.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Solicitar pagamento</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Comissões</CardTitle><CardDescription>O saldo pendente passa a disponível depois do período de validação e da confirmação do pagamento.</CardDescription></CardHeader>
            <CardContent>
              {data?.commissions.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Plano</TableHead><TableHead>Tipo</TableHead><TableHead>Taxa</TableHead><TableHead>Comissão</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader><TableBody>{data.commissions.map((c) => <TableRow key={c.id}><TableCell>{date(c.created_at)}</TableCell><TableCell>{c.plan_code}</TableCell><TableCell>{c.commission_type === "initial" ? "Inicial" : "Renovação"}</TableCell><TableCell>{Number(c.rate)}%</TableCell><TableCell>{money(c.amount_aoa)}</TableCell><TableCell><Badge variant={c.status === "approved" || c.status === "paid" ? "default" : "secondary"}>{statusText[c.status] ?? c.status}</Badge></TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">Ainda não existem comissões registadas.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Pedidos de pagamento</CardTitle><CardDescription>Todos os pedidos são validados e pagos manualmente.</CardDescription></CardHeader>
            <CardContent>
              {data?.payouts.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Valor</TableHead><TableHead>Estado</TableHead><TableHead>Referência</TableHead><TableHead>Nota</TableHead></TableRow></TableHeader><TableBody>{data.payouts.map((x) => <TableRow key={x.id}><TableCell>{date(x.requested_at)}</TableCell><TableCell>{money(x.amount_aoa)}</TableCell><TableCell><Badge variant={x.status === "paid" ? "default" : "secondary"}>{statusText[x.status] ?? x.status}</Badge></TableCell><TableCell>{x.payment_reference ?? "—"}</TableCell><TableCell>{x.rejection_reason ?? x.admin_note ?? "—"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">Ainda não fizeste pedidos de pagamento.</p>}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (p?.status === "suspended") {
    return <AppShell title="Programa de parceiros" description="Estado da candidatura"><Card><CardHeader><CardTitle>Participação suspensa</CardTitle><CardDescription>A tua conta WHAPPNUS continua disponível. Contacta o suporte para pedir uma revisão da participação no programa.</CardDescription></CardHeader></Card></AppShell>;
  }

  return (
    <AppShell title="Programa de parceiros" description="Candidatura sujeita a aprovação da equipa WHAPPNUS">
      <div className="mx-auto max-w-4xl space-y-5">
        {p?.status === "pending" && <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">A tua candidatura está em análise. Podes corrigir os dados abaixo enquanto aguardas a decisão.</div>}
        {p?.status === "rejected" && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><strong>Candidatura não aprovada.</strong> {p.rejection_reason ?? "Podes atualizar os dados e submeter novamente."}</div>}
        <Card>
          <CardHeader><CardTitle>Solicitar adesão ao programa</CardTitle><CardDescription>Preenche os dados necessários para a equipa analisar a candidatura e preparar pagamentos manuais. A fotografia e o nome da mãe são opcionais.</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); submitApplication.mutate(); }}>
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="affiliate-full-name">Nome completo</Label><Input id="affiliate-full-name" required maxLength={160} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" /></div>
                <div className="space-y-1.5"><Label htmlFor="affiliate-age">Idade</Label><Input id="affiliate-age" required type="number" min={18} max={120} step={1} value={age} onChange={(e) => setAge(e.target.value)} /><p className="text-xs text-muted-foreground">O programa é destinado a maiores de 18 anos.</p></div>
                <div className="space-y-1.5"><Label htmlFor="affiliate-whatsapp">Número de WhatsApp</Label><Input id="affiliate-whatsapp" required type="tel" value={whatsappPhone} onChange={(e) => setWhatsappPhone(e.target.value)} placeholder="+244 9xx xxx xxx" autoComplete="tel" /><p className="text-xs text-muted-foreground">Deve corresponder ao contacto associado à tua conta WHAPPNUS.</p></div>
                <div className="space-y-1.5"><Label htmlFor="affiliate-mother">Nome da mãe (opcional)</Label><Input id="affiliate-mother" value={motherName} onChange={(e) => setMotherName(e.target.value)} maxLength={160} /><p className="text-xs text-muted-foreground">Não é necessário para calcular comissões; deixa em branco se não for exigido.</p></div>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="affiliate-photo">Fotografia de perfil (opcional)</Label><Input id="affiliate-photo" type="file" accept="image/jpeg,image/png,image/webp" className="h-auto py-2" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">JPG, PNG ou WebP; máximo 5 MB. A fotografia é privada e visível apenas no portal e para a equipa autorizada.</p>{photoFile && <p className="text-xs text-muted-foreground">{photoFile.name} · {(photoFile.size / 1024 / 1024).toFixed(2)} MB</p>}</div>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Modalidade de parceria</h3>
                <div className="space-y-1.5"><Label htmlFor="affiliate-type">Tipo de parceiro</Label><select id="affiliate-type" value={partnerType} onChange={(e) => setPartnerType(e.target.value as typeof partnerType)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="content">Influencer / criador de conteúdo</option><option value="commercial">Vendedor / consultor comercial</option><option value="strategic">Agência / parceiro estratégico</option></select></div>
                <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="affiliate-instagram">Instagram (opcional)</Label><Input id="affiliate-instagram" value={instagram} onChange={(e) => setInstagram(e.target.value)} maxLength={160} placeholder="@utilizador" /></div><div className="space-y-1.5"><Label htmlFor="affiliate-tiktok">TikTok (opcional)</Label><Input id="affiliate-tiktok" value={tiktok} onChange={(e) => setTiktok(e.target.value)} maxLength={160} placeholder="@utilizador" /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="affiliate-facebook">Facebook / página (opcional)</Label><Input id="affiliate-facebook" value={facebook} onChange={(e) => setFacebook(e.target.value)} maxLength={300} placeholder="https://..." /></div><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="affiliate-notes">Experiência ou proposta (opcional)</Label><Textarea id="affiliate-notes" value={applicationNotes} onChange={(e) => setApplicationNotes(e.target.value)} rows={3} maxLength={1000} placeholder="Que tipo de empresas consegues alcançar? Como pretendes divulgar a WHAPPNUS?" /></div></div>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Dados para pagamento manual</h3>
                <div className="space-y-1.5"><Label htmlFor="affiliate-payout-method">Método de pagamento</Label><select id="affiliate-payout-method" value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value as typeof payoutMethod)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="iban">Transferência bancária (IBAN)</option><option value="unitel_money">Unitel Money</option><option value="africell_money">Africell Money</option><option value="other">Outro método, sujeito a aprovação</option></select></div>
                <div className="space-y-1.5"><Label htmlFor="affiliate-account-name">{payoutMethod === "iban" ? "Nome do titular da conta" : "Nome do titular da carteira"}</Label><Input id="affiliate-account-name" required maxLength={160} value={payoutAccountName} onChange={(e) => setPayoutAccountName(e.target.value)} autoComplete="name" /></div>
                {payoutMethod === "iban" && <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="affiliate-bank">Banco</Label><Input id="affiliate-bank" required value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={120} /></div><div className="space-y-1.5"><Label htmlFor="affiliate-iban">IBAN</Label><Input id="affiliate-iban" required value={iban} onChange={(e) => setIban(e.target.value)} maxLength={80} autoComplete="off" /></div></div>}
                {["unitel_money", "africell_money"].includes(payoutMethod) && <div className="space-y-1.5"><Label htmlFor="affiliate-payout-phone">Número da carteira móvel</Label><Input id="affiliate-payout-phone" required type="tel" value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} maxLength={40} placeholder="+244 9xx xxx xxx" autoComplete="off" /></div>}
                {payoutMethod === "other" && <div className="space-y-1.5"><Label htmlFor="affiliate-payout-other">Detalhes do método alternativo</Label><Textarea id="affiliate-payout-other" required value={otherPayoutDetails} onChange={(e) => setOtherPayoutDetails(e.target.value)} rows={2} maxLength={300} /></div>}
              </section>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">Os dados de pagamento são utilizados para transferências manuais e ficam disponíveis apenas à equipa autorizada. A candidatura não garante aprovação nem gera comissões antes da ativação.</div>
              <Button type="submit" className="w-full sm:w-auto" disabled={submitApplication.isPending}>{submitApplication.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}{submitApplication.isPending ? "A enviar candidatura…" : p?.status === "pending" ? "Atualizar candidatura" : "Enviar candidatura"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs">{label}</span>{icon}</div><div className="mt-2 text-lg font-semibold">{value}</div></div>;
}
