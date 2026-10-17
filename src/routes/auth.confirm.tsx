import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (search: Record<string, unknown>) => ({
    token_hash: typeof search["token_hash"] === "string" ? (search["token_hash"] as string) : "",
    type: typeof search["type"] === "string" ? (search["type"] as string) : "",
  }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const { token_hash, type } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Estamos a confirmar o teu endereço de e-mail…");

  useEffect(() => {
    let cancelled = false;
    let redirectTimer: number | undefined;

    async function confirmEmail() {
      if (!token_hash || type !== "signup") {
        setStatus("error");
        setMessage("Este link de confirmação é inválido ou está incompleto. Solicita um novo e-mail de confirmação.");
        return;
      }

      const { data: verified, error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as EmailOtpType,
      });

      if (cancelled) return;

      if (error) {
        setStatus("error");
        setMessage("Não foi possível confirmar este e-mail. O link pode ter expirado ou já ter sido utilizado. Solicita um novo link e tenta novamente.");
        return;
      }

      // O e-mail de boas-vindas é enviado apenas após a confirmação real. Uma falha de envio não invalida a confirmação.
      if (verified.session?.access_token) {
        try {
          await fetch("/api/public/email/welcome", {
            method: "POST",
            headers: { Authorization: `Bearer ${verified.session.access_token}` },
          });
        } catch (welcomeError) {
          console.warn("[auth.confirm] welcome email dispatch failed", welcomeError);
        }
      }

      setStatus("success");
      setMessage("O teu endereço de e-mail foi confirmado. Vamos levar-te para a página de entrada…");
      redirectTimer = window.setTimeout(() => {
        if (!cancelled) window.location.assign("/auth/login?confirmed=1");
      }, 1800);
    }

    void confirmEmail();
    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  }, [token_hash, type]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f0f4f1] px-4 py-10">
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#e0e9e2] bg-white shadow-xl">
        <header className="border-b border-[#e3ebe5] px-8 py-6">
          <div className="text-2xl font-extrabold tracking-[0.12em] text-[#167a43]">WHAPPNUS</div>
          <p className="mt-2 text-xs text-[#68786d]">Inteligência que atende, organiza e vende.</p>
        </header>
        <div className="px-8 py-10 text-center">
          <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${status === "error" ? "bg-red-50 text-red-600" : "bg-green-50 text-[#167a43]"}`}>
            {status === "checking" ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : status === "error" ? (
              <span className="text-2xl">!</span>
            ) : (
              <span className="text-2xl">✓</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-[#173b28]">
            {status === "checking" ? "A confirmar o teu e-mail" : status === "success" ? "E-mail confirmado!" : "Não foi possível confirmar"}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#526357]">{message}</p>
          {status !== "checking" && (
            <div className="mt-7">
              <Link
                to="/auth/login"
                className="inline-flex items-center justify-center rounded-lg bg-[#167a43] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#126537]"
              >
                {status === "success" ? "Entrar na WhappNus" : "Ir para iniciar sessão"}
              </Link>
            </div>
          )}
        </div>
        <footer className="border-t border-[#e3ebe5] bg-[#f7faf8] px-8 py-5 text-center text-xs text-[#68786d]">
          WhappNus — A tua operação, mais inteligente.
        </footer>
      </section>
    </main>
  );
}
