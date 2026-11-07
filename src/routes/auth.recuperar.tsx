import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/recuperar")({
  head: () => ({
    meta: [
      { title: "Recuperar palavra-passe — WHAPPNUS" },
      { name: "description", content: "Receba um link para redefinir a palavra-passe da sua conta WHAPPNUS." },
      { property: "og:title", content: "Recuperar palavra-passe — Wappy Nus" },
      { property: "og:description", content: "Redefinição segura de acesso à conta WHAPPNUS." },
    ],
  }),
  component: RecoverPage,
});

function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch {
      // Keep the response generic so the form never reveals whether an email is registered.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Recuperar palavra-passe"
      subtitle="Enviamos um link seguro para redefinir a sua palavra-passe."
      footer={<Link to="/auth/login" className="font-medium text-primary">Voltar ao login</Link>}
    >
      {sent ? (
        <p className="rounded-lg bg-secondary p-4 text-sm text-muted-foreground">
          Se existir uma conta com {email}, o link de redefinição foi enviado.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "A enviar..." : "Enviar link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
