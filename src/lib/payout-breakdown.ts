import { matchStripeCustomers, type MatchApplication, type MatchRental, type MatchVehicle, type StripeMatchCustomer } from "./stripe-match";
import { addCalendarDays, etMidnightUnix, etYmd } from "./weekly-cash-flow";

/**
 * One Eastern Time payout window. Balance transactions are grouped so their
 * parts sum to the payout: charge and refund amounts stay gross, Stripe fees
 * are the fee field (and any fee-only transaction), disputes and adjustments
 * stay together, and anything else is other. A payout transaction is the
 * movement itself and is not added again. This module does not call Stripe.
 */

export const PAYOUT_PAGE_CAP = "Stripe Reader Page Cap Reached. Payout Totals Are Not Shown.";

const CHARGE_TYPES = new Set(["charge", "payment"]);
const REFUND_TYPES = new Set(["refund", "payment_refund", "payment_failure_refund", "refund_failure"]);
const FEE_TYPES = new Set(["stripe_fee", "stripe_fx_fee", "tax_fee", "application_fee", "application_fee_refund"]);
const DISPUTE_TYPES = new Set(["adjustment", "dispute", "issuing_dispute"]);

export type PayoutTxn = {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  sourceId: string | null;
  customerId: string | null;
};

export type PayoutGroups = {
  chargesCents: number;
  refundsCents: number;
  feesCents: number;
  disputesCents: number;
  otherCents: number;
};

export type PayoutChargeLine = {
  id: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  driverName: string | null;
  vehicleLabel: string | null;
  rentalExists: boolean;
  matchReason: string;
};

export type PayoutRow = {
  id: string;
  created: string;
  arrivalDate: string;
  status: string;
  amountCents: number;
  currency: string;
  groups: PayoutGroups | null;
  sumCents: number | null;
  sumsToPayout: boolean;
  charges: PayoutChargeLine[];
};

export type PayoutReport = {
  from: string;
  through: string;
  payouts: PayoutRow[];
  warnings: string[];
};

export type PayoutInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  arrival: number;
  transactions: PayoutTxn[] | null;
  transactionsCapped: boolean;
};

export function defaultPayoutRange(now: Date): { from: string; through: string } | null {
  const today = etYmd(now);
  if (!today) return null;
  return { from: `${today.slice(0, 7)}-01`, through: today };
}

/** Inclusive Eastern Time dates. `lt` is the next midnight, for payout.created. */
export function payoutWindow(from: string, through: string): { from: string; through: string; gte: number; lt: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || from > through) return null;
  const next = addCalendarDays(through, 1);
  const gte = etMidnightUnix(from);
  const lt = next ? etMidnightUnix(next) : null;
  if (gte === null || lt === null || lt <= gte) return null;
  return { from, through, gte, lt };
}

function statusLabel(status: string): string {
  return status.split(/[_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function utcYmd(unixSeconds: number): string | null {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) return null;
  const text = new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function add(bucket: number, value: number): number | null {
  const next = bucket + value;
  return Number.isSafeInteger(next) ? next : null;
}

/** Gross amounts in their group, fees beside them. The sum is every net except the payout movement. */
export function sumPayoutTransactions(amountCents: number, currency: string, transactions: PayoutTxn[]): { groups: PayoutGroups | null; sumCents: number | null; sumsToPayout: boolean } {
  const fail = { groups: null, sumCents: null, sumsToPayout: false };
  if (!Number.isSafeInteger(amountCents) || currency !== "usd") return fail;
  const groups: PayoutGroups = { chargesCents: 0, refundsCents: 0, feesCents: 0, disputesCents: 0, otherCents: 0 };
  for (const txn of transactions) {
    if (txn.currency !== "usd" || txn.amount - txn.fee !== txn.net) return fail;
    if (!Number.isSafeInteger(txn.amount) || !Number.isSafeInteger(txn.fee) || !Number.isSafeInteger(txn.net)) return fail;
    if (txn.type === "payout") continue;
    const fee = add(groups.feesCents, FEE_TYPES.has(txn.type) ? txn.net : -txn.fee);
    if (fee === null) return fail;
    groups.feesCents = fee;
    if (FEE_TYPES.has(txn.type)) continue;
    const key = CHARGE_TYPES.has(txn.type) ? "chargesCents" : REFUND_TYPES.has(txn.type) ? "refundsCents" : DISPUTE_TYPES.has(txn.type) ? "disputesCents" : "otherCents";
    const next = add(groups[key], txn.amount);
    if (next === null) return fail;
    groups[key] = next;
  }
  const sum = groups.chargesCents + groups.refundsCents + groups.feesCents + groups.disputesCents + groups.otherCents;
  if (!Number.isSafeInteger(sum)) return fail;
  return { groups, sumCents: sum, sumsToPayout: sum === amountCents };
}

export function buildPayoutBreakdown(input: {
  from: string;
  through: string;
  payouts: PayoutInput[];
  applications: MatchApplication[];
  rentals: MatchRental[];
  vehicles: MatchVehicle[];
  customers: Array<{ id: string; name: string | null; email: string | null; phone: string | null }>;
  warnings?: string[];
}): PayoutReport {
  const warnings = [...(input.warnings ?? [])];
  const byCustomer = new Map<string, { driverName: string | null; vehicleLabel: string | null; rentalExists: boolean; reason: string }>();
  if (input.customers.length) {
    const customers: StripeMatchCustomer[] = input.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      status: "active",
      weeklyAmountCents: null,
      lastPaidAt: null,
    }));
    const matched = matchStripeCustomers({ applications: input.applications, rentals: input.rentals, vehicles: input.vehicles, customers });
    for (const row of [...matched.matched, ...matched.unmatched]) {
      byCustomer.set(row.customerId, { driverName: row.driverName, vehicleLabel: row.vehicleLabel, rentalExists: row.rentalExists, reason: row.reason });
    }
  }
  const payouts = input.payouts.map((payout) => {
    const created = etYmd(new Date(payout.created * 1000)) ?? "";
    const arrivalDate = utcYmd(payout.arrival) ?? "";
    if (payout.transactionsCapped || payout.transactions === null) {
      warnings.push(payout.transactionsCapped
        ? `Payout ${payout.id} hit the page cap. Its total is flagged.`
        : `Payout ${payout.id} balance transactions were incomplete. Its total is flagged.`);
      return row(payout, created, arrivalDate, { groups: null, sumCents: null, sumsToPayout: false }, []);
    }
    const summed = sumPayoutTransactions(payout.amount, payout.currency, payout.transactions);
    const charges = payout.transactions.filter((txn) => CHARGE_TYPES.has(txn.type)).map((txn) => {
      const match = txn.customerId ? byCustomer.get(txn.customerId) : undefined;
      return {
        id: txn.sourceId ?? txn.id,
        amountCents: txn.amount,
        feeCents: txn.fee,
        netCents: txn.net,
        driverName: match?.driverName ?? null,
        vehicleLabel: match?.vehicleLabel ?? null,
        rentalExists: match?.rentalExists ?? false,
        matchReason: match?.reason ?? "No Match",
      };
    });
    return row(payout, created, arrivalDate, summed, charges);
  });
  return { from: input.from, through: input.through, payouts, warnings };
}

function row(payout: PayoutInput, created: string, arrivalDate: string, summed: { groups: PayoutGroups | null; sumCents: number | null; sumsToPayout: boolean }, charges: PayoutChargeLine[]): PayoutRow {
  return {
    id: payout.id,
    created,
    arrivalDate,
    status: statusLabel(payout.status),
    amountCents: payout.amount,
    currency: payout.currency,
    groups: summed.groups,
    sumCents: summed.sumCents,
    sumsToPayout: summed.sumsToPayout,
    charges,
  };
}

function centsText(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function csvField(value: string): string {
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !numeric && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Browser download. Amounts are dollars. A mismatch is the word Mismatch. */
export function payoutBreakdownCsv(report: PayoutReport): string {
  const lines: string[][] = [
    ["From", report.from],
    ["Through", report.through],
    [],
    ["Payout", "Created", "Arrival Date", "Status", "Amount", "Charges", "Refunds", "Stripe Fees", "Disputes Or Adjustments", "Other", "Sum", "Check"],
    ...report.payouts.map((payout) => [
      payout.id,
      payout.created,
      payout.arrivalDate,
      payout.status,
      centsText(payout.amountCents),
      centsText(payout.groups?.chargesCents ?? null),
      centsText(payout.groups?.refundsCents ?? null),
      centsText(payout.groups?.feesCents ?? null),
      centsText(payout.groups?.disputesCents ?? null),
      centsText(payout.groups?.otherCents ?? null),
      centsText(payout.sumCents),
      payout.sumsToPayout ? "Sums To The Payout" : "Mismatch",
    ]),
    [],
    ["Payout", "Charge", "Amount", "Fee", "Net", "Renter", "Vehicle", "Rental", "Match"],
    ...report.payouts.flatMap((payout) => payout.charges.map((charge) => [
      payout.id,
      charge.id,
      centsText(charge.amountCents),
      centsText(charge.feeCents),
      centsText(charge.netCents),
      charge.driverName ?? "",
      charge.vehicleLabel ?? "",
      charge.rentalExists ? "Yes" : "No",
      charge.matchReason,
    ])),
    ...report.warnings.map((warning) => ["Warning", warning]),
  ];
  return lines.map((line) => line.map((cell) => csvField(String(cell ?? ""))).join(",")).join("\n");
}
