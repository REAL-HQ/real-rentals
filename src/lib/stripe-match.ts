import { toE164 } from "./sms.server";

/**
 * Match live Stripe customers to applications. Applications are the driver
 * records. Nothing here writes a link or a rental.
 *
 * Order: stripe_customer_id (applications, or a rental that names one
 * application), then exact email, then E.164 phone. More than one candidate
 * at a tier stays unmatched. An empty email or an unusable phone matches nobody.
 */

export const CHARGE_WINDOW_DAYS = 90;

export type MatchApplication = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  stripeCustomerId: string | null;
  vehicleId: string | null;
  userId: string | null;
  deletedAt: string | null;
  status: string;
};
export type MatchRental = {
  id: string;
  applicationId: string | null;
  driverId: string | null;
  vehicleId: string | null;
  stripeCustomerId: string | null;
};
export type MatchVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  licensePlate: string | null;
};
export type StripeMatchCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "past_due";
  weeklyAmountCents: number | null;
  /** Unix seconds of the latest succeeded charge in the window, or null. */
  lastPaidAt: number | null;
};
export type StripeMatchConfidence = "high" | "medium" | "low";
export type StripeMatchRow = {
  customerId: string;
  name: string | null;
  email: string | null;
  subscriptionStatus: "active" | "past_due";
  weeklyAmountCents: number | null;
  lastPaidDate: string | null;
  confidence: StripeMatchConfidence | null;
  reason: string;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  rentalExists: boolean;
};
export type StripeMatchReport = { matched: StripeMatchRow[]; unmatched: StripeMatchRow[] };

const emailKey = (value: string | null | undefined) => {
  const text = value?.trim().toLowerCase();
  return text ? text : null;
};
const live = (apps: MatchApplication[]) => apps.filter((app) => !app.deletedAt && app.status !== "duplicate");

export function etDate(unixSeconds: number): string | null {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function vehicleLabel(vehicle: MatchVehicle | undefined): string | null {
  if (!vehicle) return null;
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  const plate = vehicle.licensePlate?.trim();
  return [name, plate].filter(Boolean).join(" · ") || "Unnamed Vehicle";
}

function rentalsFor(app: MatchApplication, rentals: MatchRental[], customerId: string): MatchRental[] {
  return rentals.filter((rental) =>
    rental.applicationId === app.id
    || (app.userId !== null && rental.driverId === app.userId)
    || rental.stripeCustomerId === customerId);
}

function vehicleFor(app: MatchApplication, rows: MatchRental[], vehicles: Map<string, MatchVehicle>): { id: string | null; label: string | null } {
  const ids = [...new Set(rows.map((rental) => rental.vehicleId).filter((id): id is string => !!id))];
  if (ids.length > 1) return { id: null, label: "More Than One" };
  const id = ids[0] ?? app.vehicleId;
  if (!id) return { id: null, label: null };
  return { id, label: vehicleLabel(vehicles.get(id)) ?? "Unknown Vehicle" };
}

export function matchStripeCustomers(input: {
  applications: MatchApplication[];
  rentals: MatchRental[];
  vehicles: MatchVehicle[];
  customers: StripeMatchCustomer[];
}): StripeMatchReport {
  const apps = live(input.applications);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const vehicles = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const matched: StripeMatchRow[] = [];
  const unmatched: StripeMatchRow[] = [];

  const idHits = (customerId: string): string[] => {
    const ids = new Set<string>();
    for (const app of apps) if (app.stripeCustomerId === customerId) ids.add(app.id);
    for (const rental of input.rentals) {
      if (rental.stripeCustomerId !== customerId) continue;
      if (rental.applicationId && byId.has(rental.applicationId)) ids.add(rental.applicationId);
      if (rental.driverId) for (const app of apps) if (app.userId === rental.driverId) ids.add(app.id);
    }
    return [...ids];
  };
  const byKey = (key: (app: MatchApplication) => string | null, value: string | null): string[] => {
    if (!value) return [];
    return apps.filter((app) => key(app) === value).map((app) => app.id);
  };

  for (const customer of input.customers) {
    const base = {
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      subscriptionStatus: customer.status,
      weeklyAmountCents: customer.weeklyAmountCents,
      lastPaidDate: customer.lastPaidAt === null ? null : etDate(customer.lastPaidAt),
    };
    const tiers: Array<{ confidence: StripeMatchConfidence; reason: string; ids: string[]; ambiguous: string }> = [
      { confidence: "high", reason: "Stripe Customer Id", ids: idHits(customer.id), ambiguous: "More Than One Stripe Customer Id" },
      { confidence: "medium", reason: "Exact Email", ids: byKey((app) => emailKey(app.email), emailKey(customer.email)), ambiguous: "More Than One Email" },
      { confidence: "low", reason: "Phone", ids: byKey((app) => toE164(app.phone), toE164(customer.phone)), ambiguous: "More Than One Phone" },
    ];
    let chosen: { confidence: StripeMatchConfidence; reason: string; app: MatchApplication } | null = null;
    let ambiguous: string | null = null;
    for (const tier of tiers) {
      if (tier.ids.length > 1) { ambiguous = tier.ambiguous; break; }
      if (tier.ids.length === 1) {
        const app = byId.get(tier.ids[0]!);
        if (app) chosen = { confidence: tier.confidence, reason: tier.reason, app };
        break;
      }
    }
    if (!chosen) {
      unmatched.push({ ...base, confidence: null, reason: ambiguous ?? "No Match", driverId: null, driverName: null, vehicleId: null, vehicleLabel: null, rentalExists: false });
      continue;
    }
    const rows = rentalsFor(chosen.app, input.rentals, customer.id);
    const vehicle = vehicleFor(chosen.app, rows, vehicles);
    matched.push({
      ...base,
      confidence: chosen.confidence,
      reason: chosen.reason,
      driverId: chosen.app.id,
      driverName: chosen.app.fullName,
      vehicleId: vehicle.id,
      vehicleLabel: vehicle.label,
      rentalExists: rows.length > 0,
    });
  }
  const sort = (rows: StripeMatchRow[]) => rows.sort((a, b) => (a.name ?? a.email ?? a.customerId).localeCompare(b.name ?? b.email ?? b.customerId));
  return { matched: sort(matched), unmatched: sort(unmatched) };
}
