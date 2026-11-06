import { createFileRoute, redirect } from "@tanstack/react-router";
import { DriverRoadside } from "@/components/portal/DriverRoadside";
import { DRIVER_ROADSIDE_ENABLED } from "@/lib/driver-roadside";

export const Route = createFileRoute("/portal_/roadside")({
  head: () => ({
    meta: [{ title: "Roadside Help — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: () => {
    if (DRIVER_ROADSIDE_ENABLED !== true) {
      throw redirect({ to: "/portal" });
    }
  },
  component: DriverRoadside,
});
