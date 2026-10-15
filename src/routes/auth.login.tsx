import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { superadminSupabase } from "@/lib/supabase/superadmin-client";
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
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("email") ?? "";
  });
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "1") return "Email confirmado. Agora entre com a sua palavra-passe."; 
    if (params.get("registered") === "1") return "Conta criada. Confirme o email que enviámos e depois entre aqui."; 
    return "";
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const reservedOwnerEmail = "sthomasshelby51@gmail.com";

    // A conta principal do proprietário autentica-se num armazenamento isolado.
    // Assim, entrar numa conta de cliente noutra aba não substitui esta sessão.
    if (normalizedEmail === reservedOwnerEmail) {
      const { data: adminAuth, error: adminSignInError } = await superadminSupabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (adminSignInError || !adminAuth.user || !adminAuth.session) {
        setLoading(false);
        toast.error(adminSignInError?.message ?? "Não foi possível iniciar a sessão Super Admin.");
        return;
      }
      const { data: check, error: checkError } = await superadminSupabase.functions.invoke("superadmin-api", {
        body: { action: "dashboard" },
        headers: { Authorization: `Bearer ${adminAuth.session.access_token}` },
      });
      if (checkError || check?.ok !== true) {
        await superadminSupabase.auth.signOut();
        setLoading(false);
        toast.error(check?.error ?? "Este email não está autorizado no Super Admin.");
        return;
      }

      // Limpa apenas uma sessão antiga da mesma conta no armazenamento normal.
      const { data: regularSession } = await supabase.auth.getSession();
      if (regularSession.session?.user.email?.toLowerCase() === reservedOwnerEmail) {
        await supabase.auth.signOut();
      }
      setLoading(false);
      navigate({ to: "/superadmin" });
      return;
    }

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) {
      setLoading(false);
      if (error.message.toLowerCase().includes("email not confirmed")) {
        toast.error("O seu email ainda não foi confirmado. Abra o link enviado para a sua caixa de correio e depois volte aqui para entrar.");
      } else {
        toast.error(error.message);
      }
      return;
    }

    // Outros membros autorizados da equipa também recebem sessão isolada no painel.
    const { data: adminCheck, error: adminError } = await supabase.functions.invoke("superadmin-api", {
      body: { action: "dashboard" },
      headers: { Authorization: `Bearer ${authData.session?.access_token ?? ""}` },
    });
    if (authData.user && !adminError && adminCheck?.ok === true && authData.session) {
      const { data: isolatedAuth, error: isolatedError } = await superadminSupabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (!isolatedError && isolatedAuth.session) {
        const { data: isolatedCheck, error: isolatedCheckError } = await superadminSupabase.functions.invoke("superadmin-api", {
          body: { action: "dashboard" },
          headers: { Authorization: `Bearer ${isolatedAuth.session.access_token}` },
        });
        if (!isolatedCheckError && isolatedCheck?.ok === true) {
          await supabase.auth.signOut();
          setLoading(false);
          navigate({ to: "/superadmin" });
          return;
        }
        await superadminSupabase.auth.signOut();
      }
    }
    setLoading(false);
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
      {notice ? (
        <div role="status" aria-live="polite" className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          {notice}
        </div>
      ) : null}
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
