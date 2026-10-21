/**
 * Read-only monitor rows. Disputes that still need a response come first, by evidence due date.
 * Failed charges and payment intents are the last 14 days. Subscriptions are past_due or unpaid.
 * A driver match uses a payment intent, a subscription id, or a Stripe customer id already stored.
 * Nothing here writes, responds to a dispute, or retries a payment.
 */

export const STRIPE_CHECK_UNAVAILABLE = "Stripe check unavailable";
export const RISK_WINDOW_DAYS = 14;
export const DIRECTORY_INCOMPLETE = "Driver records were incomplete";

const OPEN_DISPUTE_STATUSES = new Set([
  "needs_response",
  "warning_needs_response",
  "under_review",
  "warning_under_review",
]);

const STATUS_LABEL: Record<string, string> = {
  needs_response: "Needs Response",
  warning_needs_response: "Warning Needs Response",
  under_review: "Under Review",
  warning_under_review: "Warning Under Review",
  failed: "Failed",
  past_due: "Past Due",
  unpaid: "Unpaid",
};

export type RiskWindow = { gte: number; lt: number };

export type RiskApplication = { id: string; name: string; stripeCustomerId: string | null; deleted: boolean };
export type RiskRental = { id: string; applicationId: string | null; stripeCustomerId: string | null; stripeSubscriptionId: string | null };
export type RiskPayment = { id: string; driverId: string | null; stripePaymentIntentId: string | null; stripeSubscriptionId: string | null };

export type RiskDispute = {
  id: string;
  status: string;
  dueBy: number | null;
  created: number;
  customerId: string | null;
  paymentIntentId: string | null;
};

export type RiskFailure = {
  id: string;
  created: number;
  customerId: string | null;
  paymentIntentId: string | null;
  declineCode: string | null;
};

export type RiskSubscriptionFact = {
  id: string;
  status: string;
  customerId: string | null;
  currentPeriodEnd: number | null;
};

export type RiskKind = "dispute" | "failed_payment" | "subscription";

export type RiskRow = {
  id: string;
  kind: RiskKind;
  kindLabel: string;
  status: string;
  whenEt: string;
  declineCode: string | null;
  applicationId: string | null;
  driverName: string | null;
};

export type RiskReport = {
  rows: RiskRow[];
  stripeCheck: "ready" | "unavailable";
  directory: "ready" | "unavailable" | "skipped";
  gte: number;
  lt: number;
};

export function riskWindow(now: Date): RiskWindow | null {
  const lt = Math.floor(now.getTime() / 1000);
  const gte = lt - RISK_WINDOW_DAYS * 86400;
  if (!Number.isSafeInteger(lt) || !Number.isSafeInteger(gte) || gte >= lt) return null;
  return { gte, lt };
}

export function formatEt(unixSeconds: number | null): string {
  if (unixSeconds == null || !Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(unixSeconds * 1000));
}

export function unavailableRiskReport(window: RiskWindow): RiskReport {
  return { rows: [], stripeCheck: "unavailable", directory: "skipped", gte: window.gte, lt: window.lt };
}

export function buildStripeRiskMonitor(input: {
  window: RiskWindow;
  disputes: RiskDispute[];
  failures: RiskFailure[];
  subscriptions: RiskSubscriptionFact[];
  applications: RiskApplication[];
  rentals: RiskRental[];
  payments: RiskPayment[];
}): RiskReport {
  const directory = directoryIndex(input.applications, input.rentals, input.payments);
  const failures = dedupedFailures(input.failures, input.window);
  const rows: Array<RiskRow & { rank: number; sortAt: number }> = [];
  for (const dispute of input.disputes) {
    if (!OPEN_DISPUTE_STATUSES.has(dispute.status)) continue;
    const driver = matchDriver(directory, { paymentIntentId: dispute.paymentIntentId, customerId: dispute.customerId, subscriptionId: null });
    rows.push({
      id: dispute.id,
      kind: "dispute",
      kindLabel: "Dispute",
      status: statusLabel(dispute.status),
      whenEt: formatEt(dispute.dueBy),
      declineCode: null,
      ...driver,
      rank: 0,
      sortAt: dispute.dueBy ?? Number.MAX_SAFE_INTEGER,
    });
  }
  for (const subscription of input.subscriptions) {
    if (subscription.status !== "past_due" && subscription.status !== "unpaid") continue;
    const driver = matchDriver(directory, { paymentIntentId: null, customerId: subscription.customerId, subscriptionId: subscription.id });
    rows.push({
      id: subscription.id,
      kind: "subscription",
      kindLabel: "Subscription",
      status: statusLabel(subscription.status),
      whenEt: formatEt(subscription.currentPeriodEnd),
      declineCode: null,
      ...driver,
      rank: subscription.status === "past_due" ? 1 : 2,
      sortAt: subscription.currentPeriodEnd ?? Number.MAX_SAFE_INTEGER,
    });
  }
  for (const failure of failures) {
    const driver = matchDriver(directory, { paymentIntentId: failure.paymentIntentId, customerId: failure.customerId, subscriptionId: null });
    rows.push({
      id: failure.id,
      kind: "failed_payment",
      kindLabel: "Failed Payment",
      status: "Failed",
      whenEt: formatEt(failure.created),
      declineCode: failure.declineCode,
      ...driver,
      rank: 3,
      sortAt: failure.created,
    });
  }
  rows.sort((a, b) => a.rank - b.rank || a.sortAt - b.sortAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    rows: rows.map(({ rank: _rank, sortAt: _sortAt, ...row }) => row),
    stripeCheck: "ready",
    directory: "ready",
    gte: input.window.gte,
    lt: input.window.lt,
  };
}

export function stripeRiskMonitorToCsv(report: RiskReport): string {
  const lines: string[][] = [
    ["Stripe Disputes & Failed-Payment Monitor"],
    ["Eastern Time"],
    ["Window Start", formatEt(report.gte)],
    ["Window End", formatEt(report.lt)],
    [],
    ["Kind", "Status", "When", "Decline Code", "Driver", "Driver Screen", "Payments Screen"],
    ...report.rows.map((row) => [
      row.kindLabel,
      row.status,
      row.whenEt,
      row.declineCode ?? "",
      row.driverName ?? "",
      row.applicationId ? `/admin?tab=drivers&id=${row.applicationId}` : "",
      "/admin?tab=payments",
    ]),
  ];
  return `${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function dedupedFailures(failures: RiskFailure[], window: RiskWindow): RiskFailure[] {
  const byIntent = new Map<string, RiskFailure>();
  const loose: RiskFailure[] = [];
  for (const failure of failures) {
    if (!Number.isSafeInteger(failure.created) || failure.created < window.gte || failure.created >= window.lt) continue;
    const intent = failure.paymentIntentId;
    if (!intent) {
      loose.push(failure);
      continue;
    }
    const prior = byIntent.get(intent);
    if (!prior) {
      byIntent.set(intent, failure);
      continue;
    }
    byIntent.set(intent, {
      ...prior,
      declineCode: prior.declineCode ?? failure.declineCode,
      customerId: prior.customerId ?? failure.customerId,
      created: Math.min(prior.created, failure.created),
    });
  }
  return [...byIntent.values(), ...loose];
}

type Directory = {
  apps: Map<string, RiskApplication>;
  byCustomer: Map<string, string[]>;
  byPaymentIntent: Map<string, string[]>;
  bySubscription: Map<string, string[]>;
};

function directoryIndex(applications: RiskApplication[], rentals: RiskRental[], payments: RiskPayment[]): Directory {
  const apps = new Map<string, RiskApplication>();
  const byCustomer = new Map<string, string[]>();
  for (const app of applications) {
    if (app.deleted || !app.id) continue;
    apps.set(app.id, app);
    if (app.stripeCustomerId) pushUnique(byCustomer, app.stripeCustomerId, app.id);
  }
  const byPaymentIntent = new Map<string, string[]>();
  const bySubscription = new Map<string, string[]>();
  for (const payment of payments) {
    if (payment.stripePaymentIntentId && payment.driverId && apps.has(payment.driverId)) {
      pushUnique(byPaymentIntent, payment.stripePaymentIntentId, payment.driverId);
    }
    if (payment.stripeSubscriptionId && payment.driverId && apps.has(payment.driverId)) {
      pushUnique(bySubscription, payment.stripeSubscriptionId, payment.driverId);
    }
  }
  for (const rental of rentals) {
    if (!rental.applicationId || !apps.has(rental.applicationId)) continue;
    if (rental.stripeCustomerId) pushUnique(byCustomer, rental.stripeCustomerId, rental.applicationId);
    if (rental.stripeSubscriptionId) pushUnique(bySubscription, rental.stripeSubscriptionId, rental.applicationId);
  }
  return { apps, byCustomer, byPaymentIntent, bySubscription };
}

function matchDriver(
  directory: Directory,
  keys: { paymentIntentId: string | null; customerId: string | null; subscriptionId: string | null },
): { applicationId: string | null; driverName: string | null } {
  const id = one(keys.paymentIntentId ? directory.byPaymentIntent.get(keys.paymentIntentId) : undefined)
    ?? one(keys.subscriptionId ? directory.bySubscription.get(keys.subscriptionId) : undefined)
    ?? one(keys.customerId ? directory.byCustomer.get(keys.customerId) : undefined);
  if (!id) return { applicationId: null, driverName: null };
  return { applicationId: id, driverName: directory.apps.get(id)?.name ?? null };
}

function one(ids: string[] | undefined): string | null {
  return ids && ids.length === 1 ? ids[0] : null;
}

function pushUnique(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key) ?? [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function escapeCsvCell(value: string): string {
  const formula = /^[=+\-@\t\r]/.test(value);
  const safe = formula ? `'${value}` : value;
  if (formula || /[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
