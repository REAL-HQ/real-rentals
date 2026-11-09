import { STRIPE_READER_MAX_PAGES, STRIPE_READER_TIMEOUT_MS, paginateStripeList } from "./stripe-reader";
import { createReadOnlyStripe } from "./stripe-reader.server";
import type { ListedCharge, RentStripeRead, StripeRentFact } from "./rent-reconciliation";

/**
 * Read-only Stripe side of Rent Payment Reconciliation.
 * charges.list, refunds.list, paymentIntents.retrieve, charges.retrieve,
 * and invoices.retrieve only. The 60 second cache is on.
 * A page cap or any Stripe error returns ok: false. A missing id is a fact
 * with outcome missing, so the database rows stay classified.
 */

type Page<T> = { data: T[]; has_more: boolean };
type CallOptions = { timeout?: number };
type RawCharge = {
  id?: unknown;
  amount?: unknown;
  amount_captured?: unknown;
  amount_refunded?: unknown;
  currency?: unknown;
  status?: unknown;
  customer?: unknown;
  payment_intent?: unknown;
  invoice?: unknown;
  livemode?: unknown;
};
type RawIntent = {
  id?: unknown;
  status?: unknown;
  amount?: unknown;
  amount_received?: unknown;
  currency?: unknown;
  customer?: unknown;
  latest_charge?: unknown;
  livemode?: unknown;
};
type RawInvoice = {
  id?: unknown;
  status?: unknown;
  amount_paid?: unknown;
  currency?: unknown;
  customer?: unknown;
  payment_intent?: unknown;
  charge?: unknown;
  livemode?: unknown;
};

export type RentStripeGateway = {
  charges: {
    list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<RawCharge>>;
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawCharge>;
  };
  refunds: {
    list: (params: { created: { gte: number; lt: number }; limit: number; starting_after?: string }, options?: CallOptions) => Promise<Page<{ id?: unknown }>>;
  };
  paymentIntents: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawIntent>;
  };
  invoices: {
    retrieve: (id: string, params?: Record<string, never>, options?: CallOptions) => Promise<RawInvoice>;
  };
};

export type RentStripeRequest = {
  gte: number;
  lt: number;
  paymentIntentIds: string[];
  invoiceIds: string[];
};

const PAGE = 100;

export async function readRentStripe(gateway: RentStripeGateway, request: RentStripeRequest): Promise<RentStripeRead> {
  const deadline = Date.now() + STRIPE_READER_TIMEOUT_MS;
  const now = () => Date.now();
  const timeout = () => Math.max(1, Math.min(10_000, deadline - now()));
  try {
    const listed = await paginateStripeList(
      (cursor) => gateway.charges.list(
        { created: { gte: request.gte, lt: request.lt }, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) },
        { timeout: timeout() },
      ),
      { label: "rent charges", maxPages: STRIPE_READER_MAX_PAGES, deadline, now, strict: true, map: mapCharge },
    );
    if (!listed.ok) return { ok: false };
    const refunds = await paginateStripeList(
      (cursor) => gateway.refunds.list(
        { created: { gte: request.gte, lt: request.lt }, limit: PAGE, ...(cursor ? { starting_after: cursor } : {}) },
        { timeout: timeout() },
      ),
      { label: "rent refunds", maxPages: STRIPE_READER_MAX_PAGES, deadline, now, strict: true },
    );
    if (!refunds.ok) return { ok: false };
    const charges = uniqueCharges(listed.rows);
    const facts: StripeRentFact[] = [];
    for (const id of unique(request.paymentIntentIds)) {
      if (now() >= deadline) return { ok: false };
      const charge = charges.find((item) => item.paymentIntentId === id);
      if (charge) {
        facts.push(factFromCharge(id, charge));
        continue;
      }
      const fact = await factFromIntent(gateway, id, timeout);
      if (fact === "bad") return { ok: false };
      facts.push(fact);
    }
    for (const id of unique(request.invoiceIds)) {
      if (facts.some((fact) => fact.forId === id)) continue;
      if (now() >= deadline) return { ok: false };
      const charge = charges.find((item) => item.invoiceId === id);
      if (charge) {
        facts.push(factFromCharge(id, charge));
        continue;
      }
      const fact = await factFromInvoice(gateway, id, timeout);
      if (fact === "bad") return { ok: false };
      facts.push(fact);
    }
    return { ok: true, charges, facts };
  } catch {
    return { ok: false };
  }
}

export async function readLiveRentStripe(request: RentStripeRequest): Promise<RentStripeRead> {
  try {
    return await readRentStripe(createReadOnlyStripe("live", { cache: true }) as unknown as RentStripeGateway, request);
  } catch {
    return { ok: false };
  }
}

async function factFromIntent(gateway: RentStripeGateway, id: string, timeout: () => number): Promise<StripeRentFact | "bad"> {
  let intent: RawIntent;
  try {
    intent = await gateway.paymentIntents.retrieve(id, {}, { timeout: timeout() });
  } catch (error) {
    if (isMissing(error)) return missingFact(id);
    throw error;
  }
  if (!intent || typeof intent !== "object" || intent.livemode === false) return "bad";
  if (typeof intent.id === "string" && intent.id !== id) return "bad";
  const charge = await chargeForIntent(gateway, intent, timeout);
  if (charge === "bad") return "bad";
  if (charge) return factFromCharge(id, charge);
  const status = typeof intent.status === "string" ? intent.status : null;
  if (status === "succeeded") {
    const captured = integerCents(intent.amount_received ?? intent.amount);
    if (captured == null) return "bad";
    return {
      forId: id,
      paymentIntentId: id,
      invoiceId: null,
      chargeId: null,
      customerId: idOf(intent.customer),
      capturedCents: captured,
      refundedCents: 0,
      currency: text(intent.currency),
      outcome: "succeeded",
      status,
    };
  }
  if (status === "canceled" || status === "requires_payment_method" || status === "failed") {
    return {
      forId: id,
      paymentIntentId: id,
      invoiceId: null,
      chargeId: null,
      customerId: idOf(intent.customer),
      capturedCents: integerCents(intent.amount),
      refundedCents: 0,
      currency: text(intent.currency),
      outcome: "failed",
      status: status === "canceled" ? "failed" : status,
    };
  }
  return missingFact(id);
}

async function factFromInvoice(gateway: RentStripeGateway, id: string, timeout: () => number): Promise<StripeRentFact | "bad"> {
  let invoice: RawInvoice;
  try {
    invoice = await gateway.invoices.retrieve(id, {}, { timeout: timeout() });
  } catch (error) {
    if (isMissing(error)) return missingFact(id);
    throw error;
  }
  if (!invoice || typeof invoice !== "object" || invoice.livemode === false) return "bad";
  if (typeof invoice.id === "string" && invoice.id !== id) return "bad";
  const paymentIntentId = idOf(invoice.payment_intent);
  if (paymentIntentId) {
    const fact = await factFromIntent(gateway, paymentIntentId, timeout);
    if (fact === "bad") return "bad";
    return { ...fact, forId: id, invoiceId: id };
  }
  const chargeId = idOf(invoice.charge);
  if (chargeId) {
    const charge = await retrieveCharge(gateway, chargeId, timeout);
    if (charge === "bad") return "bad";
    if (charge) return factFromCharge(id, { ...charge, invoiceId: charge.invoiceId ?? id });
  }
  const status = typeof invoice.status === "string" ? invoice.status : null;
  if (status === "paid") {
    const captured = integerCents(invoice.amount_paid);
    if (captured == null) return "bad";
    return {
      forId: id,
      paymentIntentId: null,
      invoiceId: id,
      chargeId: null,
      customerId: idOf(invoice.customer),
      capturedCents: captured,
      refundedCents: 0,
      currency: text(invoice.currency),
      outcome: "succeeded",
      status,
    };
  }
  if (status === "void" || status === "uncollectible" || status === "open") {
    return {
      forId: id,
      paymentIntentId: null,
      invoiceId: id,
      chargeId: null,
      customerId: idOf(invoice.customer),
      capturedCents: integerCents(invoice.amount_paid),
      refundedCents: 0,
      currency: text(invoice.currency),
      outcome: "failed",
      status: status === "open" ? "pending" : "failed",
    };
  }
  return missingFact(id);
}

async function chargeForIntent(gateway: RentStripeGateway, intent: RawIntent, timeout: () => number): Promise<ListedCharge | null | "bad"> {
  const latest = intent.latest_charge;
  if (latest == null || latest === "") return null;
  if (typeof latest === "string") return retrieveCharge(gateway, latest, timeout);
  if (typeof latest === "object") {
    const charge = mapCharge(latest as RawCharge);
    return charge ?? "bad";
  }
  return "bad";
}

async function retrieveCharge(gateway: RentStripeGateway, id: string, timeout: () => number): Promise<ListedCharge | null | "bad"> {
  try {
    const raw = await gateway.charges.retrieve(id, {}, { timeout: timeout() });
    if (!raw || typeof raw !== "object" || raw.livemode === false) return "bad";
    if (typeof raw.id === "string" && raw.id !== id) return "bad";
    return mapCharge(raw) ?? "bad";
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function factFromCharge(forId: string, charge: ListedCharge): StripeRentFact {
  const outcome = charge.succeeded ? "succeeded" : charge.failed ? "failed" : "missing";
  return {
    forId,
    paymentIntentId: charge.paymentIntentId,
    invoiceId: charge.invoiceId,
    chargeId: charge.id,
    customerId: charge.customerId,
    capturedCents: charge.capturedCents,
    refundedCents: charge.refundedCents,
    currency: charge.currency,
    outcome,
    status: charge.status,
  };
}

function missingFact(forId: string): StripeRentFact {
  return {
    forId,
    paymentIntentId: null,
    invoiceId: null,
    chargeId: null,
    customerId: null,
    capturedCents: null,
    refundedCents: null,
    currency: null,
    outcome: "missing",
    status: null,
  };
}

function mapCharge(row: RawCharge): ListedCharge | null {
  if (row.livemode === false || typeof row.id !== "string" || !row.id) return null;
  const status = typeof row.status === "string" ? row.status : "";
  if (!status) return null;
  const succeeded = status === "succeeded";
  const failed = status === "failed";
  const captured = integerCents(row.amount_captured ?? row.amount);
  const refunded = integerCents(row.amount_refunded ?? 0);
  if (succeeded && (captured == null || refunded == null)) return null;
  const currency = text(row.currency);
  if (succeeded && !currency) return null;
  return {
    id: row.id,
    paymentIntentId: idOf(row.payment_intent),
    invoiceId: idOf(row.invoice),
    customerId: idOf(row.customer),
    capturedCents: captured,
    refundedCents: refunded,
    currency,
    succeeded,
    failed,
    status,
  };
}

function uniqueCharges(charges: ListedCharge[]): ListedCharge[] {
  const seen = new Map<string, ListedCharge>();
  for (const charge of charges) seen.set(charge.id, charge);
  return [...seen.values()];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim()))];
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    const id = (value as { id: string }).id.trim();
    return id || null;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { statusCode?: unknown; status?: unknown; code?: unknown };
  return row.statusCode === 404 || row.status === 404 || row.code === "resource_missing";
}
