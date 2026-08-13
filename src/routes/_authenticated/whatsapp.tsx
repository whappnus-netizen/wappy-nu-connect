import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Smartphone, ShieldCheck } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Wappy Nus" },
      { name: "description", content: "Gestão dos números e contas WhatsApp Business da sua organização." },
      { property: "og:title", content: "WhatsApp — Wappy Nus" },
      { property: "og:description", content: "Configuração de números via WhatsApp Cloud API oficial." },
    ],
  }),
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data: numbers } = useQuery({
    queryKey: ["whatsapp_numbers", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .select("id, display_name, phone_e164, connection_status")
        .eq("organization_id", orgId!);
      if (error) return [];
      return data ?? [];
    },
  });

  return (
    <AppShell
      title="WhatsApp"
      description="Números e contas WhatsApp Business"
      actions={<Button size="sm" disabled>Adicionar número</Button>}
    >
      <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="font-display text-sm font-semibold">Apenas infraestrutura oficial</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O Wappy Nus liga-se exclusivamente à WhatsApp Cloud API da Meta. Não utilizamos WhatsApp Web
              automatizado, QR-code bots nem bibliotecas não oficiais. Para activar precisa de: WhatsApp Business
              Account ID, Phone Number ID, token de sistema e verify token do webhook — credenciais que serão
              guardadas apenas no servidor (Edge Functions / secrets).
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {(numbers?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum número registado"
            description="Ainda não existe nenhuma ligação WhatsApp. O registo de números fica disponível quando as credenciais da Meta forem configuradas no servidor."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {numbers!.map((n: { id: string; display_name: string | null; phone_e164: string; connection_status: string }) => (
              <div key={n.id} className="rounded-xl border border-border bg-card p-5 shadow-soft">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{n.display_name ?? n.phone_e164}</p>
                  <Badge variant="secondary">{n.connection_status}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{n.phone_e164}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
