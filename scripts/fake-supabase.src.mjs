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
 * eq, neq, in, is, or, gte, lte, order, limit, single, maybeSingle, and
 * select(..., { count, head }). Plus storage.from().download().
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
    this.count = opts.count ?? null; this.head = opts.head ?? false;
  }
  eq(f, v) { this.filters.push((r) => String(r[f]) === String(v)); return this; }
  neq(f, v) { this.filters.push((r) => String(r[f]) !== String(v)); return this; }
  in(f, vs) { this.filters.push((r) => vs.map(String).includes(String(r[f]))); return this; }
  is(f, v) { this.filters.push((r) => (v === null ? r[f] == null : r[f] === v)); return this; }
  or(expr) { this.filters.push((r) => matchOr(r, expr)); return this; }
  gte(f, v) { this.filters.push((r) => String(r[f]) >= String(v)); return this; }
  lte(f, v) { this.filters.push((r) => String(r[f]) <= String(v)); return this; }
  order(f, o = {}) { this.orders.push([f, o.ascending !== false]); return this; }
  limit(n) { this.limitN = n; return this; }
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
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }
  _run() {
    const t = this.table;
    if (this.kind === "select") {
      const m = this._matching();
      return { data: this.head ? null : m.map(clone), error: null, count: m.length };
    }
    if (this.kind === "insert") {
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
  single() { const r = this._run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve({ data: d ?? null, error: d ? null : { message: "no rows" }, count: r.count }); }
  maybeSingle() { const r = this._run(); const d = Array.isArray(r.data) ? r.data[0] : r.data; return Promise.resolve({ data: d ?? null, error: null, count: r.count }); }
  then(res, rej) { return Promise.resolve(this._run()).then(res, rej); }
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
