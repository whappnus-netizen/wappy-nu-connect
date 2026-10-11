import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UsersRound, Trash2, ShieldCheck } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/equipa")({
  head: () => ({
    meta: [
      { title: "Equipa — Wapnus" },
      { name: "description", content: "Membros da organização, funções e permissões de atendimento." },
      { property: "og:title", content: "Equipa — Wapnus" },
      { property: "og:description", content: "Gestão de agentes e permissões." },
    ],
  }),
  component: TeamPage,
});

type Role = "OWNER" | "ADMIN" | "SUPERVISOR" | "AGENT";
type Member = {
  user_id: string;
  role: Role;
  created_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};
const roleLabels: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  AGENT: "Agente",
};

function TeamPage() {
  const { user, membership } = useAuth();
  const orgId = membership?.organization_id;
  const currentRole = membership?.role;
  const canManage = currentRole === "OWNER" || currentRole === "ADMIN";
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const teamQuery = useQuery({
    queryKey: ["team", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("memberships")
        .select("user_id, role, created_at, profiles(full_name, email)")
        .eq("organization_id", orgId!);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as unknown as Member[];
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ member, role }: { member: Member; role: Role }) => {
      if (!orgId || !canManage) throw new Error("Apenas OWNER ou ADMIN pode gerir funções.");
      if (member.user_id === user?.id && role !== member.role) throw new Error("Não podes alterar a tua própria função nesta sessão.");
      if (member.role === "OWNER" && currentRole !== "OWNER") throw new Error("Só o proprietário pode gerir outra conta OWNER.");
      if (role === "OWNER" && currentRole !== "OWNER") throw new Error("Só um OWNER pode atribuir a função de proprietário.");
      const { error: updateError } = await supabase.from("memberships")
        .update({ role }).eq("organization_id", orgId).eq("user_id", member.user_id);
      if (updateError) throw new Error(updateError.message);
    },
    onSuccess: () => {
      setErrorMessage(null);
      setNotice("Função actualizada.");
      void queryClient.invalidateQueries({ queryKey: ["team", orgId] });
    },
    onError: (e: Error) => { setErrorMessage(e.message); setNotice(null); },
  });

  const removeMember = useMutation({
    mutationFn: async (member: Member) => {
      if (!orgId || !canManage) throw new Error("Apenas OWNER ou ADMIN pode remover membros.");
      if (member.user_id === user?.id) throw new Error("Não podes remover a tua própria conta da organização.");
      if (member.role === "OWNER") throw new Error("A conta OWNER não pode ser removida por esta área.");
      const { error: deleteError } = await supabase.from("memberships")
        .delete().eq("organization_id", orgId).eq("user_id", member.user_id);
      if (deleteError) throw new Error(deleteError.message);
    },
    onSuccess: () => {
      setErrorMessage(null);
      setNotice("Membro removido da organização. A conta Supabase não foi eliminada.");
      void queryClient.invalidateQueries({ queryKey: ["team", orgId] });
    },
    onError: (e: Error) => { setErrorMessage(e.message); setNotice(null); },
  });

  const members = teamQuery.data ?? [];

  return (
    <AppShell title="Equipa" description="Membros com acesso a esta organização e respetivas funções">
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0"><p className="text-sm font-medium">Permissões da organização</p><p className="mt-1 text-xs leading-5 text-muted-foreground">OWNER e ADMIN podem alterar funções. A conta OWNER e a tua própria conta ficam protegidas contra remoção acidental. Remover um membro retira apenas o acesso à organização; não apaga a conta nem o histórico.</p></div>
      </div>

      {notice && <p role="status" className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}
      {errorMessage && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</p>}

      {teamQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : teamQuery.error ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Não foi possível carregar a equipa.</p>
          <p className="mt-1 break-words">{teamQuery.error.message}</p>
          <p className="mt-2 text-xs">Esta mensagem apresenta o erro real da consulta; não significa automaticamente que falta SQL.</p>
        </div>
      ) : members.length === 0 ? (
        <EmptyState icon={UsersRound} title="Sem membros listados" description="Ainda não há membros para apresentar nesta organização. Confirme que os utilizadores foram adicionados à equipa." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table className="min-w-[760px]">
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Email</TableHead><TableHead>Função</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.user_id === user?.id;
                const protectedOwner = member.role === "OWNER";
                const disabled = !canManage || updateRole.isPending || removeMember.isPending || isSelf || protectedOwner;
                return (
                  <TableRow key={member.user_id}>
                    <TableCell className="font-medium">{member.profiles?.full_name ?? "—"}{isSelf && <span className="ml-2 text-xs text-muted-foreground">(tu)</span>}</TableCell>
                    <TableCell>{member.profiles?.email ?? "—"}</TableCell>
                    <TableCell><Badge variant={member.role === "OWNER" ? "default" : "secondary"}>{roleLabels[member.role] ?? member.role}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{isSelf ? "Sessão actual" : "Membro"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <select aria-label={`Função de ${member.profiles?.email ?? member.user_id}`} value={member.role} disabled={disabled} onChange={(e) => updateRole.mutate({ member, role: e.target.value as Role })} className="h-9 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60">
                          <option value="OWNER" disabled={currentRole !== "OWNER"}>Proprietário</option>
                          <option value="ADMIN">Administrador</option>
                          <option value="SUPERVISOR">Supervisor</option>
                          <option value="AGENT">Agente</option>
                        </select>
                        <Button size="icon" variant="ghost" aria-label={`Remover ${member.profiles?.email ?? "membro"}`} disabled={disabled} onClick={() => { if (window.confirm("Remover este membro da organização? O histórico será preservado.")) removeMember.mutate(member); }}><Trash2 className="size-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {!canManage && <p className="mt-3 text-xs text-muted-foreground">Podes consultar a equipa, mas apenas OWNER ou ADMIN pode alterar funções ou remover membros.</p>}
      <p className="mt-4 text-xs text-muted-foreground">Convites por email para pessoas que ainda não têm conta Wapnus ainda não estão ligados. Esta entrega gere os membros que já pertencem à organização.</p>
    </AppShell>
  );
}
