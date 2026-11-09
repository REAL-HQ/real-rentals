import { tierAllows, type StaffTier } from "./roles";
import { loadMatchDirectory, type MatchDirectory, type MatchDirectoryClient } from "./stripe-match.server";
import { PAYOUT_PAGE_CAP, buildPayoutBreakdown, payoutWindow, type PayoutInput, type PayoutReport } from "./payout-breakdown";
import type { PayoutCustomer } from "./payout-breakdown-read.server";

/**
 * Owners only. The flag is checked before the role and before any Stripe or
 * table read. Stripe comes from the caller (readLivePayoutBreakdown). This
 * file does not import Stripe.
 */

export type PayoutBreakdownResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: PayoutReport };

export async function runPayoutBreakdown(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  from: string;
  through: string;
  loadDirectory: () => Promise<MatchDirectory | null>;
  readStripe: (window: { gte: number; lt: number }) => Promise<{ ok: true; payouts: PayoutInput[]; customers: PayoutCustomer[]; capped: false } | { ok: false; reason: string; capped: boolean }>;
}): Promise<PayoutBreakdownResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const window = payoutWindow(input.from, input.through);
  if (!window) return { status: "unavailable", reason: "Choose a date range", report: null };
  const stripe = await input.readStripe({ gte: window.gte, lt: window.lt });
  if (!stripe.ok && stripe.capped) {
    return { status: "ready", report: { from: window.from, through: window.through, payouts: [], warnings: [PAYOUT_PAGE_CAP] } };
  }
  if (!stripe.ok) return { status: "unavailable", reason: stripe.reason, report: null };
  const directory = await input.loadDirectory();
  const warnings = directory ? [] : ["Driver records were incomplete. Charge matches are blank."];
  if (stripe.payouts.some((payout) => payout.transactionsCapped)) warnings.push(PAYOUT_PAGE_CAP);
  return {
    status: "ready",
    report: buildPayoutBreakdown({
      from: window.from,
      through: window.through,
      payouts: stripe.payouts,
      applications: directory?.applications ?? [],
      rentals: directory?.rentals ?? [],
      vehicles: directory?.vehicles ?? [],
      customers: stripe.customers,
      warnings,
    }),
  };
}

export function loadPayoutDirectory(supabase: MatchDirectoryClient) {
  return loadMatchDirectory(supabase);
}
