import {
  customerIdOf,
  customerSuffix,
  easternDay,
  invoiceIsLinked,
  subscriptionIdOf,
  unmatchedWindow,
  type LocalLink,
} from "./stripe-unmatched";

/** Stripe list page. One extra is not requested; has_more is the cap signal. */
export const INVOICE_PAGE = 100;
export const INVOICE_MAX_PAGES = 10;
/** Local directory page. Callers ask for one extra row and do not keep it. */
export const DIRECTORY_PAGE = 200;
export const DIRECTORY_MAX_PAGES = 20;

export type UnmatchedRow = {
  invoiceId: string;
  subscriptionId: string | null;
  customerSuffix: string;
  amountCents: number | null;
  paidOn: string | null;
};

export type UnmatchedReport =
  | { status: "unavailable"; reason: string; rows: []; truncated: false }
  | { status: "ready"; rows: UnmatchedRow[]; truncated: boolean; truncatedBecause: "invoices" | "directory" | null };

type PageResult = { data: unknown[] | null; error: { message?: string } | null; count: number | null };
type Db = { from: (table: string) => any };
type InvoiceList = {
  invoices: {
    list: (query: Record<string, unknown>) => Promise<{ data: unknown[]; has_more: boolean }>;
  };
};

type InvoiceRow = {
  id?: string;
  status?: string;
  amount_paid?: number;
  created?: number;
  status_transitions?: { paid_at?: number | null };
  subscription?: unknown;
  customer?: unknown;
  parent?: { subscription_details?: { subscription?: unknown } } | null;
};

export async function loadUnmatchedStripePayments(db: Db, stripe: InvoiceList, now = new Date()): Promise<UnmatchedReport> {
  const window = unmatchedWindow(now);
  if (!window) return { status: "unavailable", reason: "The Date Window Could Not Be Read", rows: [], truncated: false };
  let invoices: { rows: InvoiceRow[]; truncated: boolean } | null;
  try {
    invoices = await listPaidInvoices(stripe, window);
  } catch {
    return { status: "unavailable", reason: "Stripe Could Not Be Read", rows: [], truncated: false };
  }
  if (!invoices) return { status: "unavailable", reason: "Stripe Could Not Be Read", rows: [], truncated: false };
  const rentals = await readDirectory(db, "rentals", "id,stripe_subscription_id,stripe_customer_id");
  if (!rentals) return { status: "unavailable", reason: "The Rental Read Did Not Complete", rows: [], truncated: false };
  const applications = await readDirectory(db, "applications", "id,stripe_customer_id");
  if (!applications) return { status: "unavailable", reason: "The Application Read Did Not Complete", rows: [], truncated: false };
  if (rentals.truncated || applications.truncated) {
    return { status: "ready", rows: [], truncated: true, truncatedBecause: "directory" };
  }
  const rentalLinks = rentals.rows.map(rentalLink);
  const applicationLinks = applications.rows.map(applicationLink);
  const rows = invoices.rows
    .filter((invoice) => invoice.status === "paid" && typeof invoice.id === "string")
    .map((invoice) => ({
      invoice,
      link: {
        subscriptionId: subscriptionIdOf(invoice),
        customerId: customerIdOf(invoice),
      },
    }))
    .filter((row) => !invoiceIsLinked(row.link, rentalLinks, applicationLinks))
    .map((row) => toRow(row.invoice, row.link.subscriptionId, row.link.customerId))
    .sort((a, b) => {
      const dayA = a.paidOn ?? "";
      const dayB = b.paidOn ?? "";
      if (dayA !== dayB) return dayA < dayB ? 1 : -1;
      return a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0;
    });
  return {
    status: "ready",
    rows,
    truncated: invoices.truncated,
    truncatedBecause: invoices.truncated ? "invoices" : null,
  };
}

function rentalLink(row: Record<string, unknown>): LocalLink {
  return {
    subscriptionId: row.stripe_subscription_id == null ? null : String(row.stripe_subscription_id),
    customerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id),
  };
}

function applicationLink(row: Record<string, unknown>): LocalLink {
  return { customerId: row.stripe_customer_id == null ? null : String(row.stripe_customer_id) };
}

function toRow(invoice: InvoiceRow, subscriptionId: string | null, customerId: string | null): UnmatchedRow {
  const amount = invoice.amount_paid;
  const stamp = invoice.status_transitions?.paid_at ?? invoice.created;
  const paidOn = typeof stamp === "number" && Number.isFinite(stamp) ? easternDay(new Date(stamp * 1000)) : "";
  return {
    invoiceId: String(invoice.id),
    subscriptionId,
    customerSuffix: customerSuffix(customerId),
    amountCents: typeof amount === "number" && Number.isSafeInteger(amount) ? amount : null,
    paidOn: paidOn || null,
  };
}

async function listPaidInvoices(
  stripe: InvoiceList,
  window: { gte: number; lt: number },
): Promise<{ rows: InvoiceRow[]; truncated: boolean } | null> {
  const rows: InvoiceRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < INVOICE_MAX_PAGES; page++) {
    const result = await stripe.invoices.list({
      status: "paid",
      created: { gte: window.gte, lt: window.lt },
      limit: INVOICE_PAGE,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (!result || !Array.isArray(result.data) || typeof result.has_more !== "boolean") return null;
    for (const row of result.data) {
      const invoice = row as InvoiceRow;
      if (!invoice || typeof invoice.id !== "string" || !invoice.id) return null;
      if (rows.some((existing) => existing.id === invoice.id)) return null;
      rows.push(invoice);
    }
    if (!result.has_more) return { rows, truncated: false };
    const next = (result.data.at(-1) as InvoiceRow | undefined)?.id;
    if (!next || next === cursor) return null;
    cursor = next;
  }
  return { rows, truncated: true };
}

export async function readDirectory(
  db: Db,
  table: string,
  columns: string,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean } | null> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let expected: number | null = null;
  for (let page = 0; page < DIRECTORY_MAX_PAGES; page++) {
    let query = db.from(table).select(columns, { count: "exact" }).order("id");
    if (cursor) query = query.gt("id", cursor);
    const result = (await query.limit(DIRECTORY_PAGE + 1)) as PageResult;
    if (!result || result.error || !Array.isArray(result.data)) return null;
    if (page === 0) {
      if (typeof result.count !== "number" || !Number.isInteger(result.count) || result.count < 0) return null;
      expected = result.count;
    }
    if (result.data.length > DIRECTORY_PAGE + 1) return null;
    const extra = result.data.length === DIRECTORY_PAGE + 1;
    const chunk = (extra ? result.data.slice(0, DIRECTORY_PAGE) : result.data) as Record<string, unknown>[];
    for (const row of chunk) {
      const id = typeof row?.id === "string" ? row.id : "";
      if (!id || (cursor != null && id <= cursor)) return null;
      rows.push(row);
      cursor = id;
    }
    if (extra) {
      const probe = result.data[DIRECTORY_PAGE] as Record<string, unknown> | undefined;
      const extraId = typeof probe?.id === "string" ? probe.id : "";
      if (!extraId || (cursor != null && extraId <= cursor)) return null;
      continue;
    }
    if (rows.length !== expected) return null;
    return { rows, truncated: false };
  }
  if (expected == null || !(expected > rows.length)) return null;
  return { rows, truncated: true };
}
