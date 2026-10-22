import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Wrench } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { listMaintenanceLog } from "@/lib/maintenance-log.functions";
import { MAINTENANCE_LOG_ENABLED } from "@/lib/maintenance-log-flag";
import { reminderBadges, type LogAttention, type LogItem, type VehicleLog } from "@/lib/maintenance-log";
import { fmtDate } from "@/lib/date-format";
import { displayVehicleWord } from "@/lib/display-normalize";
import { SectionCard } from "./ui";

const BADGE_CLASS: Record<LogAttention, string> = {
  overdue: "bg-[rgba(208,48,32,0.08)] text-[#D03020]",
  due_soon: "bg-[rgba(240,192,64,0.16)] text-[#8A6410]",
};

const STATE_CLASS: Record<LogItem["state"], string> = {
  overdue: BADGE_CLASS.overdue,
  due_soon: BADGE_CLASS.due_soon,
  ok: "bg-[rgba(32,160,96,0.10)] text-[#13613B]",
  unknown: "bg-[#F1F1F4] text-[#55555E]",
};

const ATTENTION_LABEL: Record<LogAttention, string> = {
  overdue: "Overdue",
  due_soon: "Due Soon",
};

const STATE_LABEL: Record<LogItem["state"], string> = {
  overdue: "Overdue",
  due_soon: "Due Soon",
  ok: "All Clear",
  unknown: "Unknown",
};

function day(value: string | null): string {
  if (!value) return "Date Unknown";
  return fmtDate(value.length === 10 ? `${value}T12:00:00` : value);
}

function miles(value: number | null): string {
  if (value == null) return "";
  return `${value.toLocaleString("en-US")} mi`;
}

export function MaintenanceLogBadge({ state }: { state: LogAttention }) {
  if (!MAINTENANCE_LOG_ENABLED) return null;
  return (
    <span
      data-testid="maintenance-log-badge"
      data-state={state}
      className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_CLASS[state]}`}
    >
      {ATTENTION_LABEL[state]}
    </span>
  );
}

export function MaintenanceLogBadgeSource({
  children,
}: {
  children: (badges: Record<string, LogAttention>, failed: boolean) => ReactNode;
}) {
  if (!MAINTENANCE_LOG_ENABLED) return children({}, false);
  return <MaintenanceLogBadgeLive>{children}</MaintenanceLogBadgeLive>;
}

function MaintenanceLogBadgeLive({
  children,
}: {
  children: (badges: Record<string, LogAttention>, failed: boolean) => ReactNode;
}) {
  const load = useServerFn(listMaintenanceLog);
  const result = useQuery({
    queryKey: ["maintenance-log"],
    queryFn: () => load({ data: {} }),
  });
  return children(result.data ? reminderBadges(result.data.vehicles) : {}, result.isError);
}

export function MaintenanceDueTile() {
  if (!MAINTENANCE_LOG_ENABLED) return null;
  return <MaintenanceDueTileLive />;
}

function MaintenanceDueTileLive() {
  const load = useServerFn(listMaintenanceLog);
  const result = useQuery({
    queryKey: ["maintenance-log"],
    queryFn: () => load({ data: {} }),
  });
  const overdue = result.data?.counts.overdue ?? 0;
  const dueSoon = result.data?.counts.dueSoon ?? 0;
  const failed = result.isError;
  const title = failed
    ? "Could Not Load"
    : overdue > 0
      ? `${overdue} Overdue`
      : dueSoon > 0
        ? `${dueSoon} Due Soon`
        : "All Clear";
  const hint = failed
    ? "Maintenance reminders did not load"
    : overdue > 0 && dueSoon > 0
      ? `${dueSoon} due soon`
      : overdue + dueSoon === 0
        ? "0 due"
        : "View Vehicles";
  const tint = overdue > 0 ? "border-[#CC0000]/40 hover:border-[#CC0000]" : dueSoon > 0 ? "border-[#B77900]/40 hover:border-[#B77900]" : "border-[#EDEDF0] hover:border-[#D03020]";

  return (
    <Link
      to="/admin"
      search={{ tab: "vehicles" }}
      data-testid="maintenance-due-tile"
      className={`group relative rounded-2xl border bg-white text-[#111114] shadow-sm px-5 py-4 transition-colors ${tint}`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-[#55555E]">
        <Wrench className="h-4 w-4" strokeWidth={1.75} />
        Maintenance Due
      </div>
      <div className="mt-2 text-[22px] font-semibold tracking-tight">{title}</div>
      <div className="mt-1 text-[13px] text-[#55555E]">{hint}</div>
    </Link>
  );
}

export function MaintenanceLogHistory({ vehicleId }: { vehicleId: string }) {
  if (!MAINTENANCE_LOG_ENABLED) return null;
  return <MaintenanceLogHistoryLive vehicleId={vehicleId} />;
}

function MaintenanceLogHistoryLive({ vehicleId }: { vehicleId: string }) {
  const load = useServerFn(listMaintenanceLog);
  const result = useQuery({
    queryKey: ["maintenance-log", vehicleId],
    queryFn: () => load({ data: { vehicleId } }),
  });
  const vehicle = result.data?.vehicles[0] ?? null;

  if (result.isError) {
    return (
      <SectionCard title="Service History" icon={<Wrench className="h-4 w-4" />}>
        <p className="text-sm text-[#D03020]">Could not load service history.</p>
      </SectionCard>
    );
  }
  if (result.isLoading || !vehicle) {
    return (
      <SectionCard title="Service History" icon={<Wrench className="h-4 w-4" />}>
        <p className="text-sm text-[#55555E]">Loading service history.</p>
      </SectionCard>
    );
  }
  return <MaintenanceLogSections vehicle={vehicle} inspectionInstalled={result.data?.inspectionExpiryInstalled ?? false} />;
}

function MaintenanceLogSections({ vehicle, inspectionInstalled }: { vehicle: VehicleLog; inspectionInstalled: boolean }) {
  const name = [vehicle.year, displayVehicleWord(vehicle.make ?? ""), displayVehicleWord(vehicle.model ?? "")].filter(Boolean).join(" ");
  return (
    <SectionCard title="Service History" icon={<Wrench className="h-4 w-4" />}>
      <p className="mb-3 text-[13px] text-[#55555E]">{name || "Vehicle"}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {vehicle.items.map((item) => (
          <div key={item.kind} className="rounded-xl border border-[#EDEDF0] p-3" data-kind={item.kind}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{item.label}</div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_CLASS[item.state]}`}>{STATE_LABEL[item.state]}</span>
            </div>
            <p className="mt-1 text-[13px] text-[#55555E]">{item.reason}</p>
            {item.kind === "inspection" && !inspectionInstalled && (
              <p className="mt-1 text-[12px] text-[#9A9AA3]">Inspection expiry is not installed. Checklists below are history.</p>
            )}
            {item.history.length === 0 ? (
              <p className="mt-2 text-[12px] text-[#9A9AA3]">No history on record.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {item.history.map((line) => (
                  <li key={line.id} className="text-[12px] text-[#55555E]">
                    {line.label}
                    {line.on ? ` · ${day(line.on)}` : ""}
                    {line.miles != null ? ` · ${miles(line.miles)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
