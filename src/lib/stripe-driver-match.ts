import { toE164 } from "./sms.server";

/**
 * The #76 match, kept small enough to share. Applications are the driver records.
 * Order: stripe_customer_id, then exact email, then E.164 phone.
 * More than one candidate at a tier stays unmatched and does not fall through.
 * Deleted and duplicate applications are ignored. An empty email or an
 * unusable phone matches nobody.
 */

export type DriverMatchApplication = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  stripeCustomerId: string | null;
  userId: string | null;
  deletedAt: string | null;
  status: string;
};
export type DriverMatchRental = {
  id: string;
  applicationId: string | null;
  driverId: string | null;
  stripeCustomerId: string | null;
};
export type DriverMatchCustomer = { id: string; email: string | null; phone: string | null };
export type DriverMatchConfidence = "high" | "medium" | "low";
export type DriverMatch = {
  driverId: string | null;
  driverName: string | null;
  phone: string | null;
  confidence: DriverMatchConfidence | null;
  reason: string;
};

const emailKey = (value: string | null | undefined) => {
  const text = value?.trim().toLowerCase();
  return text ? text : null;
};
const live = (apps: DriverMatchApplication[]) => apps.filter((app) => !app.deletedAt && app.status !== "duplicate");

export function matchDriver(input: {
  applications: DriverMatchApplication[];
  rentals: DriverMatchRental[];
  customer: DriverMatchCustomer;
}): DriverMatch {
  const apps = live(input.applications);
  const byId = new Map(apps.map((app) => [app.id, app]));
  const none = (reason: string): DriverMatch => ({ driverId: null, driverName: null, phone: null, confidence: null, reason });
  const idHits = () => {
    const ids = new Set<string>();
    for (const app of apps) if (app.stripeCustomerId === input.customer.id) ids.add(app.id);
    for (const rental of input.rentals) {
      if (rental.stripeCustomerId !== input.customer.id) continue;
      if (rental.applicationId && byId.has(rental.applicationId)) ids.add(rental.applicationId);
      if (rental.driverId) for (const app of apps) if (app.userId === rental.driverId) ids.add(app.id);
    }
    return [...ids];
  };
  const byKey = (key: (app: DriverMatchApplication) => string | null, value: string | null) => {
    if (!value) return [];
    return apps.filter((app) => key(app) === value).map((app) => app.id);
  };
  const tiers: Array<{ confidence: DriverMatchConfidence; reason: string; ids: string[]; ambiguous: string }> = [
    { confidence: "high", reason: "Stripe Customer Id", ids: idHits(), ambiguous: "More Than One Stripe Customer Id" },
    { confidence: "medium", reason: "Exact Email", ids: byKey((app) => emailKey(app.email), emailKey(input.customer.email)), ambiguous: "More Than One Email" },
    { confidence: "low", reason: "Phone", ids: byKey((app) => toE164(app.phone), toE164(input.customer.phone)), ambiguous: "More Than One Phone" },
  ];
  for (const tier of tiers) {
    if (tier.ids.length > 1) return none(tier.ambiguous);
    if (tier.ids.length === 1) {
      const app = byId.get(tier.ids[0]!);
      if (!app) return none("No Match");
      return { driverId: app.id, driverName: app.fullName, phone: app.phone, confidence: tier.confidence, reason: tier.reason };
    }
  }
  return none("No Match");
}
