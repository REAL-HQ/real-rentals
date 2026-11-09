/**
 * Count-checked pages.
 *
 * A bare `.limit(1001)` is not an overflow signal: hosted PostgREST can clamp
 * a response at 1000 and the caller then treats a short page as the whole
 * table. Each page asks for `count: "exact"` and the next page is not trusted
 * unless that count stays put. This mirrors the waitlist reader, and it
 * returns a failure instead of throwing so a checklist can tell an error from
 * a cap.
 */
export const COUNTED_PAGE = 200;
export const COUNTED_MAX = 100_000;
export const COUNTED_ID_BATCH = 100;

export type CountedPage = {
  data: unknown[] | null;
  error: unknown;
  count: number | null;
};

export type CountedRead =
  | { ok: true; rows: Record<string, unknown>[]; total: number; truncated: boolean }
  | { ok: false };

function badCount(count: number | null | undefined): boolean {
  return !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > COUNTED_MAX;
}

export async function readCounted(
  query: (from: number, to: number) => PromiseLike<CountedPage>,
  cap = COUNTED_MAX,
): Promise<CountedRead> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  const stop = Math.min(cap, COUNTED_MAX);
  do {
    const room = stop - rows.length;
    if (room <= 0) break;
    const size = Math.min(COUNTED_PAGE, room);
    const from = rows.length;
    const to = from + size - 1;
    let page: CountedPage;
    try {
      page = await query(from, to);
    } catch {
      return { ok: false };
    }
    if (page.error || !Array.isArray(page.data) || badCount(page.count)) return { ok: false };
    if (total !== undefined && total !== page.count) return { ok: false };
    total = page.count as number;
    const expect = Math.min(total, stop);
    if (page.data.length === 0 && rows.length < expect) return { ok: false };
    for (const row of page.data) {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string" || seen.has(id)) return { ok: false };
      seen.add(id);
      rows.push(row as Record<string, unknown>);
    }
    if (rows.length > total) return { ok: false };
  } while (total !== undefined && rows.length < total && rows.length < stop);
  if (total === undefined) return { ok: false };
  return { ok: true, rows, total, truncated: total > stop };
}

/** Page each batch of ids to completion. One global 1000-row ceiling is not a batch. */
export async function readInIdBatches(
  ids: readonly string[],
  query: (ids: string[], from: number, to: number) => PromiseLike<CountedPage>,
  batchSize = COUNTED_ID_BATCH,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false }> {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const chunk = ids.slice(index, index + batchSize);
    if (chunk.length === 0) continue;
    const read = await readCounted((from, to) => query(chunk, from, to));
    if (!read.ok || read.truncated) return { ok: false };
    rows.push(...read.rows);
  }
  return { ok: true, rows };
}
