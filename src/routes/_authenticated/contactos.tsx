import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Users, Search } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/contactos")({
  head: () => ({
    meta: [
      { title: "Contactos — Wappy Nus" },
      { name: "description", content: "Base de contactos da organização com etiquetas, origem e última interacção." },
      { property: "og:title", content: "Contactos — Wappy Nus" },
      { property: "og:description", content: "Gestão centralizada de contactos WhatsApp." },
    ],
  }),
  component: ContactsPage,
});

type Contact = {
  id: string;
  full_name: string | null;
  phone_e164: string;
  email: string | null;
  company_name: string | null;
  source: string | null;
  status: string;
  last_interaction_at: string | null;
};

function ContactsPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, full_name, phone_e164, email, company_name, source, status, last_interaction_at")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [] as Contact[];
      return (data ?? []) as Contact[];
    },
  });

  const rows = (data ?? []).filter((c) =>
    `${c.full_name ?? ""} ${c.phone_e164} ${c.email ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell title="Contactos" description="Pessoas e empresas que falam com a sua marca">
      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Pesquisar por nome, telefone ou email" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sem contactos"
          description="Os contactos são criados automaticamente a partir das conversas WhatsApp, ou podem ser importados quando o módulo de importação for activado."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.full_name ?? "—"}</TableCell>
                  <TableCell>{c.phone_e164}</TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell>{c.company_name ?? "—"}</TableCell>
                  <TableCell>{c.source ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
