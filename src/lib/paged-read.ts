/**
 * PostgREST returns at most 1000 rows unless the caller pages with .range.
 * A short page whose count is larger, a missing count, or an error is an
 * incomplete read. Callers must show Unavailable rather than sum a prefix.
 */
export const READ_PAGE_SIZE = 1000;
export const READ_PAGE_CAP = 50;

export type PageBatch<T> = { data: T[] | null; error: unknown; count: number | null };

export async function readEveryPage<T>(
  read: (from: number, to: number) => PromiseLike<PageBatch<T>>,
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let page = 0; page < READ_PAGE_CAP; page++) {
    const from = page * READ_PAGE_SIZE;
    const result = await read(from, from + READ_PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) return { rows, complete: false };
    if (page === 0) {
      if (!Number.isSafeInteger(result.count) || (result.count as number) < 0) return { rows: result.data, complete: false };
      expected = result.count as number;
    }
    rows.push(...result.data);
    if (expected === null || rows.length > expected) return { rows, complete: false };
    if (result.data.length < READ_PAGE_SIZE || rows.length === expected) {
      return { rows, complete: rows.length === expected };
    }
  }
  return { rows, complete: rows.length === expected };
}
