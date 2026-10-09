// Every table that points at a vehicle. Permanent deletion is refused while
// any of these has a row for the vehicle, so nothing is erased by a cascade
// or silently unlinked. Keep in sync with the foreign keys on public.vehicles.
export const VEHICLE_DEPENDENCIES: { table: string; column: string; label: string }[] = [
  { table: "rentals", column: "vehicle_id", label: "Rentals" },
  { table: "agreements", column: "vehicle_id", label: "Agreements" },
  { table: "payments", column: "vehicle_id", label: "Payments" },
  { table: "financial_transactions", column: "vehicle_hint_id", label: "Ledger Entries" },
  { table: "vehicle_expenses", column: "vehicle_id", label: "Expenses" },
  { table: "toll_charges", column: "vehicle_id", label: "Tolls" },
  { table: "vehicle_finance", column: "vehicle_id", label: "Finance Records" },
  { table: "vehicle_titles", column: "vehicle_id", label: "Title Records" },
  { table: "maintenance_records", column: "vehicle_id", label: "Service Records" },
  { table: "maintenance_schedules", column: "vehicle_id", label: "Service Schedules" },
  { table: "vehicle_downtime", column: "vehicle_id", label: "Downtime" },
  { table: "inspections", column: "vehicle_id", label: "Inspections" },
  { table: "condition_media", column: "vehicle_id", label: "Condition Photos" },
  { table: "incidents", column: "vehicle_id", label: "Incidents" },
  { table: "issues", column: "vehicle_id", label: "Issues" },
  { table: "odometer_readings", column: "vehicle_id", label: "Mileage Readings" },
  { table: "vehicle_media", column: "vehicle_id", label: "Photos" },
  { table: "documents", column: "vehicle_id", label: "Documents" },
  { table: "document_vehicle_links", column: "vehicle_id", label: "Document Links" },
  { table: "applications", column: "vehicle_id", label: "Applications" },
  { table: "outbound_messages", column: "vehicle_id", label: "Messages" },
  { table: "fleet_import_proposals", column: "applied_vehicle_id", label: "Fleet Inbox Proposals" },
  { table: "fleet_import_proposals", column: "match_vehicle_id", label: "Fleet Inbox Matches" },
  { table: "fleet_service_transactions", column: "applied_vehicle_id", label: "Service Imports" },
  { table: "fleet_service_transactions", column: "match_vehicle_id", label: "Service Import Matches" },
  { table: "vehicle_field_provenance", column: "vehicle_id", label: "Field History" },
  { table: "vehicle_autofill_events", column: "vehicle_id", label: "Auto-Fill History" },
];

export type DependencyCount = { label: string; count: number };

export function deleteBlockers(counts: DependencyCount[]): DependencyCount[] {
  return counts.filter((c) => c.count > 0);
}

/** Typed confirmation must match the unit number exactly (case-insensitive, trimmed). */
export function confirmMatches(unit: string | null | undefined, typed: string): boolean {
  return !!unit && unit.trim().toUpperCase() === typed.trim().toUpperCase();
}
