/**
 * An in-memory stand-in for the Supabase client, good enough to run the REAL
 * server modules under test.
 *
 * This file is never imported by the app. Tests read its text and write it
 * into their build directory so esbuild inlines it in place of
 * "@/integrations/supabase/client.server". esbuild inlines each stub copy, so
 * every piece of state lives on globalThis — a module-level `export const db`
 * would hand the test one object and the bundled code another, and refusals
 * that had simply found nothing would pass as if they had been refused.
 *
 * Supported: select / insert / update / delete / upsert, chained with
 * eq, neq, ilike, in, is, or, gte, lte, order, limit, range, single,
 * maybeSingle, and select(..., { count, head }). Plus storage.from().download().
 */
const S = (globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} });

const rows = (t) => (S.tables[t] ??= []);
const clone = (r) => JSON.parse(JSON.stringify(r));
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
});

/** Supabase's `.or("a.is.null,a.eq.")` mini-language — only the forms the app uses. */
function matchOr(row, expr) {
  return String(expr).split(",").some((clause) => {
    const [field, op, ...rest] = clause.split(".");
    const want = rest.join(".");
    const v = row[field];
    if (op === "is") return want === "null" ? v == null : v === want;
    if (op === "eq") return want === "" ? v === "" : String(v) === want;
    return false;
  });
}

class Query {
  constructor(table, kind, payload, opts = {}) {
    this.table = table; this.kind = kind; this.payload = payload;
    this.filters = []; this.orders = []; this.limitN = null;
    this.rangeFrom = null; this.rangeTo = null; this.total = null;
    this.count = opts.count ?? null; this.head = opts.head ?? false;
  }
  // PostgREST lets a filter address inside a json column: value->>version.
  // The compare-and-swap that enforces the photo-reading limit depends on it,
  // so the fake has to understand it too or the test proves nothing.
  eq(f, v) {
    const [col, key] = String(f).split("->>");
    this.filters.push((r) => String(key ? (r[col] ?? {})[key] : r[f]) === String(v));
    return this;
  }
  neq(f, v) { this.filters.push((r) => String(r[f]) !== String(v)); return this; }
  /**
   * ilike is a case-insensitive LIKE, not a case-insensitive equals: % and _
   * are wildcards. The duplicate-plate check hands a plate straight to it, so
   * a fake that compared strings would hide the reason a plate's characters
   * are validated at all — a plate of "%" matches every car in the fleet.
   */
  ilike(f, pat) {
    const rx = new RegExp(
      `^${String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`,
      "i",
    );
    this.filters.push((r) => r[f] != null && rx.test(String(r[f])));
    return this;
  }
  in(f, vs) { this.filters.push((r) => vs.map(String).includes(String(r[f]))); return this; }
  is(f, v) { this.filters.push((r) => (v === null ? r[f] == null : r[f] === v)); return this; }
  or(expr) { this.filters.push((r) => matchOr(r, expr)); return this; }
  gte(f, v) { this.filters.push((r) => String(r[f]) >= String(v)); return this; }
  lte(f, v) { this.filters.push((r) => String(r[f]) <= String(v)); return this; }
  order(f, o = {}) { this.orders.push([f, o.ascending !== false]); return this; }
  limit(n) { this.limitN = n; return this; }
  /**
   * One page, PostgREST's inclusive from–to. `count: "exact"` still reports
   * the TOTAL that matched, not the size of the page — a fake that counted
   * the slice would make a paginated list claim one page was the whole fleet.
   */
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  select(_cols, opts = {}) {
    this.selected = true;
    if (opts.count) this.count = opts.count;
    if (opts.head) this.head = true;
    return this;
  }
  _matching() {
    let out = rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    for (const [f, asc] of [...this.orders].reverse()) {
      out = out.slice().sort((a, b) => {
        const x = a[f] ?? "", y = b[f] ?? "";
        return x === y ? 0 : (x < y ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    this.total = out.length;
    if (this.limitN != null) out = out.slice(0, this.limitN);
    if (this.rangeFrom != null) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1);
    return out;
  }
  _run() {
    const t = this.table;
    if (this.kind === "select") {
      const m = this._matching();
      return { data: this.head ? null : m.map(clone), error: null, count: this.total ?? m.length };
    }
    if (this.kind === "insert") {
      // Lets a test make one table refuse writes, to exercise the paths that
      // have to undo work — releasing a reserved slot, for instance.
      if (S.failInsert === t) return { data: null, error: { message: `insert into ${t} refused` } };
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      // Column defaults matter: fleet_import_proposals.status defaults to
      // 'pending' in Postgres and the insert never names it, so a fake without
      // defaults leaves it undefined and every later `.eq("status","pending")`
      // finds nothing — which reads as "the guard worked" when in fact nothing ran.
      const made = list.map((p) => {
        const r = { id: p.id ?? uuid(), created_at: new Date().toISOString(), ...(S.defaults?.[t] ?? {}), ...p };
        rows(t).push(r);
        S.log.push({ op: "insert", table: t, row: clone(r) });
        return clone(r);
      });
      return { data: Array.isArray(this.payload) ? made : made[0], error: null };
    }
    if (this.kind === "upsert") {
      const p = this.payload;
      const i = rows(t).findIndex((r) => r.key === p.key || r.id === p.id);
      if (i >= 0) rows(t)[i] = { ...rows(t)[i], ...p }; else rows(t).push({ id: p.id ?? uuid(), ...p });
      S.log.push({ op: "upsert", table: t, row: clone(p) });
      return { data: clone(p), error: null };
    }
    if (this.kind === "update") {
      const m = this._matching();
      for (const r of m) { Object.assign(r, this.payload); S.log.push({ op: "update", table: t, row: clone(r), patch: clone(this.payload) }); }
      return { data: m.map(clone), error: null };
    }
    if (this.kind === "delete") {
      const m = this._matching();
      S.tables[t] = rows(t).filter((r) => !m.includes(r));
      for (const r of m) S.log.push({ op: "delete", table: t, row: clone(r) });
      return { data: m.map(clone), error: null };
    }
    return { data: null, error: null };
  }
  /**
   * A test can hold every read of one table until it chooses to release them.
   * Without this, "concurrent" callers in a single-threaded runtime simply
   * take turns, each seeing the previous one's write — so a compare-and-swap
   * test passes just as well with the compare removed. S.gate makes the race
   * real: everyone reads the same stale row, then they all try to write.
   */
  async _gate() {
    if (S.gateTable === this.table && S.gate) await S.gate;
  }
  async single() { await this._gate(); const r = this._run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d ?? null, error: d ? null : { message: "no rows" }, count: r.count }; }
  async maybeSingle() { await this._gate(); const r = this._run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return { data: d ?? null, error: null, count: r.count }; }
  then(res, rej) { return this._gate().then(() => this._run()).then(res, rej); }
}

const table = (name) => ({
  select: (cols, opts = {}) => new Query(name, "select", null, opts).select(cols, opts),
  insert: (p) => new Query(name, "insert", p),
  update: (p) => new Query(name, "update", p),
  upsert: (p) => new Query(name, "upsert", p),
  delete: () => new Query(name, "delete", null),
});

export const supabaseAdmin = {
  from: table,
  storage: {
    from: (bucket) => ({
      download: async (path) => {
        const key = `${bucket}/${path}`;
        const bytes = S.files[key];
        if (!bytes) return { data: null, error: { message: "not found" } };
        return {
          data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer, type: S.mime?.[key] ?? "image/jpeg" },
          error: null,
        };
      },
      remove: async (paths) => { for (const p of paths) delete S.files[`${bucket}/${p}`]; return { data: null, error: null }; },
      upload: async (path, body) => { S.files[`${bucket}/${path}`] = [...(body ?? [])]; return { data: { path }, error: null }; },
    }),
  },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
