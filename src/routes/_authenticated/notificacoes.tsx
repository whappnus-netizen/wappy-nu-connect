import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Circle, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/notificacoes")({
  head: () => ({ meta: [{ title: "Notificações — WhappNus" }] }),
  component: NotificationsPage,
});

type OrganizationNotification = {
  id: string;
  title: string;
  body: string;
  notification_type: string;
  created_at: string;
  read_at: string | null;
};

function NotificationsPage() {
  const { membership } = useAuth();
  const organizationId = membership?.organization_id;
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["organization-notifications-all", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_notifications")
        .select("id,title,body,notification_type,created_at,read_at")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as OrganizationNotification[];
    },
  });
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id).eq("organization_id", organizationId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organization-notifications-all", organizationId] });
      void queryClient.invalidateQueries({ queryKey: ["organization-notifications", organizationId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("organization_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("organization_id", organizationId!).is("read_at", null);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Todas as notificações foram marcadas como lidas.");
      void queryClient.invalidateQueries({ queryKey: ["organization-notifications-all", organizationId] });
      void queryClient.invalidateQueries({ queryKey: ["organization-notifications", organizationId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const unread = (notifications.data ?? []).filter((item) => !item.read_at).length;

  return (
    <AppShell title="Notificações" description="Avisos oficiais, novidades e informação importante da sua conta.">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm text-muted-foreground">{unread} por ler · {(notifications.data ?? []).length} no histórico</p></div>
          <Button variant="outline" size="sm" disabled={!unread || markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            {markAllRead.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
            Marcar todas como lidas
          </Button>
        </div>
        {notifications.isLoading ? (
          <Card><CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />A carregar notificações…</CardContent></Card>
        ) : notifications.error ? (
          <Card><CardContent className="p-5 text-sm text-destructive">{(notifications.error as Error).message}</CardContent></Card>
        ) : !(notifications.data ?? []).length ? (
          <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center"><Bell className="size-8 text-muted-foreground" /><p className="font-medium">Ainda não há notificações</p><p className="text-sm text-muted-foreground">Os avisos importantes da equipa WhappNus aparecerão aqui.</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {(notifications.data ?? []).map((item) => (
              <Card key={item.id} className={item.read_at ? "" : "border-primary/40 bg-primary/[0.025]"}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    {item.read_at ? <Bell className="mt-1 size-4 shrink-0 text-muted-foreground" /> : <Circle className="mt-1 size-3 shrink-0 fill-primary text-primary" />}
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("pt-AO")} · {item.notification_type === "subscription" ? "Assinatura" : "Comunicado WhappNus"}</p>
                    </div>
                    {!item.read_at && <Button variant="ghost" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(item.id)}>Marcar como lida</Button>}
                  </div>
                </CardHeader>
                <CardContent className="pl-10"><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.body}</p></CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
