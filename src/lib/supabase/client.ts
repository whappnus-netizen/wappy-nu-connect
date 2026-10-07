import { createClient } from "@supabase/supabase-js";

/**
 * WhappNus — cliente Supabase (projeto EXTERNO).
 * A URL e a anon/publishable key são públicas e entram no build
 * através das variáveis VITE_* do Netlify.
 * A service_role key NUNCA deve aparecer aqui.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Configuração Supabase ausente: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY",
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
