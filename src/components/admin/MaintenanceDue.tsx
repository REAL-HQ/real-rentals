import { LinkedVehicleCell } from "./VehicleCell";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { rowNav } from "@/lib/row-click";
import { useServerFn } from "@tanstack/react-start";
import { Wrench } from "lucide-react";
import { listMaintenanceDue } from "@/lib/maintenance-due.functions";
import { vehicleUrgency, type DueBadge, type VehicleDueRow } from "@/lib/maintenance-due";
import { displayVehicleWord } from "@/lib/display-normalize";
import { EmptyState } from "./ui";
import { DANGER_BADGE } from "@/lib/badge-tone";

const BADGE_CLASS: Record<DueBadge, string> = {
  overdue: DANGER_BADGE,
  due_14: "bg-[rgba(240,192,64,0.16)] text-[#8A6410]",
  ok: "bg-[rgba(32,160,96,0.10)] text-[#13613B]",
  unknown: "bg-[#F1F1F4] text-[#55555E]",
};

function vehicleName(row: VehicleDueRow) {
  return [row.year, displayVehicleWord(row.make ?? ""), displayVehicleWord(row.model ?? "")].filter(Boolean).join(" ");
}

function matches(row: VehicleDueRow, query: string, status: string, body: string, partner: string) {
  if (status !== "all" && row.status !== status) return false;
  if (body !== "all" && row.bodyType !== body) return false;
  if (partner === "__none__" && row.partnerId) return false;
  if (partner !== "all" && partner !== "__none__" && row.partnerId !== partner) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [row.unitNumber, row.year, row.make, row.model, row.plate, vehicleName(row)].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(needle);
}

export function MaintenanceDue({
  query,
  status,
  body,
  partner,
}: {
  query: string;
  status: string;
  body: string;
  partner: string;
}) {
  const navigate = useNavigate();
  const fetchDue = useServerFn(listMaintenanceDue);
  const result = useQuery({
    queryKey: ["maintenance-due"],
    queryFn: () => fetchDue(),
  });
  const all = result.data?.rows ?? [];
  const rows = all
    .filter((row) => matches(row, query, status, body, partner))
    .sort((a, b) => vehicleUrgency(a.items) - vehicleUrgency(b.items) || (a.unitNumber ?? "").localeCompare(b.unitNumber ?? "") || vehicleName(a).localeCompare(vehicleName(b)));

  if (result.isError) return <div className="mt-6 text-sm text-real-red">Could not load Maintenance Due.</div>;
  if (result.isLoading) return <div className="mt-6 text-sm text-muted-foreground">Loading Maintenance Due…</div>;
  if (rows.length === 0) {
    const fleetEmpty = all.length === 0;
    return (
      <EmptyState
        className="mt-6"
        icon={<Wrench className="w-6 h-6" strokeWidth={1.75} />}
        title={fleetEmpty ? "No Vehicles Yet" : "No Matching Vehicles"}
        hint={fleetEmpty ? "Cars appear here once they are in the fleet. Missing service dates show as Unknown." : "Try clearing a filter."}
      />
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-white max-lg:min-w-0">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Vehicle</th>
            <th className="px-3 py-2 font-medium">Current Mileage</th>
            {rows[0].items.map((item) => (
              <th key={item.kind} className="px-3 py-2 font-medium">{item.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vehicleId} {...rowNav(navigate, { tab: "vehicles", id: row.vehicleId }, "border-t border-border align-top")}>
              <td className="px-3 py-3">
                <LinkedVehicleCell vehicleId={row.vehicleId} fallback={{ year: row.year, make: row.make, model: row.model, plate: row.plate, unitNumber: row.unitNumber }} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap">{row.currentMiles}</td>
              {row.items.map((item) => (
                <td key={item.kind} className="px-3 py-3 min-w-[180px]">
                  <div className="text-[11px] text-muted-foreground">Last Service</div>
                  <div>{item.lastService}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Due By</div>
                  <div>{item.dueBy}</div>
                  <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[item.badge]}`}>{item.badgeLabel}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
