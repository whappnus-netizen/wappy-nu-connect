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

function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      navigate({ to: "/onboarding" });
    } else {
      toast.success("Confirme o email para activar a conta.");
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
