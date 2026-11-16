// Tiny in-memory stand-in for the Supabase query builder, shared by the FLEET
// autonomy tests (status, lifecycle events, handoff, resend links).
export type Row = Record<string, any>;
export function fakeDb(seed: Record<string, Row[]>, opts: { unique?: Record<string, string>; missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique = opts.unique ?? {};
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null;
    let order: { c: string; asc: boolean } | null = null;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      delete: () => { op = "delete"; return q; },
      upsert: (r: Row, o: any) => { op = o?.ignoreDuplicates ? "insert_ignore" : "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gt: (c: string, v: any) => { f.push((r) => r[c] != null && String(r[c]) > String(v)); return q; },
      gte: (c: string, v: any) => { f.push((r) => r[c] != null && String(r[c]) >= String(v)); return q; },
      lt: (c: string, v: any) => { f.push((r) => r[c] != null && String(r[c]) < String(v)); return q; },
      lte: (c: string, v: any) => { f.push((r) => r[c] != null && String(r[c]) <= String(v)); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      not: (c: string, o: string, v: string) => {
        if (o === "in") { const list = v.replace(/^\(|\)$/g, "").split(","); f.push((r) => !list.includes(String(r[c]))); }
        else if (o === "is") f.push((r) => (r[c] ?? null) !== null);
        return q;
      },
      order: (c: string, o?: any) => { order = { c, asc: o?.ascending !== false }; return q; },
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert" || op === "insert_ignore") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: r.id ?? `${table}-${n++}`, created_at: r.created_at ?? new Date().toISOString(), ...r }));
        const out: Row[] = [];
        for (const r of list) {
          const u = unique[table];
          if (u && rows.some((x) => x[u] != null && x[u] === r[u])) {
            if (op === "insert_ignore") continue;
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          rows.push(r); out.push(r);
        }
        return { data: single ? out[0] ?? null : out, error: null };
      }
      let hit = rows.filter((r) => f.every((fn) => fn(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null }; }
      if (op === "delete") { state[table] = rows.filter((r) => !hit.includes(r)); return { data: hit, error: null }; }
      if (order) { const o = order; hit = [...hit].sort((a, b) => (String(a[o.c] ?? "") < String(b[o.c] ?? "") ? -1 : 1) * (o.asc ? 1 : -1)); }
      if (lim != null) hit = hit.slice(0, lim);
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state, rpc: async () => ({ data: null, error: { message: "no rpc in fake" } }) };
}

export const KEY = "test-fleet-key-0123456789";
export function req(body: unknown, key: string | null = KEY, method = "POST") {
  return new Request("https://drivereal.com/api/public/fleet/x", {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}
