import type { FinancePageReader, SourceSnapshot } from "./unified-finance-contract";
import { readFinancePages } from "./unified-finance-readers.server";

/** Mock-only provider seam. No Stripe SDK, key, fetch, endpoint or live Collections dependency. */
export async function readMockStripeFinance(reader: FinancePageReader, tier: "owner" | "manager", signal?: AbortSignal): Promise<SourceSnapshot> {
  return readFinancePages(reader, tier, signal);
}