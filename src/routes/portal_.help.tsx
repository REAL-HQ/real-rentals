import { createFileRoute, redirect } from "@tanstack/react-router";
import { DriverHelp } from "@/components/portal/DriverHelp";
import { DRIVER_HELP_ENABLED } from "@/lib/driver-help";

export const Route = createFileRoute("/portal_/help")({
  head: () => ({
    meta: [{ title: "Help — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: () => {
    if (DRIVER_HELP_ENABLED !== true) {
      throw redirect({ to: "/portal" });
    }
  },
  component: DriverHelp,
});
