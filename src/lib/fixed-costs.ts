// Fixed Costs: monthly insurance and GPS tracker tally. Pure, no I/O.
//
// Rows are computed live from vehicles, active rentals and the cost lines in
// fixed_cost_items, so a new car or renter appears at once. Anything that
// should cost money but has no line is a Missing Cost row, never a guessed $0.
//
// Insurance follows the renter: one row per active rental (the renter's
// policy). GPS follows the car: one row per car still in the fleet. A default
// line (per-car amount) fills every car or renter without its own line.
// Lines still marked active on an ended rental or an archived car keep
// counting, flagged, because the bill keeps coming until someone ends it.

export type FixedCostKind = "insurance" | "gps";
export type FixedCostScope = "vehicle" | "rental" | "fleet" | "default";
export type FixedCostFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const FIXED_COST_KINDS: readonly FixedCostKind[] = ["insurance", "gps"];
export const FIXED_COST_FREQUENCIES: readonly FixedCostFrequency[] = ["weekly", "monthly", "quarterly", "semiannual", "annual"];

export const FIXED_COSTS_COPY = {
  title: "Fixed Costs",
  insurance: "Insurance",
  gps: "GPS",
  grandTotal: "Monthly Total",
  insuranceTotal: "Insurance",
  gpsTotal: "GPS",
  next30: "Next 30 Days",
  missingCost: "Missing Cost",
  addCost: "Add Cost",
  editCost: "Edit Cost",
  endCost: "End Cost",
  save: "Save",
  cancel: "Cancel",
  defaults: "Defaults",
  defaultGps: "Default GPS",
  defaultInsurance: "Default Insurance",
  fleetLine: "Fleet Line",
  addFleetLine: "Add Line",
  notSet: "Not Set",
  rentalEnded: "Rental Ended",
  archived: "Archived",
  usesDefault: "Default",
  fleetPolicy: "Fleet Policy",
  setupNeeded: "Setup Needed",
  setupHint: "Fixed Costs needs a database update before costs can be saved.",
  unnamed: "Unnamed Renter",
  noVehicle: "No Vehicle",
  monthly: "Monthly",
  amount: "Amount",
  frequency: "Billed",
  dueDate: "Next Due",
  provider: "Provider",
  notes: "Notes",
  renter: "Renter",
  vehicle: "Vehicle",
  status: "Status",
  undatedNote: "lines with no due date are counted at their monthly amount",
} as const;

export const FREQUENCY_LABELS: Record<FixedCostFrequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "6 Months",
  annual: "Yearly",
};

export const KIND_LABELS: Record<FixedCostKind, string> = { insurance: "Insurance", gps: "GPS" };

/** Vehicle statuses that are out of the fleet: no GPS row unless a line still bills. */
export const OUT_OF_FLEET_STATUSES = ["sold", "retired", "totaled", "archived"] as const;
/** Rental statuses whose renter carries an insurance policy we pay for. */
export const INSURED_RENTAL_STATUSES = ["active"] as const;

export type FixedCostItem = {
  id: string;
  kind: FixedCostKind;
  scope: FixedCostScope;
  vehicle_id: string | null;
  rental_id: string | null;
  label: string | null;
  provider: string | null;
  amount: number;
  frequency: FixedCostFrequency;
  next_due_on: string | null;
  active: boolean;
  notes: string | null;
};

export type FixedCostVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  vin: string | null;
  status: string | null;
  archived_at: string | null;
};

export type FixedCostRental = {
  id: string;
  vehicle_id: string | null;
  status: string;
  renter: string | null;
};

export type FixedCostRowStatus = "set" | "default" | "missing" | "fleet" | "rental_ended" | "archived";

export type FixedCostRow = {
  key: string;
  kind: FixedCostKind;
  /** The line that prices this row (own line or the default). Null when Missing or Fleet Policy. */
  itemId: string | null;
  /** Where a new line for this row would be saved. */
  target: { scope: FixedCostScope; vehicleId: string | null; rentalId: string | null };
  vehicleId: string | null;
  vehicle: { year: number | null; make: string | null; model: string | null; plate: string | null; vin: string | null } | null;
  renter: string | null;
  label: string | null;
  provider: string | null;
  amount: number | null;
  frequency: FixedCostFrequency | null;
  nextDueOn: string | null;
  /** Normalized monthly cost; null when Missing or covered by a fleet line. */
  monthly: number | null;
  status: FixedCostRowStatus;
};

export type FixedCostTotals = {
  insuranceMonthly: number;
  gpsMonthly: number;
  grandMonthly: number;
  next30: number;
  undatedLines: number;
  missingInsurance: number;
  missingGps: number;
};

export type FixedCostsReport = {
  today: string;
  rows: FixedCostRow[];
  defaults: Record<FixedCostKind, FixedCostItem | null>;
  totals: FixedCostTotals;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly equivalent: weekly x 52 / 12, quarterly / 3, 6 months / 6, yearly / 12. */
export function monthlyAmount(amount: number, frequency: FixedCostFrequency): number {
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0) return 0;
  switch (frequency) {
    case "weekly": return round2((a * 52) / 12);
    case "monthly": return round2(a);
    case "quarterly": return round2(a / 3);
    case "semiannual": return round2(a / 6);
    case "annual": return round2(a / 12);
  }
}

function parseDay(d: string): Date {
  return new Date(`${d.slice(0, 10)}T12:00:00Z`);
}
function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addMonthsUtc(d: Date, months: number, anchorDay: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, last), 12));
}
function step(d: Date, frequency: FixedCostFrequency, anchorDay: number): Date {
  if (frequency === "weekly") return new Date(d.getTime() + 7 * 86400000);
  const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "semiannual" ? 6 : 12;
  return addMonthsUtc(d, months, anchorDay);
}

/**
 * Payment dates in [today, today + days). A due date in the past rolls
 * forward by the billing cycle (it was presumably paid), so a stale date
 * still predicts the next bill.
 */
export function dueDatesWithin(nextDueOn: string, frequency: FixedCostFrequency, today: string, days = 30): string[] {
  const start = parseDay(today);
  const end = new Date(start.getTime() + days * 86400000);
  const anchorDay = parseDay(nextDueOn).getUTCDate();
  let d = parseDay(nextDueOn);
  let guard = 0;
  while (d < start && guard++ < 2000) d = step(d, frequency, anchorDay);
  const out: string[] = [];
  while (d < end && guard++ < 2000) {
    out.push(fmtDay(d));
    d = step(d, frequency, anchorDay);
  }
  return out;
}

/** What this line costs in the next `days` days: dated lines by their schedule, undated at the monthly amount. */
export function amountDueWithin(row: Pick<FixedCostRow, "amount" | "frequency" | "nextDueOn" | "monthly">, today: string, days = 30): { amount: number; dated: boolean } {
  if (row.amount == null || row.frequency == null) return { amount: 0, dated: false };
  if (!row.nextDueOn) return { amount: row.monthly ?? 0, dated: false };
  return { amount: round2(dueDatesWithin(row.nextDueOn, row.frequency, today, days).length * row.amount), dated: true };
}

function vehicleOf(v: FixedCostVehicle | undefined): FixedCostRow["vehicle"] {
  if (!v) return null;
  return { year: v.year, make: v.make, model: v.model, plate: v.license_plate, vin: v.vin };
}

function priced(item: FixedCostItem, status: FixedCostRowStatus): Pick<FixedCostRow, "itemId" | "label" | "provider" | "amount" | "frequency" | "nextDueOn" | "monthly" | "status"> {
  return {
    itemId: item.id,
    label: item.label,
    provider: item.provider,
    amount: Number(item.amount),
    frequency: item.frequency,
    nextDueOn: item.next_due_on,
    monthly: monthlyAmount(Number(item.amount), item.frequency),
    status,
  };
}

const UNPRICED = { itemId: null, label: null, provider: null, amount: null, frequency: null, nextDueOn: null, monthly: null } as const;

export function isInFleet(v: FixedCostVehicle): boolean {
  if (v.archived_at) return false;
  return !(OUT_OF_FLEET_STATUSES as readonly string[]).includes(String(v.status ?? ""));
}

export function buildFixedCosts(input: {
  today: string;
  vehicles: FixedCostVehicle[];
  rentals: FixedCostRental[];
  items: FixedCostItem[];
}): FixedCostsReport {
  const items = input.items.filter((i) => i.active);
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));
  const defaults: Record<FixedCostKind, FixedCostItem | null> = {
    insurance: items.find((i) => i.kind === "insurance" && i.scope === "default") ?? null,
    gps: items.find((i) => i.kind === "gps" && i.scope === "default") ?? null,
  };
  const used = new Set<string>();
  const rows: FixedCostRow[] = [];
  const insured = input.rentals.filter((r) => (INSURED_RENTAL_STATUSES as readonly string[]).includes(r.status));
  const rentalsById = new Map(input.rentals.map((r) => [r.id, r]));
  const hasFleetInsurance = items.some((i) => i.kind === "insurance" && i.scope === "fleet");

  // ---- Insurance: one row per active renter.
  for (const r of insured) {
    const own = items.find((i) => i.kind === "insurance" && i.scope === "rental" && i.rental_id === r.id)
      ?? (r.vehicle_id ? items.find((i) => i.kind === "insurance" && i.scope === "vehicle" && i.vehicle_id === r.vehicle_id && !used.has(i.id)) : undefined);
    const base = {
      key: `insurance:rental:${r.id}`,
      kind: "insurance" as const,
      target: { scope: "rental" as const, vehicleId: r.vehicle_id, rentalId: r.id },
      vehicleId: r.vehicle_id,
      vehicle: vehicleOf(r.vehicle_id ? vehicles.get(r.vehicle_id) : undefined),
      renter: r.renter,
    };
    if (own) {
      used.add(own.id);
      rows.push({ ...base, ...priced(own, "set") });
    } else if (defaults.insurance) {
      rows.push({ ...base, ...priced(defaults.insurance, "default") });
    } else if (hasFleetInsurance) {
      rows.push({ ...base, ...UNPRICED, status: "fleet" });
    } else {
      rows.push({ ...base, ...UNPRICED, status: "missing" });
    }
  }
  // Insurance lines not matched to an active renter still bill: show them flagged.
  for (const i of items) {
    if (i.kind !== "insurance" || used.has(i.id) || i.scope === "default" || i.scope === "fleet") continue;
    const rental = i.rental_id ? rentalsById.get(i.rental_id) : undefined;
    const vid = i.vehicle_id ?? rental?.vehicle_id ?? null;
    const v = vid ? vehicles.get(vid) : undefined;
    used.add(i.id);
    rows.push({
      key: `insurance:item:${i.id}`,
      kind: "insurance",
      target: { scope: i.scope, vehicleId: i.vehicle_id, rentalId: i.rental_id },
      vehicleId: vid,
      vehicle: vehicleOf(v),
      renter: rental?.renter ?? null,
      ...priced(i, i.scope === "rental" ? "rental_ended" : v && !isInFleet(v) ? "archived" : "set"),
    });
  }

  // ---- GPS: one row per car in the fleet.
  for (const v of input.vehicles) {
    const own = items.find((i) => i.kind === "gps" && i.scope === "vehicle" && i.vehicle_id === v.id);
    const inFleet = isInFleet(v);
    if (!inFleet && !own) continue;
    const renter = insured.find((r) => r.vehicle_id === v.id)?.renter ?? null;
    const base = {
      key: `gps:vehicle:${v.id}`,
      kind: "gps" as const,
      target: { scope: "vehicle" as const, vehicleId: v.id, rentalId: null },
      vehicleId: v.id,
      vehicle: vehicleOf(v),
      renter,
    };
    if (own) {
      used.add(own.id);
      rows.push({ ...base, ...priced(own, inFleet ? "set" : "archived") });
    } else if (defaults.gps) {
      rows.push({ ...base, ...priced(defaults.gps, "default") });
    } else {
      rows.push({ ...base, ...UNPRICED, status: "missing" });
    }
  }

  // ---- Fleet-wide lines (a fleet policy, a tracker platform fee).
  for (const i of items) {
    if (i.scope !== "fleet") continue;
    rows.push({
      key: `${i.kind}:fleet:${i.id}`,
      kind: i.kind,
      target: { scope: "fleet", vehicleId: null, rentalId: null },
      vehicleId: null,
      vehicle: null,
      renter: null,
      ...priced(i, "set"),
    });
  }

  let insuranceMonthly = 0;
  let gpsMonthly = 0;
  let next30 = 0;
  let undatedLines = 0;
  for (const row of rows) {
    if (row.monthly == null) continue;
    if (row.kind === "insurance") insuranceMonthly += row.monthly;
    else gpsMonthly += row.monthly;
    const due = amountDueWithin(row, input.today);
    next30 += due.amount;
    if (!due.dated) undatedLines++;
  }
  return {
    today: input.today,
    rows,
    defaults,
    totals: {
      insuranceMonthly: round2(insuranceMonthly),
      gpsMonthly: round2(gpsMonthly),
      grandMonthly: round2(insuranceMonthly + gpsMonthly),
      next30: round2(next30),
      undatedLines,
      missingInsurance: rows.filter((r) => r.kind === "insurance" && r.status === "missing").length,
      missingGps: rows.filter((r) => r.kind === "gps" && r.status === "missing").length,
    },
  };
}

export const ROW_STATUS_LABELS: Record<FixedCostRowStatus, string> = {
  set: "Set",
  default: "Default",
  missing: "Missing Cost",
  fleet: "Fleet Policy",
  rental_ended: "Rental Ended",
  archived: "Archived",
};

/** Validate a save request before it reaches the database. Returns an error label or null. */
export function fixedCostInputError(input: {
  kind: string;
  scope: string;
  vehicleId?: string | null;
  rentalId?: string | null;
  amount: number;
  frequency: string;
}): string | null {
  if (!(FIXED_COST_KINDS as readonly string[]).includes(input.kind)) return "Pick A Type";
  if (!["vehicle", "rental", "fleet", "default"].includes(input.scope)) return "Pick A Scope";
  if (!(FIXED_COST_FREQUENCIES as readonly string[]).includes(input.frequency)) return "Pick How Often";
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 100000) return "Enter An Amount";
  if (input.scope === "vehicle" && !input.vehicleId) return "Pick A Vehicle";
  if (input.scope === "rental" && !input.rentalId) return "Pick A Renter";
  if ((input.scope === "fleet" || input.scope === "default") && (input.vehicleId || input.rentalId)) return "Fleet Lines Have No Vehicle";
  return null;
}
