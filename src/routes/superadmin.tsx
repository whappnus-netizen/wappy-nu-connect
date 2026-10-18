import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/superadmin")({
  beforeLoad: () => {
    // Legacy URL intentionally exposes no administrative UI.
    throw redirect({ to: "/auth/login" });
  },
  component: () => null,
});
