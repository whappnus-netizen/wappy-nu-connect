import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/equipa")({
  head: () => ({
    meta: [
      { title: "Equipa — Wappy Nus" },
      { name: "description", content: "Membros da organização, funções e permissões de atendimento." },
      { property: "og:title", content: "Equipa — Wappy Nus" },
      { property: "og:description", content: "Gestão de agentes e permissões." },
    ],
  }),
  component: TeamPage,
});

type Member = {
  user_id: string;
  role: string;
  created_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

function TeamPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["team", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data } = await supabase
        .from("memberships")
        .select("user_id, role, created_at, profiles(full_name, email)")
        .eq("organization_id", orgId!);
      return (data ?? []) as unknown as Member[];
    },
  });

  const members = data ?? [];

  return (
    <AppShell title="Equipa" description="Quem tem acesso a esta organização">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : members.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Sem membros listados"
          description="Ainda não é possível ler os membros desta organização. Depois de aplicar o SQL da base de dados, os utilizadores e funções aparecem aqui."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Função</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium">{m.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>{m.profiles?.email ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}