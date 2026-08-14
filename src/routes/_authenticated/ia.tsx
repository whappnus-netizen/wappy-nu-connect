import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { AppShell, EmptyState } from "@/components/app/app-shell";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated/ia")({
  head: () => ({
    meta: [
      { title: "IA — Wappy Nus" },
      { name: "description", content: "Agentes de IA que respondem, resumem e qualificam conversas de WhatsApp." },
      { property: "og:title", content: "IA — Wappy Nus" },
      { property: "og:description", content: "Assistentes inteligentes de atendimento." },
    ],
  }),
  component: AiPage,
});

type Agent = {
  id: string;
  name: string;
  model: string | null;
  is_active: boolean;
  system_prompt: string | null;
};

function AiPage() {
  const { membership } = useAuth();
  const orgId = membership?.organization_id;

  const { data, isLoading } = useQuery({
    queryKey: ["ai-agents", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_agents")
        .select("id, name, model, is_active, system_prompt")
        .eq("organization_id", orgId!);
      return (data ?? []) as Agent[];
    },
  });

  const agents = data ?? [];

  return (
    <AppShell title="Inteligência Artificial" description="Agentes de apoio ao atendimento">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar…</p>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Sem agentes de IA"
          description="Aqui vai configurar o comportamento do assistente: tom de voz, base de conhecimento, quando responder sozinho e quando transferir para um humano."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-5">
              <p className="font-display font-semibold">{a.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{a.model ?? "modelo por definir"}</p>
              <p className="mt-3 line-clamp-4 text-sm text-muted-foreground">{a.system_prompt ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}