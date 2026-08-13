import { supabase } from "./supabase/client";

/** Conta linhas de uma tabela filtrada pela organização. Devolve null se a tabela/RLS ainda não permitir. */
export async function countRows(
  table: string,
  organizationId: string,
  filters: Record<string, string> = {},
): Promise<number | null> {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
  const { count, error } = await query;
  if (error) return null;
  return count ?? 0;
}
