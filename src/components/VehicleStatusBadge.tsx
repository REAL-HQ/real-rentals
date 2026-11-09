import { Badge } from "@/components/ui/badge";
import { displayTitleCase } from "@/lib/display-normalize";

/** Presentation only: the supplied status/label remains the authoritative value. */
export function VehicleStatusBadge({ status, label, className, ...props }: {
  status?: string | null;
  label?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const key = (status ?? "").trim().toLowerCase().replace(/ /g, "_");
  const variant = key === "available" ? "success"
    : ["maintenance", "reserved"].includes(key) ? "warning"
    : ["rented", "on_rent", "assigned"].includes(key) ? "occupied"
    : ["onboarding", "needs_setup", "out_of_service"].includes(key) ? "attention" : "neutral";
  return <Badge variant={variant} data-vehicle-status={key || "unknown"} className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className ?? ""}`} {...props}>
    {label ?? (key === "onboarding" ? "Needs Setup" : displayTitleCase(status?.replace(/_/g, " ") ?? "") || "Not Set")}
  </Badge>;
}