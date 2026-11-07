import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({ meta: [
    { title: "Criar nova palavra-passe — WHAPPNUS" },
    { name: "description", content: "Defina uma nova palavra-passe para a sua conta WHAPPNUS." },
  ] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [validSession, setValidSession] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setValidSession(Boolean(session));
        setChecking(false);
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setValidSession(Boolean(!error && data.session));
      setChecking(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      toast.error("A nova palavra-passe deve ter pelo menos 10 caracteres.");
      return;
    }
    if (password !== confirmation) {
      toast.error("As palavras-passe não coincidem.");
      return;
    }
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("O link de recuperação expirou. Solicita um novo link.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setCompleted(true);
      await supabase.auth.signOut();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível actualizar a palavra-passe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthCard
      title={completed ? "Palavra-passe actualizada" : "Criar nova palavra-passe"}
      subtitle={completed ? "A tua conta está protegida com a nova palavra-passe. Entra novamente para continuar." : "Escolhe uma palavra-passe forte que ainda não tenhas utilizado."}
      footer={<Link to="/auth/login" className="font-medium text-primary">Voltar ao início de sessão</Link>}
    >
      {checking ? <p className="rounded-lg bg-secondary p-4 text-sm text-muted-foreground">A validar o link seguro…</p> :
       completed ? <div role="status" className="rounded-lg bg-secondary p-4 text-sm text-muted-foreground">A palavra-passe foi alterada com sucesso. Já podes iniciar sessão.</div> :
       !validSession ? <div className="space-y-3"><p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">Este link é inválido, já foi utilizado ou expirou. Por segurança, solicita um novo link de recuperação.</p><Button asChild className="w-full"><Link to="/auth/recuperar">Solicitar novo link</Link></Button></div> :
       <form onSubmit={onSubmit} className="space-y-4">
         <div className="space-y-2"><Label htmlFor="new-password">Nova palavra-passe</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /></div>
         <div className="space-y-2"><Label htmlFor="confirm-password">Confirmar palavra-passe</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
         <p className="text-xs text-muted-foreground">Utiliza pelo menos 10 caracteres. Não partilhes o link de recuperação com ninguém.</p>
         <Button type="submit" className="w-full" disabled={saving}>{saving ? "A actualizar…" : "Guardar nova palavra-passe"}</Button>
       </form>}
    </AuthCard>
  );
}
