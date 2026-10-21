/** Shared limits for read-only Stripe calls. No writes live here. */

export const STRIPE_READER_TIMEOUT_MS = 20_000;
export const STRIPE_READER_TTL_MS = 60_000;
export const STRIPE_TEMPORARILY_UNAVAILABLE = "Stripe temporarily unavailable";

export class StripeTemporarilyUnavailable extends Error {
  constructor() {
    super(STRIPE_TEMPORARILY_UNAVAILABLE);
    this.name = "StripeTemporarilyUnavailable";
  }
}

export function isStripeTemporarilyUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: unknown; code?: unknown; type?: unknown; message?: unknown };
  if (candidate.statusCode === 429 || candidate.type === "StripeRateLimitError") return true;
  if (candidate.code === "ETIMEDOUT" || candidate.type === "StripeConnectionError") return true;
  return typeof candidate.message === "string" && candidate.message.toLowerCase().includes("timeout");
}
