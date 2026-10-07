import { createClient } from "@supabase/supabase-js";

/**
 * WhappNus — cliente Supabase (projeto EXTERNO).
 * A URL e a anon/publishable key são públicas e entram no build
 * através das variáveis VITE_* do Netlify.
 * A service_role key NUNCA deve aparecer aqui.
 */
const FALLBACK_URL = "https://icqkoafhitudaqylnnfd.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljcWtvYWZoaXR1ZGFxeWxubmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3NDg4ODcsImV4cCI6MjEwMjMyNDg4N30.WJXVq331fm_aV222EJIWs3WXrYTMBxzoIgVsyA8rxao";

const SUPABASE_URL: string =
  (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) || FALLBACK_URL;
const SUPABASE_ANON_KEY: string =
  (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) || FALLBACK_ANON_KEY;

export { SUPABASE_URL, SUPABASE_ANON_KEY };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: typeof window !== "undefined",
    detectSessionInUrl: typeof window !== "undefined",
  },
});
