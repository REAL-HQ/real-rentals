import { tierAllows, type StaffTier } from "./roles";
import { STRIPE_PAYOUT_RECON_OFF } from "./stripe-payout-recon-flag";
import {
  buildPayoutRecon,
  payoutReconWindow,
  unavailablePayoutRecon,
  type PayoutReconReport,
  type PayoutWindow,
  type ReconApplication,
  type ReconPayment,
} from "./stripe-payout-recon";
import type { LocalLink } from "./stripe-unmatched";
import type { PayoutReconStripeRead } from "./stripe-payout-recon-read.server";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. This file only reads payments and applications.
 * Stripe is the caller's list. A Stripe failure is returned before the database is read.
 */

export type PayoutReconResponse = { status: "disabled" } | { status: "ready"; report: PayoutReconReport };
export type PayoutReconDirectory = {
  applications: ReconApplication[];
  payments: ReconPayment[];
  rentals?: LocalLink[];
  applicationLinks?: LocalLink[];
};
export type PayoutReconLoad = { ok: true; directory: PayoutReconDirectory } | { ok: false; capped: boolean };

export async function runPayoutRecon(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  load: () => Promise<PayoutReconLoad>;
  readStripe: (window: PayoutWindow) => Promise<PayoutReconStripeRead>;
}): Promise<PayoutReconResponse> {
  if (!input.enabled) throw new Error(STRIPE_PAYOUT_RECON_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const window = payoutReconWindow(input.now);
  if (!window) return { status: "ready", report: unavailablePayoutRecon(null) };
  const stripe = await input.readStripe(window);
  if (!stripe.ok) return { status: "ready", report: unavailablePayoutRecon(window, stripe.capped ? "capped" : "unavailable") };
  const loaded = await input.load();
  if (!loaded.ok) {
    return {
      status: "ready",
      report: { from: window.from, through: window.through, stripeCheck: "ready", directory: "unavailable", payouts: [], paidNotInPayout: [] },
    };
  }
  return { status: "ready", report: buildPayoutRecon({ window, payouts: stripe.payouts, invoiceLinks: stripe.invoiceLinks, ...loaded.directory }) };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type PayoutReconClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const APPLICATION_COLUMNS = "id,full_name,deleted_at,stripe_customer_id";
const PAYMENT_COLUMNS = "id,driver_id,status,amount,net_collected,paid_date,stripe_payment_intent_id,stripe_invoice_id";
const RENTAL_COLUMNS = "id,stripe_subscription_id,stripe_customer_id";

export async function loadPayoutReconDirectory(supabase: PayoutReconClient): Promise<PayoutReconLoad> {
  const applications = await readPages(supabase, "applications", APPLICATION_COLUMNS);
  if (!applications.ok) return applications;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return payments;
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const mappedApplications: ReconApplication[] = [];
  const applicationLinks: LocalLink[] = [];
  for (const row of applications.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedApplications.push({
      id: row.id,
      name: text(row.full_name) ?? "Driver",
      deleted: row.deleted_at != null && row.deleted_at !== "",
    });
    const customerId = text(row.stripe_customer_id);
    if (customerId) applicationLinks.push({ customerId });
  }
  const mappedPayments: ReconPayment[] = [];
  for (const row of payments.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string") return { ok: false, capped: false };
    mappedPayments.push({
      id: row.id,
      driverId: text(row.driver_id),
      status: row.status,
      amount: row.amount,
      netCollected: row.net_collected,
      paidDate: text(row.paid_date),
      stripePaymentIntentId: text(row.stripe_payment_intent_id),
      stripeInvoiceId: text(row.stripe_invoice_id),
    });
  }
  const rentalLinks: LocalLink[] = [];
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    rentalLinks.push({
      subscriptionId: text(row.stripe_subscription_id),
      customerId: text(row.stripe_customer_id),
    });
  }
  return { ok: true, directory: { applications: mappedApplications, payments: mappedPayments, rentals: rentalLinks, applicationLinks } };
}

async function readPages(supabase: PayoutReconClient, table: string, columns: string): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false, capped: false };
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return { ok: false, capped: false };
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < 1000) return { ok: true, rows };
  }
  return { ok: false, capped: true };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
