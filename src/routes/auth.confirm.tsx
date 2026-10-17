import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (search: Record<string, unknown>) => ({
    token_hash: typeof search["token_hash"] === "string" ? (search["token_hash"] as string) : "",
    type: typeof search["type"] === "string" ? (search["type"] as string) : "",
    code: typeof search["code"] === "string" ? (search["code"] as string) : "",
    error_description: typeof search["error_description"] === "string" ? (search["error_description"] as string) : "",
  }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const { token_hash, type, code, error_description } = Route.useSearch();
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Estamos a confirmar o teu endereço de e-mail…");

  useEffect(() => {
    let cancelled = false;

    async function confirmEmail() {
      if (error_description) {
        setStatus("error");
        setMessage("O link de confirmação não foi aceite ou expirou. Solicita um novo e-mail de confirmação e tenta novamente.");
        return;
      }

      // Supabase pode redirecionar com um PKCE code, um token_hash ou já ter
      // processado o code automaticamente durante a inicialização do cliente.
      let confirmationError: string | null = null;
      if (token_hash && (type === "signup" || type === "email")) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as EmailOtpType,
        });
        confirmationError = error?.message ?? null;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        confirmationError = error?.message ?? null;
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user?.email_confirmed_at) {
          // A biblioteca pode ter trocado o code por uma sessão ao carregar a URL.
          // Abaixo terminamos essa sessão para exigir a palavra-passe como pedido.
        } else {
          setStatus("error");
          setMessage("Este link de confirmação é inválido ou está incompleto. Solicita um novo e-mail de confirmação.");
          return;
        }
      }

      if (cancelled) return;
      if (confirmationError) {
        // Se detectSessionInUrl já trocou o PKCE code durante a inicialização,
        // a segunda troca pode falhar apesar de a confirmação estar concluída.
        const { data: fallbackSession } = await supabase.auth.getSession();
        if (!fallbackSession.session?.user?.email_confirmed_at) {
          setStatus("error");
          setMessage("Não foi possível confirmar este e-mail. O link pode ter expirado ou já ter sido utilizado. Solicita um novo link e tenta novamente.");
          return;
        }
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.email_confirmed_at) {
        if (!cancelled) {
          setStatus("error");
          setMessage("Não conseguimos validar a confirmação desta conta. Solicita um novo link e tenta novamente.");
        }
        return;
      }

      // Não manter uma sessão iniciada pelo link: a pessoa deve entrar com a sua palavra-passe.
      await supabase.auth.signOut();
      if (cancelled) return;
      setStatus("success");
      setMessage("O teu endereço de e-mail foi confirmado com sucesso. Agora podes entrar com a tua palavra-passe.");
    }

    void confirmEmail().catch((error) => {
      console.error("[auth.confirm] confirmation failed", error);
      if (!cancelled) {
        setStatus("error");
        setMessage("Ocorreu um erro ao confirmar o e-mail. Solicita um novo link e tenta novamente.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token_hash, type, code, error_description]);

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
              {status === "success" ? (
                <Link
                  to="/auth/login"
                  search={{ confirmed: "1" } as never}
                  className="inline-flex items-center justify-center rounded-lg bg-[#167a43] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#126537]"
                >
                  Entrar na WhappNus
                </Link>
              ) : (
                <Link
                  to="/auth/login"
                  className="inline-flex items-center justify-center rounded-lg bg-[#167a43] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#126537]"
                >
                  Ir para iniciar sessão
                </Link>
              )}
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
