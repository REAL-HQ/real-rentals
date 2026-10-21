import { collectSourcePages } from "./unified-finance-db-readers.server";
import { mapFinanceSource } from "./unified-finance-live-mapping";
import { requireSourceActor, type ProviderRow, type SourceActor, type SourcePageReader, type SourceScope } from "./unified-finance-source-contracts";
import type { SourceSnapshot } from "./unified-finance-contract";

/** Injection-only; no production provider/key/client or network activation path. */
export async function readIsolatedProvider(read: SourcePageReader<ProviderRow>, actor: SourceActor, scope: SourceScope, signal?: AbortSignal): Promise<SourceSnapshot> {
  requireSourceActor(actor);
  if (scope.environment !== "synthetic" || !scope.account.trim()) throw new Error("Only synthetic providers are supported");
  const raw = await collectSourcePages(read, signal);
  if (!raw.complete) return { rows: [], coverage: { state: raw.pages ? "incomplete" : "unavailable", reasons: raw.reasons, pages: raw.pages } };
  const mapped = raw.rows.map(r => mapFinanceSource("stripe", r, scope));
  const reasons = mapped.flatMap(r => r.reasons);
  return { rows: mapped.flatMap(r => r.row ? [r.row] : []), coverage: { state: reasons.length ? "incomplete" : "complete", reasons, pages: raw.pages } };
}