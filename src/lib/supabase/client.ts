import { createClient } from "@supabase/supabase-js";

/**
 * Wappy Nus — cliente Supabase (projeto EXTERNO).
 *
 * As credenciais públicas (URL + anon key) podem viver no frontend.
 * A service_role key NUNCA deve aparecer aqui: operações privilegiadas
 * pertencem a Edge Functions / ambiente server-side.
 *
 * Configuração: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
 */
const SUPABASE_URL =
  import.meta.env["VITE_SUPABASE_URL"] as string | undefined;

const SUPABASE_ANON_KEY =
  import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment.",
  );
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    detectSessionInUrl: typeof window !== "undefined",
  },
});
