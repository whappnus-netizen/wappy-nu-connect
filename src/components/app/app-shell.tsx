import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  MessagesSquare,
  Smartphone,
  Users,
  KanbanSquare,\n  CalendarDays,
  Workflow,
  Sparkles,
  ReceiptText,
  UsersRound,
  Settings,
  LogOut,
  Menu,
  Bell,
  Check,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useSubscriptionAccess } from "@/lib/subscription";
import { supabase } from "@/lib/supabase/client";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: MessagesSquare },
  { to: "/whatsapp", label: "WhatsApp", icon: Smartphone },
  { to: "/contactos", label: "Contactos", icon: Users },
  { to: "/crm", label: "CRM", icon: KanbanSquare },\n  { to: "/agendamentos", label: "Agendamentos", icon: CalendarDays },
  { to: "/automacoes", label: "Automações", icon: Workflow },
  { to: "/ia", label: "IA", icon: Sparkles },
  { to: "/pagamentos", label: "Pagamentos", icon: ReceiptText },
  { to: "/equipa", label: "Equipa", icon: UsersRound },
  { to: "/definicoes", label: "Definições", icon: Settings },
  { to: "/notificacoes", label: "Notificações", icon: Bell },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-lg font-bold tracking-tight", className)}>
      Whapp<span className="text-primary">Nus</span>
    </span>
  );
}

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, membership, signOut } = useAuth();
  const subscription = useSubscriptionAccess(membership?.organization_id);
  const queryClient = useQueryClient();
  const organizationId = membership?.organization_id;
  const { data: notifications } = useQuery({
    queryKey: ["organization-notifications", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("organization_notifications")
        .select("id,title,body,created_at")
        .eq("organization_id", organizationId!)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const markNotificationRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_notifications")
        .update({ read_at: new Date().toISOString() }).eq("id", id).eq("organization_id", organizationId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["organization-notifications", organizationId] }),
  });

  return (
    <div className="flex min-h-screen bg-surface">
      {open && <button type="button" aria-label="Fechar menu de navegação" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px] lg:hidden" />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center border-b border-border px-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <div className="rounded-lg bg-secondary px-3 py-2">
            <p className="truncate text-xs font-medium">{membership?.organizations?.name ?? "Sem organização"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {membership?.role === "OWNER" ? "Proprietário" : membership?.role === "ADMIN" ? "Administrador" : membership?.role === "SUPERVISOR" ? "Supervisor" : membership?.role === "AGENT" ? "Agente" : "—"}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={() => signOut()}>
            <LogOut className="size-4" /> Terminar sessão
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-semibold">{title}</h1>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
        {subscription.data && !subscription.active && (
          <div role="alert" className="flex flex-col gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div>
              <p className="text-sm font-semibold">Acesso limitado — assinatura suspensa</p>
              <p className="text-xs text-muted-foreground">Os dados e o histórico continuam disponíveis. A IA e as automações ficam pausadas até o administrador reactivar o plano.</p>
            </div>
            <Button asChild size="sm"><a href="/#planos">Ver planos</a></Button>
          </div>
        )}
        {notifications && notifications.length > 0 && (
          <section aria-label="Notificações recentes" className="space-y-2 border-b border-primary/20 bg-primary/5 px-4 py-3 lg:px-8">
            {notifications.map((notification) => (
              <div key={notification.id} className="flex items-start gap-3 rounded-lg border border-primary/15 bg-card p-3">
                <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{notification.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{new Date(notification.created_at).toLocaleString("pt-AO")}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Marcar notificação como lida" disabled={markNotificationRead.isPending} onClick={() => markNotificationRead.mutate(notification.id)}><Check className="size-4" /></Button>
              </div>
            ))}
          </section>
        )}
        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" />
      </div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
