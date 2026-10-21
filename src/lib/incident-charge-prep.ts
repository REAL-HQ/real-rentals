// Read-only proposal for an incident charge. No payment, invoice, or Stripe id.

const OPEN = new Set(["open", "in_claim", "repairing"]);

export type IncidentChargeInput = {
  id: string;
  status: string;
  incidentType: string;
  occurredAt: string;
  vehicleId: string;
  rentalId: string | null;
  driverResponsibleAmount: number | null;
  unitNumber: string | null;
  vehicle: string;
};

export type IncidentChargePrepRow = {
  incidentId: string;
  vehicleId: string;
  rentalId: string | null;
  vehicleLabel: string;
  incidentType: string;
  occurredAt: string;
  status: "open" | "in_claim" | "repairing";
  proposedAmount: number | null;
  basis: "driver_responsible_amount" | "no_driver_amount";
};

/** Open incidents only. A positive driver amount is the proposal. Anything else stays blank. */
export function buildIncidentChargePrep(rows: IncidentChargeInput[]): IncidentChargePrepRow[] {
  const out: IncidentChargePrepRow[] = [];
  for (const row of rows) {
    if (!OPEN.has(row.status)) continue;
    const amount = row.driverResponsibleAmount;
    const proposed = typeof amount === "number" && Number.isFinite(amount) && amount > 0
      ? Math.round(amount * 100) / 100
      : null;
    const unit = row.unitNumber?.trim() || "—";
    const name = row.vehicle.trim() || "Vehicle";
    out.push({
      incidentId: row.id,
      vehicleId: row.vehicleId,
      rentalId: row.rentalId,
      vehicleLabel: `${unit} ${name}`.trim(),
      incidentType: row.incidentType,
      occurredAt: row.occurredAt,
      status: row.status as IncidentChargePrepRow["status"],
      proposedAmount: proposed,
      basis: proposed == null ? "no_driver_amount" : "driver_responsible_amount",
    });
  }
  out.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.incidentId < b.incidentId ? -1 : 1));
  return out;
}
