import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/recuperar")({
  head: () => ({
    meta: [
      { title: "Recuperar palavra-passe — Wappy Nus" },
      { name: "description", content: "Receba um link para redefinir a palavra-passe da sua conta Wappy Nus." },
      { property: "og:title", content: "Recuperar palavra-passe — Wappy Nus" },
      { property: "og:description", content: "Redefinição de acesso à conta Wappy Nus." },
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/login`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthCard
      title="Recuperar palavra-passe"
      subtitle="Enviamos um link de redefinição para o seu email."
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
