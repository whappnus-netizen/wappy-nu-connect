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
export const SUPABASE_URL =
  (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ??
  "https://nhpjqndkwynupwdjjryw.supabase.co";

export const SUPABASE_ANON_KEY =
  (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocGpxbmRrd3ludXB3ZGpqcnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1Njk4OTIsImV4cCI6MjEwMjE0NTg5Mn0.H7AYZhTke0lPZYX0Igw6UEN7-_0k9RLdYg3JbEVJqxk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    detectSessionInUrl: typeof window !== "undefined",
  },
});
