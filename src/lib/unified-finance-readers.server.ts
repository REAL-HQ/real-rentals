import { FINANCE_SOURCES, type FinancePageReader, type FinanceReadPlan, type FinanceSnapshots, type FinanceSourceRow, type SourceSnapshot } from "./unified-finance-contract";

/** Dependency-injected, read-only pagination. No database client, privileged fallback or live implementation. */
export async function readFinancePages(read: FinancePageReader, tier: "owner" | "manager", signal?: AbortSignal): Promise<SourceSnapshot> {
  const rows = new Map<string, FinanceSourceRow>();
  const cursors = new Set<string>();
  let cursor: string | null = null, pages = 0;
  try {
    for (; pages < 100;) {
      signal?.throwIfAborted();
      const page = await read(cursor, signal); pages++;
      signal?.throwIfAborted();
      for (const row of page.rows) {
        if (row.visibility !== "operating" && row.visibility !== "owner_only") throw new Error("Unknown source visibility");
        if (row.visibility === "owner_only" && tier !== "owner") continue;
        if (!row.id.trim()) throw new Error("Missing source identity");
        const prior = rows.get(row.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error("Conflicting overlapping pages");
        rows.set(row.id, row);
      }
      if (page.nextCursor === null) return { rows: [...rows.values()], coverage: { state: "complete", reasons: [], pages } };
      if (!page.nextCursor.trim() || cursors.has(page.nextCursor)) throw new Error("Pagination did not advance");
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new Error("Pagination limit reached");
  } catch {
    // Do not leak provider errors, partial amounts or source identifiers on failed coverage.
    return { rows: [], coverage: { state: pages ? "incomplete" : "unavailable", reasons: ["Source read incomplete or unavailable"], pages } };
  }
}
export async function readFinanceSnapshots(plan: FinanceReadPlan, tier: "owner" | "manager", signal?: AbortSignal): Promise<FinanceSnapshots> {
  const entries = await Promise.all(FINANCE_SOURCES.map(async source => {
    const reader = plan[source];
    const snapshot: SourceSnapshot = reader ? await readFinancePages(reader, tier, signal) : { rows: [], coverage: { state: "unavailable", reasons: ["No approved reader"], pages: 0 } };
    return [source, snapshot] as const;
  }));
  return Object.fromEntries(entries) as FinanceSnapshots;
}