/**
 * Client-side column sorting for admin data tables.
 *
 * Cycle: first click uses firstDir (asc unless a column opts into desc),
 * second click flips, third click clears back to the table's default order.
 * Numbers compare numerically, dates chronologically, text case-insensitively.
 * Blank values (null, empty, "—") always sort last, in either direction.
 *
 * Payments (and any other table that still loads the full list) sort on the
 * client after filters. If a table becomes server-paginated, sort must move
 * to the query or the page will only order the current page.
 */

export type SortDir = "asc" | "desc";
export type SortValueKind = "text" | "number" | "date";
export type ColumnSort<K extends string = string> = { key: K; dir: SortDir };

const BLANK_MARKERS = new Set(["", "—", "–", "-", "—"]);

export function isBlankSortValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (typeof value === "string") return BLANK_MARKERS.has(value.trim());
  return false;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(/[$,]/g, "").trim());
  return Number(value);
}

function dateValue(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const raw = String(value).trim();
  // Date-only ISO stays lexicographic-safe and avoids UTC-midnight shifts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(`${raw}T00:00:00`);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

export function compareSortValues(a: unknown, b: unknown, kind: SortValueKind, dir: SortDir): number {
  const aBlank = isBlankSortValue(a);
  const bBlank = isBlankSortValue(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  let cmp = 0;
  if (kind === "number") {
    cmp = numberValue(a) - numberValue(b);
  } else if (kind === "date") {
    cmp = dateValue(a) - dateValue(b);
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  }
  if (cmp === 0) return 0;
  return dir === "asc" ? (cmp < 0 ? -1 : 1) : cmp < 0 ? 1 : -1;
}

export function cycleColumnSort<K extends string>(
  current: ColumnSort<K> | null,
  key: K,
  firstDir: SortDir = "asc",
): ColumnSort<K> | null {
  if (!current || current.key !== key) return { key, dir: firstDir };
  const flipped: SortDir = firstDir === "asc" ? "desc" : "asc";
  if (current.dir === firstDir) return { key, dir: flipped };
  return null;
}

export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => unknown,
  kind: SortValueKind,
  dir: SortDir,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = compareSortValues(getValue(a.row), getValue(b.row), kind, dir);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function ariaSortValue(active: boolean, dir: SortDir | undefined): "ascending" | "descending" | "none" {
  if (!active || !dir) return "none";
  return dir === "asc" ? "ascending" : "descending";
}
