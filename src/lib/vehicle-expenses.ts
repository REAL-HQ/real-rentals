/**
 * Owner P&L expense line, per vehicle.
 * A vehicle_expenses row is counted once. A service event that already has
 * that row is not counted again from company_share or total_cost.
 * When the share is blank and there is no linked expense, total_cost is the cost.
 * A present share of 0 is a real zero. This module does not write.
 */

export const VEHICLE_EXPENSE_BUCKETS = ["maintenance", "insurance", "registration", "tolls", "cleaning", "other"] as const;
export type VehicleExpenseBucket = (typeof VEHICLE_EXPENSE_BUCKETS)[number];

const BUCKET_OF: Record<string, VehicleExpenseBucket> = {
  maintenance: "maintenance",
  insurance: "insurance",
  registration: "registration",
  tolls: "tolls",
  cleaning: "cleaning",
};

export const BUCKET_LABELS: Record<VehicleExpenseBucket, string> = {
  maintenance: "Maintenance",
  insurance: "Insurance",
  registration: "Registration",
  tolls: "Tolls",
  cleaning: "Cleaning",
  other: "Other",
};

export type ExpenseMovement = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  amount: string | number | null;
  incurredOn: string | null;
  maintenanceRecordId: string | null;
  vendorName: string | null;
  receiptPath: string | null;
};

export type ServiceMovement = {
  id: string;
  vehicleId: string | null;
  category: string | null;
  companyShare: string | number | null;
  totalCost: string | number | null;
  performedOn: string | null;
  completedAt: string | null;
  createdAt: string | null;
  vendorName: string | null;
};

export type ExpenseVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
  unitNumber: string | null;
};

export type VehicleExpenseEntry = {
  id: string;
  date: string;
  bucket: VehicleExpenseBucket;
  category: string;
  vendor: string;
  amountCents: number;
  receiptOnFile: boolean;
};

export type VehicleExpenseRow = {
  vehicleId: string;
  label: string;
  buckets: Record<VehicleExpenseBucket, number | null>;
  expenseCents: number | null;
  entries: VehicleExpenseEntry[];
};

export type VehicleExpenseReport = {
  vehicles: VehicleExpenseRow[];
  buckets: Record<VehicleExpenseBucket, number | null>;
  expenseCents: number | null;
  notes: string[];
};

type Money = { cents: number | null; blank: boolean; invalid: boolean };
type Group = {
  vehicleId: string;
  label: string;
  buckets: Record<VehicleExpenseBucket, number>;
  entries: VehicleExpenseEntry[];
  bad: boolean;
};

export function expenseBucket(category: string | null | undefined): VehicleExpenseBucket {
  return BUCKET_OF[(category ?? "").trim().toLowerCase()] ?? "other";
}

export function buildVehicleExpenseLine(input: {
  expenses: ExpenseMovement[];
  services: ServiceMovement[];
  vehicles: ExpenseVehicle[];
}): VehicleExpenseReport {
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const groups = new Map<string, Group>();
  const notes: string[] = [];
  let companyBad = false;

  const groupFor = (vehicleId: string): Group => {
    const existing = groups.get(vehicleId);
    if (existing) return existing;
    const created: Group = {
      vehicleId,
      label: vehicleLabel(vehicles.get(vehicleId)),
      buckets: emptyBuckets(),
      entries: [],
      bad: false,
    };
    groups.set(vehicleId, created);
    return created;
  };

  const mark = (vehicleId: string | null) => {
    companyBad = true;
    if (vehicleId) groupFor(vehicleId).bad = true;
  };

  const add = (vehicleId: string, category: string | null, cents: number, entry: Omit<VehicleExpenseEntry, "bucket" | "amountCents">) => {
    const group = groupFor(vehicleId);
    const bucket = expenseBucket(category);
    const next = group.buckets[bucket] + cents;
    if (!Number.isSafeInteger(next)) {
      mark(vehicleId);
      return;
    }
    group.buckets[bucket] = next;
    group.entries.push({ ...entry, bucket, amountCents: cents });
  };

  for (const vehicle of input.vehicles) groupFor(vehicle.id);

  const linked = new Map<string, ExpenseMovement[]>();
  for (const expense of input.expenses) {
    if (!expense.maintenanceRecordId) continue;
    const rows = linked.get(expense.maintenanceRecordId) ?? [];
    rows.push(expense);
    linked.set(expense.maintenanceRecordId, rows);
  }

  for (const expense of input.expenses) {
    if (expense.maintenanceRecordId) continue;
    const place = placed([expense.incurredOn]);
    const cents = readCents(expense.amount);
    if (place.invalid || !place.date || cents.invalid || cents.blank || cents.cents === null || !expense.vehicleId) {
      mark(expense.vehicleId);
      continue;
    }
    add(expense.vehicleId, expense.category, cents.cents, {
      id: expense.id,
      date: place.date,
      category: (expense.category ?? "").trim() || "other",
      vendor: vendor(expense.vendorName),
      receiptOnFile: !!expense.receiptPath?.trim(),
    });
  }

  const seen = new Set(input.services.map((service) => service.id));
  for (const [recordId, rows] of linked) {
    if (!seen.has(recordId) && rows.length) companyBad = true;
  }

  for (const service of input.services) {
    const place = placed([service.performedOn, service.completedAt, service.createdAt]);
    const links = linked.get(service.id) ?? [];
    const linkPlaces = links.map((expense) => ({ expense, place: placed([expense.incurredOn]) }));
    if (linkPlaces.some((link) => link.place.invalid || !link.place.date)) mark(service.vehicleId);
    if (place.invalid || !place.date || !service.vehicleId) {
      mark(service.vehicleId);
      continue;
    }
    if (links.some((expense) => expense.vehicleId !== service.vehicleId)) {
      mark(service.vehicleId);
      continue;
    }
    const name = `${(service.category ?? "").trim() || "Service"} for ${vehicleLabel(vehicles.get(service.vehicleId))}`;
    const share = readCents(service.companyShare);
    const total = readCents(service.totalCost);
    if (!links.length) {
      if (share.invalid) { mark(service.vehicleId); continue; }
      if (share.blank) {
        if (total.invalid || total.blank || total.cents === null) { mark(service.vehicleId); continue; }
        if (total.cents) {
          add(service.vehicleId, service.category, total.cents, {
            id: `service:${service.id}`,
            date: place.date,
            category: (service.category ?? "").trim() || "other",
            vendor: vendor(service.vendorName),
            receiptOnFile: false,
          });
        }
        notes.push(`Company share was blank for ${name}. Total cost was used.`);
        continue;
      }
      if (share.cents) {
        add(service.vehicleId, service.category, share.cents, {
          id: `service:${service.id}`,
          date: place.date,
          category: (service.category ?? "").trim() || "other",
          vendor: vendor(service.vendorName),
          receiptOnFile: false,
        });
      }
      continue;
    }
    const amounts = linkPlaces.filter((link) => link.place.date).map((link) => readCents(link.expense.amount));
    if (amounts.some((amount) => amount.invalid || amount.blank || amount.cents === null)) {
      mark(service.vehicleId);
      continue;
    }
    const linkedCents = (amounts as { cents: number }[]).reduce((acc, amount) => acc + amount.cents, 0);
    if (!Number.isSafeInteger(linkedCents)) { mark(service.vehicleId); continue; }
    for (const link of linkPlaces) {
      if (!link.place.date) continue;
      const cents = readCents(link.expense.amount).cents ?? 0;
      add(service.vehicleId, link.expense.category, cents, {
        id: link.expense.id,
        date: link.place.date,
        category: (link.expense.category ?? "").trim() || "other",
        vendor: vendor(link.expense.vendorName),
        receiptOnFile: !!link.expense.receiptPath?.trim(),
      });
    }
    if (share.blank) notes.push(`Company share was blank for ${name}. The linked expense is counted once.`);
    else if (share.invalid) notes.push(`Company share could not be read for ${name}. The linked expense is counted once.`);
    else if (share.cents !== null && share.cents !== linkedCents) notes.push(`Company share ${centsText(share.cents)} does not match the linked expense ${centsText(linkedCents)} for ${name}. The linked expense is counted once.`);
  }

  const rows = [...groups.values()].map((group) => finish(group)).sort((a, b) => a.label.localeCompare(b.label) || a.vehicleId.localeCompare(b.vehicleId));
  const incomplete = companyBad || rows.some((row) => row.expenseCents === null);
  return {
    vehicles: rows,
    buckets: incomplete ? nullBuckets() : sumBuckets(rows),
    expenseCents: incomplete ? null : sumNumbers(rows.map((row) => row.expenseCents)),
    notes: [...new Set(notes)],
  };
}

function finish(group: Group): VehicleExpenseRow {
  if (group.bad) {
    return { vehicleId: group.vehicleId, label: group.label, buckets: nullBuckets(), expenseCents: null, entries: [] };
  }
  const expenseCents = sumBucket(group.buckets);
  return {
    vehicleId: group.vehicleId,
    label: group.label,
    buckets: expenseCents === null ? nullBuckets() : { ...group.buckets },
    expenseCents,
    entries: group.entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
  };
}

function emptyBuckets(): Record<VehicleExpenseBucket, number> {
  return { maintenance: 0, insurance: 0, registration: 0, tolls: 0, cleaning: 0, other: 0 };
}
function nullBuckets(): Record<VehicleExpenseBucket, number | null> {
  return { maintenance: null, insurance: null, registration: null, tolls: null, cleaning: null, other: null };
}
function sumBucket(buckets: Record<VehicleExpenseBucket, number>): number | null {
  const total = VEHICLE_EXPENSE_BUCKETS.reduce((acc, key) => acc + buckets[key], 0);
  return Number.isSafeInteger(total) ? total : null;
}
function sumBuckets(rows: VehicleExpenseRow[]): Record<VehicleExpenseBucket, number | null> {
  const totals = emptyBuckets();
  for (const row of rows) {
    for (const key of VEHICLE_EXPENSE_BUCKETS) {
      const value = row.buckets[key];
      if (value === null) return nullBuckets();
      totals[key] += value;
    }
  }
  return VEHICLE_EXPENSE_BUCKETS.some((key) => !Number.isSafeInteger(totals[key])) ? nullBuckets() : totals;
}
function sumNumbers(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = (values as number[]).reduce((acc, value) => acc + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function readCents(value: string | number | null | undefined): Money {
  if (value === null || value === undefined || value === "") return { cents: null, blank: true, invalid: false };
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { cents: null, blank: false, invalid: true };
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? { cents, blank: false, invalid: false } : { cents: null, blank: false, invalid: true };
}

function placed(candidates: (string | null)[]): { date: string | null; invalid: boolean } {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return { date: candidate, invalid: false };
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) && !Number.isNaN(Date.parse(candidate))) {
      return { date: new Date(candidate).toISOString().slice(0, 10), invalid: false };
    }
    return { date: null, invalid: true };
  }
  return { date: null, invalid: true };
}

function vendor(name: string | null): string {
  const text = name?.trim();
  return text ? text : "Vendor Not Listed";
}

function vehicleLabel(vehicle: ExpenseVehicle | undefined): string {
  if (!vehicle) return "Vehicle Not Listed";
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  return [vehicle.unitNumber?.trim() ? `Unit ${vehicle.unitNumber.trim()}` : "", name, vehicle.licensePlate?.trim() ?? ""].filter(Boolean).join(" · ") || "Vehicle Not Listed";
}

function centsText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
