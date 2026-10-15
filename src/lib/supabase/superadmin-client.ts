import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./client";

/**
 * Sessão separada para o painel Super Admin.
 * O Supabase partilha a sessão entre separadores que usam a mesma storage key;
 * este cliente evita que entrar numa conta de cliente substitua a sessão do owner.
 */
export const superadminSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: "whappnus-superadmin-auth-v1",
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    detectSessionInUrl: false,
  },
});
