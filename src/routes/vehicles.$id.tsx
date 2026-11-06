import { createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { VEHICLE_DETAIL_PAGE_ENABLED } from "@/lib/vehicle-detail";

const PAGE_DESCRIPTION = "Photos, weekly rate, rideshare eligibility, and rental requirements for this vehicle.";

export const Route = createFileRoute("/vehicles/$id")({
  beforeLoad: () => {
    if (VEHICLE_DETAIL_PAGE_ENABLED !== true) {
      throw redirect({ to: "/fleet" });
    }
  },
  head: () => ({
    meta: [
      { title: "Vehicle Details — REAL RENTALS" },
      { name: "description", content: PAGE_DESCRIPTION },
      { property: "og:title", content: "Vehicle Details — REAL RENTALS" },
      { property: "og:description", content: PAGE_DESCRIPTION },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VehicleDetailRoute,
});

function VehicleDetailRoute() {
  const { id } = useParams({ from: "/vehicles/$id" });
  const [View, setView] = useState<ComponentType<{ id: string }> | null>(null);

  useEffect(() => {
    if (VEHICLE_DETAIL_PAGE_ENABLED !== true) return;
    let cancelled = false;
    import("@/components/site/VehicleDetailView").then((mod) => {
      if (!cancelled) setView(() => mod.VehicleDetailView);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (VEHICLE_DETAIL_PAGE_ENABLED !== true || !View) return null;
  return <View id={id} />;
}
