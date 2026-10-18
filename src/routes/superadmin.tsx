import { createFileRoute, redirect } from "@tanstack/react-router";

// Compatibility route: the former public path never renders the admin console.
export const Route = createFileRoute("/superadmin")({
  beforeLoad: () => { throw redirect({ to: "/auth/login" }); },
  component: () => null,
});
