import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getVehicleCompliance } from "@/lib/vehicle-compliance.functions";
import { VEHICLE_COMPLIANCE_ENABLED } from "@/lib/vehicle-compliance-flag";
import { COMPLIANCE_LABEL, type ComplianceStatus, type VehicleComplianceRow } from "@/lib/vehicle-compliance";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ComplianceFilter = "all" | ComplianceStatus;

const TONE: Record<ComplianceStatus, string> = {
  expired: "text-[#D03020]",
  due_30: "text-[#8A6410]",
  ok: "text-[#13613B]",
  unknown: "text-muted-foreground",
};

/**
 * The column and filter render only while VEHICLE_COMPLIANCE_ENABLED is true.
 * The read is disabled with the flag, so the Vehicles list does not call it.
 */
export function useVehicleCompliance() {
  const enabled = VEHICLE_COMPLIANCE_ENABLED;
  const [filter, setFilter] = useState<ComplianceFilter>("all");
  const read = useServerFn(getVehicleCompliance);
  const readRef = useRef(read);
  readRef.current = read;
  const query = useQuery({
    queryKey: ["vehicle-compliance"],
    queryFn: () => readRef.current({ data: {} }),
    enabled,
  });
  const report = query.data?.status === "ready" ? query.data : null;
  const byId = useMemo(() => new Map((report?.rows ?? []).map((row) => [row.vehicleId, row])), [report]);
  const listIds = useMemo(() => {
    if (!enabled || filter === "all") return undefined;
    if (!report) return [];
    return report.rows.filter((row) => row.status === filter).map((row) => row.vehicleId);
  }, [enabled, filter, report]);
  const notices: string[] = [];
  if (enabled && query.isLoading) notices.push("Loading Compliance");
  if (enabled && (query.isError || query.data?.status === "unavailable")) notices.push("Compliance Could Not Be Loaded");
  if (enabled && query.data?.status === "disabled") notices.push("Vehicle Compliance Is Off");
  if (report) notices.push(...report.notes);

  return { enabled, filter, setFilter, listIds, notices, byId, loading: enabled && query.isLoading };
}

export function ComplianceFilterSelect({
  filter,
  onChange,
}: {
  filter: ComplianceFilter;
  onChange: (filter: ComplianceFilter) => void;
}) {
  if (!VEHICLE_COMPLIANCE_ENABLED) return null;
  return (
    <Select value={filter} onValueChange={(value) => onChange(value as ComplianceFilter)}>
      <SelectTrigger className="h-9 w-[180px] bg-white text-foreground text-sm" aria-label="Compliance">
        <SelectValue placeholder="Compliance" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Compliance</SelectItem>
        <SelectItem value="expired">Expired</SelectItem>
        <SelectItem value="due_30">Due In 30 Days</SelectItem>
        <SelectItem value="ok">OK</SelectItem>
        <SelectItem value="unknown">Unknown</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ComplianceStatusText({
  row,
  loading,
}: {
  row: VehicleComplianceRow | undefined;
  loading: boolean;
}) {
  if (loading && !row) return <span className="text-muted-foreground">Loading</span>;
  const status = row?.status ?? "unknown";
  const title = row?.items.map((item) => `${item.label}: ${COMPLIANCE_LABEL[item.status]}`).join(" · ");
  return (
    <span className={TONE[status]} title={title || undefined} data-compliance={status}>
      {COMPLIANCE_LABEL[status]}
    </span>
  );
}
