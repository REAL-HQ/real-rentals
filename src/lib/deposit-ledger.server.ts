import { tierAllows, type StaffTier } from "./roles";
import { DEPOSIT_LEDGER_OFF } from "./deposit-ledger-flag";
import {
  applyDepositStripe,
  buildDepositLedger,
  cappedDepositLedger,
  dollarsToCents,
  markStripeUnavailable,
  type DepositLedgerReport,
  type DepositStripeRead,
  type LedgerDeduction,
  type LedgerPayment,
  type LedgerPerson,
  type LedgerRental,
  type LedgerVehicle,
} from "./deposit-ledger";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. This file only reads the database. Stripe, when the
 * caller supplies it, runs after that read and cannot change a row's money.
 */

export type DepositLedgerResponse =
  | { status: "ready"; report: DepositLedgerReport }
  | { status: "unavailable"; reason: string };

export type DepositLoad =
  | {
      ok: true;
      rentals: LedgerRental[];
      payments: LedgerPayment[];
      deductions: LedgerDeduction[];
      people: LedgerPerson[];
      vehicles: LedgerVehicle[];
    }
  | { ok: false; capped: boolean };

export async function runDepositLedger(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<DepositLoad>;
  stripe?: (payments: LedgerPayment[]) => Promise<DepositStripeRead>;
}): Promise<DepositLedgerResponse> {
  if (!input.enabled) throw new Error(DEPOSIT_LEDGER_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) {
    if (!loaded.capped) return { status: "unavailable", reason: "Deposit records were incomplete" };
    const report = cappedDepositLedger(input.today);
    if (!report) return { status: "unavailable", reason: "The deposit date could not be read" };
    return { status: "ready", report };
  }
  const report = buildDepositLedger({ ...loaded, today: input.today });
  if (!report) return { status: "unavailable", reason: "The deposit date could not be read" };
  if (!input.stripe) return { status: "ready", report };
  try {
    const checked = await input.stripe(loaded.payments);
    if (!checked.ok) return { status: "ready", report: markStripeUnavailable(report) };
    return { status: "ready", report: applyDepositStripe(report, loaded.payments, checked.checks) };
  } catch {
    return { status: "ready", report: markStripeUnavailable(report) };
  }
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type DepositDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,application_id,vehicle_id,status,end_date,deposit_amount,deposit_held,deposit_status,deposit_refund_amount,deposit_settled_at";
const PAYMENT_COLUMNS = "id,rental_id,driver_id,type,status,amount,net_collected,refunded_amount,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id";
const DEDUCTION_COLUMNS = "id,rental_id,amount";
const PERSON_COLUMNS = "id,full_name";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model,license_plate";

export async function loadDepositLedger(supabase: DepositDirectoryClient): Promise<DepositLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS, { column: "type", value: "deposit" });
  if (!payments.ok) return payments;
  const deductions = await readPages(supabase, "deposit_deductions", DEDUCTION_COLUMNS);
  if (!deductions.ok) return deductions;

  const mappedRentals: LedgerRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row);
    if (!rental) return { ok: false, capped: false };
    mappedRentals.push(rental);
  }
  const mappedPayments: LedgerPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false, capped: false };
    mappedPayments.push(payment);
  }
  const mappedDeductions: LedgerDeduction[] = [];
  for (const row of deductions.rows) {
    const deduction = mapDeduction(row);
    if (!deduction) return { ok: false, capped: false };
    mappedDeductions.push(deduction);
  }

  const personIds = [
    ...mappedRentals.map((rental) => rental.applicationId),
    ...mappedPayments.map((payment) => payment.applicationId),
  ].filter((id): id is string => !!id);
  const people = await readByIds(supabase, "applications", PERSON_COLUMNS, personIds);
  if (!people.ok) return { ok: false, capped: false };
  const vehicles = await readByIds(supabase, "vehicles", VEHICLE_COLUMNS, mappedRentals.map((rental) => rental.vehicleId));
  if (!vehicles.ok) return { ok: false, capped: false };

  return {
    ok: true,
    rentals: mappedRentals,
    payments: mappedPayments,
    deductions: mappedDeductions,
    people: people.rows.map((row) => ({ id: String(row.id), name: text(row.full_name) || "Renter" })),
    vehicles: vehicles.rows.map((row) => ({ id: String(row.id), label: vehicleLabel(row) })),
  };
}

async function readPages(
  supabase: DepositDirectoryClient,
  table: string,
  columns: string,
  match?: { column: string; value: string },
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns);
    if (match) query = query.eq(match.column, match.value);
    query = query.order("id", { ascending: true }).limit(1000);
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

async function readByIds(
  supabase: DepositDirectoryClient,
  table: string,
  columns: string,
  ids: string[],
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: false }> {
  const rows: Array<Record<string, unknown>> = [];
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 100) {
    const response = await supabase.from(table).select(columns).in("id", unique.slice(index, index + 100)).limit(1000);
    if (response.error || !response.data) return { ok: false, capped: false };
    rows.push(...response.data);
  }
  return { ok: true, rows };
}

function mapRental(row: Record<string, unknown>): LedgerRental | null {
  if (typeof row.id !== "string" || typeof row.vehicle_id !== "string" || typeof row.status !== "string") return null;
  if (typeof row.deposit_status !== "string") return null;
  const expected = dollarsToCents(row.deposit_amount);
  const refund = dollarsToCents(row.deposit_refund_amount);
  const held = heldFlag(row.deposit_held);
  return {
    id: row.id,
    applicationId: text(row.application_id),
    vehicleId: row.vehicle_id,
    status: row.status,
    endDate: text(row.end_date),
    expectedCents: expected.cents,
    expectedUnreadable: expected.unreadable,
    depositHeld: held.held,
    depositHeldUnreadable: held.unreadable,
    depositStatus: row.deposit_status,
    refundCents: refund.cents,
    refundUnreadable: refund.unreadable,
    settledAt: text(row.deposit_settled_at),
  };
}

function mapPayment(row: Record<string, unknown>): LedgerPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return null;
  const amount = dollarsToCents(row.amount);
  const net = dollarsToCents(row.net_collected);
  const refunded = dollarsToCents(row.refunded_amount);
  const unreadable = amount.unreadable || net.unreadable || refunded.unreadable;
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    applicationId: text(row.driver_id),
    type: row.type,
    status: row.status,
    amountCents: amount.cents,
    netCollectedCents: net.cents,
    refundedCents: refunded.cents,
    unreadable,
    stripePaymentIntentId: text(row.stripe_payment_intent_id),
    stripeInvoiceId: text(row.stripe_invoice_id),
    stripeSubscriptionId: text(row.stripe_subscription_id),
  };
}

function mapDeduction(row: Record<string, unknown>): LedgerDeduction | null {
  if (typeof row.id !== "string" || typeof row.rental_id !== "string") return null;
  const amount = dollarsToCents(row.amount);
  return { id: row.id, rentalId: row.rental_id, amountCents: amount.cents, unreadable: amount.unreadable || amount.cents == null };
}

function heldFlag(value: unknown): { held: boolean | null; unreadable: boolean } {
  if (value == null) return { held: null, unreadable: false };
  if (typeof value === "boolean") return { held: value, unreadable: false };
  return { held: null, unreadable: true };
}

function vehicleLabel(row: Record<string, unknown>): string {
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const label = [text(row.unit_number) ? `Unit ${text(row.unit_number)}` : null, name || null, text(row.license_plate)].filter(Boolean).join(" · ");
  return label || "Vehicle";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
