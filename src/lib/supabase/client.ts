import { createClient } from "@supabase/supabase-js";

/**
 * Wappy Nus — cliente Supabase (projeto EXTERNO).
 * URL + anon key são públicas e podem viver no frontend.
 * A service_role key NUNCA deve aparecer aqui.
 */
const SUPABASE_URL: string = import.meta.env["VITE_SUPABASE_URL"] as string;

const SUPABASE_ANON_KEY: string = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Configuração Supabase ausente: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    detectSessionInUrl: typeof window !== "undefined",
  },
});
