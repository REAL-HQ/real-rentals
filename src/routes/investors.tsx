import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/investors")({
  beforeLoad: () => {
    throw redirect({ to: "/partners" });
  },
});
