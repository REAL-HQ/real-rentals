// Read-only proposal for an incident charge. No payment, invoice, or Stripe id.
// #180's cents helpers are private to closeout-preview and are not on this branch.
// The subtraction here is the same max(0, amount - sum) idea, in cents, and blank at 0.

const OPEN = new Set(["open", "in_claim", "repairing"]);

export type Money = number | string | null;

export type IncidentChargeInput = {
  id: string;
  status: string;
  incidentType: string;
  occurredAt: string;
  vehicleId: string;
  rentalId: string | null;
  driverResponsibleAmount: Money;
  unitNumber: string | null;
  vehicle: string;
};

export type IncidentDeductionInput = {
  incidentId: string | null;
  amount: Money;
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
  basis: "driver_responsible_amount" | "no_driver_amount" | "no_rental" | "already_deducted";
};

/**
 * Integer cents from a numeric string or a finite number.
 * Decimal text is parsed directly so "1.005" is 101 cents.
 * Multiplying a float by 100 and rounding is not used.
 */
export function moneyToCents(value: Money | undefined): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
  } else if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const frac = match[3] ?? "";
  let cents = Number(match[2]) * 100 + Number((frac + "00").slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1;
  return sign * cents;
}

/** Sum of deposit_deductions.amount for one incident, in cents. */
export function deductedCents(rows: IncidentDeductionInput[], incidentId: string): number {
  let total = 0;
  for (const row of rows) {
    if (row.incidentId !== incidentId) continue;
    const cents = moneyToCents(row.amount);
    if (cents == null) continue;
    total += cents;
  }
  return total;
}

/**
 * max(0, driver_responsible_amount - sum(deposit_deductions for this incident)).
 * Blank (null) at 0. A null rental is not a proposal.
 */
export function proposeRemainingCharge(
  rentalId: string | null,
  driverResponsibleAmount: Money,
  deducted: number,
): { proposedAmount: number | null; basis: IncidentChargePrepRow["basis"] } {
  if (rentalId == null) return { proposedAmount: null, basis: "no_rental" };
  const amountCents = moneyToCents(driverResponsibleAmount);
  if (amountCents == null || amountCents <= 0) return { proposedAmount: null, basis: "no_driver_amount" };
  const remaining = amountCents - deducted;
  if (remaining <= 0) return { proposedAmount: null, basis: "already_deducted" };
  return { proposedAmount: remaining / 100, basis: "driver_responsible_amount" };
}

/** Open incidents only. Closed and written off are left off the proposal. */
export function buildIncidentChargePrep(
  rows: IncidentChargeInput[],
  deductions: IncidentDeductionInput[] = [],
): IncidentChargePrepRow[] {
  const out: IncidentChargePrepRow[] = [];
  for (const row of rows) {
    if (!OPEN.has(row.status)) continue;
    const proposal = proposeRemainingCharge(row.rentalId, row.driverResponsibleAmount, deductedCents(deductions, row.id));
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
      proposedAmount: proposal.proposedAmount,
      basis: proposal.basis,
    });
  }
  out.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.incidentId < b.incidentId ? -1 : 1));
  return out;
}
