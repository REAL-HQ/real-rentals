/**
 * Overview Revenue card: what number it shows.
 *
 * The card's floor is the payments recorded in our own database for the
 * range. Stripe consolidation is an optional refinement on top: when Stripe
 * verifies, the card shows the verified figure; when Stripe is slow, errors
 * or reports an incomplete period, the card keeps showing the recorded total.
 * A range with no payments is $0. The card never says "Unavailable".
 */

export type RecordedRevenueRow = {
  net_collected: unknown;
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
  failure_reason?: string | null;
};

export type RecordedRevenueRead = {
  data: RecordedRevenueRow[] | null;
  error: unknown;
  count?: number | null;
};

function money(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum of recorded money received for the display floor.
 *
 * Deliberately tolerant, unlike paymentRevenue() (which feeds the strict
 * Stripe consolidation and fails closed): one odd row or a missing row count
 * must not blank the whole card. Only a failed read returns null.
 */
export function recordedRevenueTotal(result: RecordedRevenueRead): number | null {
  if (!result || result.error || !Array.isArray(result.data)) return null;
  let total = 0;
  for (const row of result.data) total += money(row?.net_collected);
  return Math.round(total * 100) / 100;
}

export type RevenueCardBadge = "Partial" | "Recorded" | "Loading" | "Couldn't Load";

export type RevenueCardDisplay = {
  /** Dollars to print. Null only while the first read is loading or after every retry failed. */
  amount: number | null;
  badge: RevenueCardBadge;
  /** Where the number came from. */
  source: "stripe" | "recorded" | "none";
};

/**
 * Pick the figure for the card.
 *
 * consolidated: Stripe net plus recorded non-Stripe money, or null/amount null
 *   when Stripe is off, loading, failed or incomplete.
 * recorded: recordedRevenueTotal() for the range, null while loading/failed.
 * recordedFailed: every attempt to read recorded payments failed.
 */
export function revenueCardDisplay(input: {
  consolidated: { amount: number | null } | null;
  recorded: number | null;
  recordedFailed?: boolean;
}): RevenueCardDisplay {
  const c = input.consolidated;
  if (c && typeof c.amount === "number" && Number.isFinite(c.amount)) {
    return { amount: c.amount, badge: "Partial", source: "stripe" };
  }
  if (typeof input.recorded === "number" && Number.isFinite(input.recorded)) {
    return { amount: input.recorded, badge: "Recorded", source: "recorded" };
  }
  return { amount: null, badge: input.recordedFailed ? "Couldn't Load" : "Loading", source: "none" };
}

/** Run a read, retrying failures with a short backoff. Returns the last result. */
export async function readWithRetry<T>(
  read: () => PromiseLike<T>,
  failed: (result: T) => boolean,
  options: { attempts?: number; delayMs?: number; alive?: () => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delay = options.delayMs ?? 800;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await read();
      if (!failed(last)) return last;
    } catch (error) {
      last = { data: null, error, count: null } as unknown as T;
    }
    if (options.alive && !options.alive()) break;
    if (i < attempts - 1) await sleep(delay * (i + 1));
  }
  return last as T;
}
