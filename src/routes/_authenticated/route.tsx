import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth/login" });
    // A conta principal do proprietário não deve entrar na área de cliente nem
    // criar uma organização sem necessidade; o painel usa armazenamento separado.
    if (data.user.email?.trim().toLowerCase() === "sthomasshelby51@gmail.com") {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth/login" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
