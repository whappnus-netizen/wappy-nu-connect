import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/registo")({
  head: () => ({
    meta: [
      { title: "Criar conta — Wappy Nus" },
      { name: "description", content: "Crie a conta da sua empresa e comece a organizar o WhatsApp." },
      { property: "og:title", content: "Criar conta — Wappy Nus" },
      { property: "og:description", content: "Registe a sua empresa no Wappy Nus." },
    ],
  }),
  component: SignupPage,
});

function normalizeSignupPhone(raw: string) {
  let digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = "244" + digits;
  return digits ? "+" + digits : raw.trim();
}

function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim().toLowerCase() === "sthomasshelby51@gmail.com") {
      toast.error("Este email está reservado ao proprietário do Super Admin e não pode criar uma conta de organização.");
      return;
    }
    setLoading(true);
    const normalizedPhone = normalizeSignupPhone(phone);
    const params = new URLSearchParams(window.location.search);
    const referralCode = (params.get("ref") ?? "").trim().toLowerCase();
    const metadata: Record<string, string> = { full_name: fullName.trim(), phone: normalizedPhone };
    if (/^[a-f0-9]{6,32}$/.test(referralCode)) metadata.affiliate_referral_code = referralCode;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: "https://whappnus.online/auth/confirm",
      },
    });
    setLoading(false);
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("account_contact_conflict") || message.includes("contact_phone_already_registered") || message.includes("already registered") || message.includes("duplicate key")) {
        toast.error("Não foi possível concluir o registo com estes dados. Se já tens uma conta, inicia sessão ou recupera a palavra-passe.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    if (data.session) {
      navigate({ to: "/onboarding" });
    } else {
      toast.success("Conta criada. Enviámos um link para confirmar o seu email.");
      // Muda imediatamente para Entrar; não guarda nem transporta a palavra-passe.
      window.location.assign(`/auth/login?registered=1&email=${encodeURIComponent(email.trim().toLowerCase())}`);
    }
  }

  return (
    <AuthCard
      title="Criar conta"
      subtitle="Depois do registo vai criar a sua organização."
      footer={
        <>
          Já tem conta? <Link to="/auth/login" className="font-medium text-primary">Entrar</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nome completo</Label>
          <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Número de WhatsApp de contacto</Label>
          <Input id="phone" type="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+244 9xx xxx xxx" />
          <p className="text-xs text-muted-foreground">Usaremos este contacto para avisos importantes da conta. Cada número de WhatsApp só pode estar associado a uma conta.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email profissional</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Palavra-passe</Label>
          <Input id="password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "A criar..." : "Criar conta"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Ao continuar aceita os <Link to="/termos" className="underline">Termos</Link> e a{" "}
          <Link to="/privacidade" className="underline">Privacidade</Link>.
        </p>
      </form>
    </AuthCard>
  );
}
