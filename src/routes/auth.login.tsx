import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Wappy Nus" },
      { name: "description", content: "Acesso à plataforma de atendimento WhatsApp Wappy Nus." },
      { property: "og:title", content: "Entrar — Wappy Nus" },
      { property: "og:description", content: "Acesso à sua conta Wappy Nus." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/dashboard" });
  }

  return (
    <AuthCard
      title="Entrar"
      subtitle="Acede à caixa de entrada da sua empresa."
      footer={
        <>
          Ainda não tem conta? <Link to="/auth/registo" className="font-medium text-primary">Criar conta</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email profissional</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Palavra-passe</Label>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "A entrar..." : "Entrar"}
        </Button>
        <Link to="/auth/recuperar" className="block text-center text-sm text-muted-foreground hover:text-foreground">
          Esqueci a palavra-passe
        </Link>
      </form>
    </AuthCard>
  );
}
