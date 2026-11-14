export type ServiceSummaryRow = {
  vehicle: { id: string; unit_number?: string | null; status?: string | null; archived_at?: string | null };
  item: string;
  due: { state: string; reason?: string };
};

/** A small view of the already-authorized maintenance response, never a new service rule. */
export function serviceSummaryPreview(rows: readonly ServiceSummaryRow[]): ServiceSummaryRow[] {
  const seen = new Set<string>();
  return [...rows]
    .filter((row) => row.vehicle.id && !row.vehicle.archived_at)
    .sort((a, b) => Number(b.vehicle.status === "maintenance") - Number(a.vehicle.status === "maintenance"))
    .filter((row) => {
      if (seen.has(row.vehicle.id)) return false;
      seen.add(row.vehicle.id);
      return true;
    })
    .slice(0, 2);
}