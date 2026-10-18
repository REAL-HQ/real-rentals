import { requireSourceActor, type AuthenticatedReadClient, type MappedSource, type RawSources, type SourceActor, type SourcePageReader } from "./unified-finance-source-contracts";
import type { FinanceSource, SourceSnapshot } from "./unified-finance-contract";
import { mapFinanceSource, mapLedgerBatch } from "./unified-finance-live-mapping";

/** Test-injected authenticated RLS boundary. No generated client import or fallback. */
export async function readIsolatedDatabaseSource<S extends Exclude<FinanceSource, "stripe">>(client: AuthenticatedReadClient, actor: SourceActor, source: S, signal?: AbortSignal): Promise<SourceSnapshot> {
  if (!actor.userId || actor.userId !== client.userId || client.authorization !== "authenticated_rls") throw new Error("Forbidden");
  const tier = requireSourceActor({ userId: actor.userId, roles: await client.readCurrentRoles(actor.userId) });
  const read: SourcePageReader<RawSources[S]> = (cursor, abort) => client.readPage(source, cursor, abort);
  const raw = await collectSourcePages(read, signal);
  signal?.throwIfAborted();
  const currentTier = requireSourceActor({ userId: actor.userId, roles: await client.readCurrentRoles(actor.userId) });
  if (currentTier !== tier) throw new Error("Authorization changed during source read");
  if (!raw.complete) return { rows: [], coverage: { state: raw.pages ? "incomplete" : "unavailable", reasons: raw.reasons, pages: raw.pages } };
  // Owner facts never enter mapping, diagnostics, or returned DTOs for Managers.
  const visible = raw.rows.filter(r => r.visibility === "operating" || (tier === "owner" && r.visibility === "owner_only"));
  let mapped: MappedSource[];
  try { mapped = source === "ledger" ? mapLedgerBatch(visible as RawSources["ledger"][]) : visible.map(r => mapFinanceSource(source, r)); }
  catch { return { rows: [], coverage: { state: "incomplete", reasons: ["Malformed source facts"], pages: raw.pages } }; }
  const reasons = mapped.flatMap(r => r.reasons);
  return { rows: mapped.flatMap(r => r.row ? [r.row] : []), coverage: { state: reasons.length ? "incomplete" : "complete", reasons, pages: raw.pages } };
}
export async function collectSourcePages<T extends { id: string }>(read: SourcePageReader<T>, signal?: AbortSignal): Promise<{ rows: T[]; complete: boolean; reasons: string[]; pages: number }> {
  const rows = new Map<string, T>(); const cursors = new Set<string>(); let cursor: string | null = null; let pages = 0;
  try {
    for (; pages < 100;) {
      signal?.throwIfAborted(); const page = await read(cursor, signal); signal?.throwIfAborted(); pages++;
      if (!page.complete) throw new Error("Reader did not attest complete page");
      for (const row of page.rows) {
        if (!row.id.trim()) throw new Error("Missing source row identity");
        const old = rows.get(row.id);
        if (old && JSON.stringify(old) !== JSON.stringify(row)) throw new Error("Conflicting page overlap");
        rows.set(row.id, row);
      }
      if (page.nextCursor === null) return { rows: [...rows.values()], complete: true, reasons: [], pages };
      if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error("Invalid or repeated page cursor");
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
  } catch { return { rows: [], complete: false, reasons: ["Source coverage unavailable or inconsistent"], pages }; }
  return { rows: [], complete: false, reasons: ["Source page limit exceeded"], pages };
}