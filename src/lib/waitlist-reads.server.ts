// Read-only, complete reads for Waitlist summaries. Never substitute [] for
// an error: an unreadable active rental must not become an available car.
const PAGE = 200;
const MAX_ROWS = 100_000;
type PageResult = { data: any[] | null; error: unknown; count: number | null };
export async function completeRead(query: (from: number, to: number) => PromiseLike<PageResult>): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    const page = await query(rows.length, rows.length + PAGE - 1);
    if (page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count! < 0 || page.count! > MAX_ROWS) {
      throw new Error("Waitlist data unavailable. Please retry.");
    }
    if (total !== undefined && total !== page.count) throw new Error("Waitlist data changed. Please retry.");
    total = page.count!;
    if (page.data.length === 0 && rows.length < total) throw new Error("Waitlist data incomplete. Please retry.");
    for (const row of page.data) {
      if (typeof row.id !== "string" || seen.has(row.id)) throw new Error("Waitlist data changed. Please retry.");
      seen.add(row.id); rows.push(row);
    }
    if (rows.length > total) throw new Error("Waitlist data changed. Please retry.");
  } while (rows.length < total!);
  return rows;
}
export async function readInBatches(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<PageResult>): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 50) rows.push(...await completeRead((from, to) => query(ids.slice(i, i + 50), from, to)));
  return rows;
}
