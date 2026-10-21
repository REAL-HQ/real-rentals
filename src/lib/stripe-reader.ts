/**
 * List/retrieve pagination shared by every Stripe reader.
 * No Stripe SDK import: the client and cache live in stripe-reader.server.ts.
 */

export const STRIPE_READER_PAGE_SIZE = 100;
export const STRIPE_READER_MAX_PAGES = 100;
export const STRIPE_READER_TTL_MS = 60_000;
export const STRIPE_READER_TIMEOUT_MS = 20_000;
export const STRIPE_TEMPORARILY_UNAVAILABLE = "Stripe temporarily unavailable";

export class StripeTemporarilyUnavailable extends Error {
  constructor() {
    super(STRIPE_TEMPORARILY_UNAVAILABLE);
    this.name = "StripeTemporarilyUnavailable";
  }
}

export function isStripeTemporarilyUnavailable(error: unknown): boolean {
  if (error instanceof StripeTemporarilyUnavailable) return true;
  if (!error || typeof error !== "object") return false;
  const row = error as { statusCode?: unknown; status?: unknown; type?: unknown; code?: unknown; name?: unknown };
  const status = row.statusCode ?? row.status;
  if (status === 429) return true;
  if (row.type === "StripeRateLimitError" || row.code === "rate_limit") return true;
  if (row.type === "StripeConnectionError") return true;
  if (row.name === "AbortError" || row.name === "TimeoutError") return true;
  if (
    row.code === "ETIMEDOUT" ||
    row.code === "ECONNABORTED" ||
    row.code === "ECONNRESET" ||
    row.code === "UND_ERR_CONNECT_TIMEOUT" ||
    row.code === "UND_ERR_HEADERS_TIMEOUT" ||
    row.code === "UND_ERR_BODY_TIMEOUT"
  ) return true;
  return false;
}

/** 429 and timeouts are one sentence. Any other failure stays the caller's incomplete-evidence reason. */
export function stripeReadFailureReason(error: unknown): string {
  return isStripeTemporarilyUnavailable(error) ? STRIPE_TEMPORARILY_UNAVAILABLE : "Stripe evidence was incomplete or timed out";
}

export type StripePage<T> = { data: T[]; has_more: boolean };

/**
 * Walk a list until it ends. The page cap is logged and refuses a partial total.
 * A rate limit or a timeout throws StripeTemporarilyUnavailable instead of a raw provider error.
 */
export async function paginateStripeList<T, R = T>(
  read: (cursor?: string) => Promise<StripePage<T>>,
  options: {
    label: string;
    maxPages?: number;
    signal?: AbortSignal;
    deadline?: number;
    now?: () => number;
    map?: (row: T) => R | null;
    dedupe?: boolean;
    strict?: boolean;
  },
): Promise<{ ok: true; rows: R[] } | { ok: false; reason: "capped" | "stalled" | "malformed" }> {
  const maxPages = options.maxPages ?? STRIPE_READER_MAX_PAGES;
  const now = options.now ?? Date.now;
  const map = options.map ?? ((row: T) => row as unknown as R);
  const rows: R[] = [];
  const seen = new Map<string, R>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    if (options.deadline !== undefined && now() >= options.deadline) throw new StripeTemporarilyUnavailable();
    options.signal?.throwIfAborted();
    let result: StripePage<T>;
    try {
      result = await read(cursor);
    } catch (error) {
      if (isStripeTemporarilyUnavailable(error)) throw new StripeTemporarilyUnavailable();
      throw error;
    }
    if (options.strict && (!result || !Array.isArray(result.data) || typeof result.has_more !== "boolean")) {
      return { ok: false, reason: "malformed" };
    }
    if (!result || !Array.isArray(result.data)) throw new Error("Stripe pagination incomplete");
    for (const row of result.data) {
      if (options.dedupe) {
        seen.set((row as { id: string }).id, row as unknown as R);
        continue;
      }
      const mapped = map(row);
      if (mapped === null || mapped === undefined) return { ok: false, reason: "malformed" };
      rows.push(mapped);
    }
    if (!result.has_more) return { ok: true, rows: options.dedupe ? [...seen.values()] : rows };
    const last = result.data.at(-1) as { id?: unknown } | undefined;
    const next = typeof last?.id === "string" ? last.id : "";
    if (!next || next === cursor) return { ok: false, reason: "stalled" };
    cursor = next;
  }
  console.warn(`Stripe reader page cap reached (${maxPages}) for ${options.label}`);
  return { ok: false, reason: "capped" };
}
