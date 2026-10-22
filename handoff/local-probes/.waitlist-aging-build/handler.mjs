var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/waitlist-aging.ts
function assertWaitlistAgingEnabled() {
  if (WAITLIST_AGING_ENABLED !== true) {
    throw new Error("Waitlist aging is disabled.");
  }
}
function idleWaitlistAging() {
  return { failed: false, truncated: false, cap: WAITLIST_AGING_CAP, groups: [] };
}
function failedWaitlistAging() {
  return { failed: true, truncated: false, cap: WAITLIST_AGING_CAP, groups: [] };
}
var WAITLIST_AGING_ENABLED, WAITLIST_AGING_CAP, NOTIFIED_WINDOW_DAYS, AGING_REFUSED;
var init_waitlist_aging = __esm({
  "src/lib/waitlist-aging.ts"() {
    "use strict";
    WAITLIST_AGING_ENABLED = false;
    WAITLIST_AGING_CAP = 1e3;
    NOTIFIED_WINDOW_DAYS = 7;
    AGING_REFUSED = !WAITLIST_AGING_ENABLED;
  }
});

// src/lib/lead-priorities.ts
function leadToday(now = /* @__PURE__ */ new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  return ["year", "month", "day"].map((k) => p.find((v) => v.type === k).value).join("-");
}
var LEAD_TIME_ZONE;
var init_lead_priorities = __esm({
  "src/lib/lead-priorities.ts"() {
    "use strict";
    LEAD_TIME_ZONE = "America/New_York";
  }
});

// src/lib/waitlist-aging-build.ts
function easternCalendarDay(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = leadToday(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
function easternDayIndex(iso) {
  const day = easternCalendarDay(iso);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  return Date.UTC(year, month - 1, date) / 864e5;
}
function exactMedian(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
function cityGroup(city) {
  if (typeof city !== "string") return { key: "\0", label: null };
  const label = city.trim().replace(/\s+/g, " ");
  if (label.length === 0) return { key: "\0", label: null };
  return { key: label.toLocaleLowerCase("en-US"), label };
}
function notifiedThroughIso(today) {
  const index = easternDayIndex(today.toISOString());
  if (index == null) return today.toISOString();
  const next = new Date((index - NOTIFIED_WINDOW_DAYS + 1) * 864e5);
  const day = next.toISOString().slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  for (const hour of [4, 5, 6]) {
    const instant = new Date(Date.UTC(year, month - 1, date, hour, 0, 0, 0));
    const before = new Date(instant.getTime() - 1);
    if (leadToday(instant) === day && leadToday(before) !== day) {
      return before.toISOString();
    }
  }
  return today.toISOString();
}
function waitedAtLeast(later, earlier) {
  return later - earlier >= NOTIFIED_WINDOW_DAYS;
}
function buildWaitlistAging(input) {
  const today = input.today ?? /* @__PURE__ */ new Date();
  const todayIndex = easternDayIndex(today.toISOString());
  const appliedAt = new Map(input.applications.map((row) => [row.id, row.created_at]));
  const groups = /* @__PURE__ */ new Map();
  for (const entry of input.entries) {
    const city = cityGroup(entry.city);
    let group = groups.get(city.key);
    if (!group) {
      group = {
        city: city.label,
        days: [],
        waiting: 0,
        notifiedNotApplied: 0
      };
      groups.set(city.key, group);
    }
    if (entry.status === "waiting") {
      if (todayIndex != null) group.waiting += 1;
      const created = easternDayIndex(entry.created_at);
      if (created != null && todayIndex != null && created <= todayIndex) {
        group.days.push(todayIndex - created);
      }
      continue;
    }
    if (entry.status !== "notified" || todayIndex == null) continue;
    const notified = easternDayIndex(entry.notified_at);
    if (notified == null || notified > todayIndex) continue;
    const applicationId = entry.promoted_application_id;
    const applicationCreated = typeof applicationId === "string" ? appliedAt.get(applicationId) : void 0;
    const applied = applicationCreated ? easternDayIndex(applicationCreated) : null;
    if (applied != null && applied <= todayIndex) {
      if (waitedAtLeast(applied, notified)) group.notifiedNotApplied += 1;
    } else if (waitedAtLeast(todayIndex, notified)) {
      group.notifiedNotApplied += 1;
    }
  }
  const built = [];
  for (const group of groups.values()) {
    if (group.waiting === 0 && group.notifiedNotApplied === 0) continue;
    built.push({
      city: group.city,
      waiting: group.waiting,
      medianDays: exactMedian(group.days),
      oldestDays: group.days.length === 0 ? null : Math.max(...group.days),
      notifiedNotApplied: group.notifiedNotApplied
    });
  }
  built.sort((a, b) => {
    if (a.city == null && b.city == null) return 0;
    if (a.city == null) return 1;
    if (b.city == null) return -1;
    return a.city.localeCompare(b.city);
  });
  return {
    failed: false,
    truncated: input.truncated === true,
    cap: WAITLIST_AGING_CAP,
    groups: built
  };
}
var init_waitlist_aging_build = __esm({
  "src/lib/waitlist-aging-build.ts"() {
    "use strict";
    init_lead_priorities();
    init_waitlist_aging();
  }
});

// src/lib/waitlist-aging-load.ts
var waitlist_aging_load_exports = {};
__export(waitlist_aging_load_exports, {
  loadWaitlistAging: () => loadWaitlistAging
});
async function readCounted(query, cap) {
  const rows2 = [];
  const seen = /* @__PURE__ */ new Set();
  let total;
  do {
    const page = await query(rows2.length, rows2.length + PAGE - 1);
    if (page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > MAX_ROWS) {
      return { ok: false };
    }
    if (total !== void 0 && total !== page.count) return { ok: false };
    total = page.count;
    if (page.data.length === 0 && rows2.length < total && rows2.length < cap) return { ok: false };
    for (const row of page.data) {
      if (typeof row?.id !== "string" || seen.has(row.id)) return { ok: false };
      seen.add(row.id);
      rows2.push(row);
      if (rows2.length >= cap) return { ok: true, rows: rows2, truncated: total > cap };
    }
    if (rows2.length > total) return { ok: false };
  } while (rows2.length < total && rows2.length < cap);
  return { ok: true, rows: rows2, truncated: false };
}
async function readApplications(db, ids) {
  const rows2 = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const read = await readCounted(
      (from, to) => db.from("applications").select("id,created_at", { count: "exact" }).in("id", batch).is("deleted_at", null).order("id", { ascending: true }).range(from, to),
      MAX_ROWS
    );
    if (!read.ok || read.truncated) return { ok: false };
    rows2.push(...read.rows);
  }
  return { ok: true, rows: rows2 };
}
async function loadWaitlistAging(db, today = /* @__PURE__ */ new Date()) {
  const columns = "id,city,status,created_at,notified_at,promoted_application_id";
  const waiting = await readCounted(
    (from, to) => db.from("waitlist").select(columns, { count: "exact" }).eq("status", "waiting").order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
    WAITLIST_AGING_CAP
  );
  if (!waiting.ok) return failedWaitlistAging();
  const notified = await readCounted(
    (from, to) => db.from("waitlist").select(columns, { count: "exact" }).eq("status", "notified").lte("notified_at", notifiedThroughIso(today)).order("notified_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
    WAITLIST_AGING_CAP
  );
  if (!notified.ok) return failedWaitlistAging();
  const entries = [...waiting.rows, ...notified.rows];
  const ids = [
    ...new Set(
      notified.rows.map((row) => row.promoted_application_id).filter((id) => typeof id === "string" && id.length > 0)
    )
  ];
  const applications = ids.length === 0 ? { ok: true, rows: [] } : await readApplications(db, ids);
  if (!applications.ok) return failedWaitlistAging();
  return buildWaitlistAging({
    entries,
    applications: applications.rows,
    today,
    truncated: waiting.truncated || notified.truncated
  });
}
var PAGE, MAX_ROWS, ID_BATCH;
var init_waitlist_aging_load = __esm({
  "src/lib/waitlist-aging-load.ts"() {
    "use strict";
    init_waitlist_aging();
    init_waitlist_aging_build();
    PAGE = 200;
    MAX_ROWS = 1e5;
    ID_BATCH = 50;
  }
});

// src/lib/roles.ts
var TIER_RANK, TIER_BY_ROLE, TIER_LABELS, TIER_SUMMARY;
var init_roles = __esm({
  "src/lib/roles.ts"() {
    TIER_RANK = {
      coordinator: 1,
      manager: 2,
      owner: 3
    };
    TIER_BY_ROLE = {
      admin: "owner",
      team: "manager",
      coordinator: "coordinator"
    };
    TIER_LABELS = {
      owner: "Owner",
      manager: "Manager",
      coordinator: "Coordinator"
    };
    TIER_SUMMARY = {
      owner: "Full access, including team management, settings and money.",
      manager: "Everything operational, including rent, deposits, charges and expenses. Cannot manage the team.",
      coordinator: "Applicants, drivers, vehicles, inspections and documents. Cannot see or touch money."
    };
  }
});

// scripts/fake-supabase.src.mjs
var fake_supabase_src_exports = {};
__export(fake_supabase_src_exports, {
  default: () => fake_supabase_src_default,
  supabase: () => supabase,
  supabaseAdmin: () => supabaseAdmin
});
function likeRx(pattern) {
  return new RegExp(
    `^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".")}$`,
    "i"
  );
}
function matchOr(row, expr) {
  return String(expr).split(",").some((clause) => {
    const [field, op, ...rest] = clause.split(".");
    const want = rest.join(".");
    const v = row[field];
    if (op === "is") return want === "null" ? v == null : v === want;
    if (op === "eq") return want === "" ? v === "" : String(v) === want;
    if (op === "ilike") return v != null && likeRx(want).test(String(v));
    return false;
  });
}
var S, rows, clone, uuid, Query, table, supabaseAdmin, supabase, fake_supabase_src_default;
var init_fake_supabase_src = __esm({
  "scripts/fake-supabase.src.mjs"() {
    S = globalThis.__fakeSb ??= { tables: {}, files: {}, log: [], defaults: {} };
    rows = (t) => S.tables[t] ??= [];
    clone = (r) => JSON.parse(JSON.stringify(r));
    uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : r & 3 | 8).toString(16);
    });
    Query = class {
      constructor(table2, kind, payload, opts = {}) {
        this.table = table2;
        this.kind = kind;
        this.payload = payload;
        this.filters = [];
        this.orders = [];
        this.limitN = null;
        this.rangeFrom = null;
        this.rangeTo = null;
        this.total = null;
        this.count = opts.count ?? null;
        this.head = opts.head ?? false;
      }
      // PostgREST lets a filter address inside a json column: value->>version.
      // The compare-and-swap that enforces the photo-reading limit depends on it,
      // so the fake has to understand it too or the test proves nothing.
      eq(f, v) {
        const [col, key] = String(f).split("->>");
        this.filters.push((r) => String(key ? (r[col] ?? {})[key] : r[f]) === String(v));
        return this;
      }
      neq(f, v) {
        this.filters.push((r) => String(r[f]) !== String(v));
        return this;
      }
      /**
       * ilike is a case-insensitive LIKE, not a case-insensitive equals: % and _
       * are wildcards. The duplicate-plate check hands a plate straight to it, so
       * a fake that compared strings would hide the reason a plate's characters
       * are validated at all — a plate of "%" matches every car in the fleet.
       */
      ilike(f, pat) {
        const rx = likeRx(pat);
        this.filters.push((r) => r[f] != null && rx.test(String(r[f])));
        return this;
      }
      // PostgREST cannot parse `col=in.()` — it is a syntax error, not a filter
      // that matches nothing. Pretending otherwise hid the callers that must
      // check for an empty candidate list before they ask.
      in(f, vs) {
        if (!vs?.length) throw new Error(`PostgREST: empty in() list for ${f}`);
        this.filters.push((r) => vs.map(String).includes(String(r[f])));
        return this;
      }
      is(f, v) {
        this.filters.push((r) => v === null ? r[f] == null : r[f] === v);
        return this;
      }
      or(expr) {
        this.filters.push((r) => matchOr(r, expr));
        return this;
      }
      gte(f, v) {
        this.filters.push((r) => String(r[f]) >= String(v));
        return this;
      }
      lte(f, v) {
        this.filters.push((r) => String(r[f]) <= String(v));
        return this;
      }
      order(f, o = {}) {
        this.orders.push([f, o.ascending !== false]);
        return this;
      }
      limit(n) {
        this.limitN = n;
        return this;
      }
      /**
       * One page, PostgREST's inclusive from–to. `count: "exact"` still reports
       * the TOTAL that matched, not the size of the page — a fake that counted
       * the slice would make a paginated list claim one page was the whole fleet.
       */
      range(from, to) {
        this.rangeFrom = from;
        this.rangeTo = to;
        return this;
      }
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
          if (S.failSelect === t) return { data: null, error: { message: `select ${t} refused` }, count: null };
          const m = this._matching();
          return { data: this.head ? null : m.map(clone), error: null, count: this.total ?? m.length };
        }
        if (this.kind === "insert") {
          if (S.failInsert === t) return { data: null, error: { message: `insert into ${t} refused` } };
          const list = Array.isArray(this.payload) ? this.payload : [this.payload];
          const made = list.map((p) => {
            const r = { id: p.id ?? uuid(), created_at: (/* @__PURE__ */ new Date()).toISOString(), ...S.defaults?.[t] ?? {}, ...p };
            rows(t).push(r);
            S.log.push({ op: "insert", table: t, row: clone(r) });
            return clone(r);
          });
          return { data: Array.isArray(this.payload) ? made : made[0], error: null };
        }
        if (this.kind === "upsert") {
          const p = this.payload;
          const i = rows(t).findIndex((r) => r.key === p.key || r.id === p.id);
          if (i >= 0) rows(t)[i] = { ...rows(t)[i], ...p };
          else rows(t).push({ id: p.id ?? uuid(), ...p });
          S.log.push({ op: "upsert", table: t, row: clone(p) });
          return { data: clone(p), error: null };
        }
        if (this.kind === "update") {
          const m = this._matching();
          for (const r of m) {
            Object.assign(r, this.payload);
            S.log.push({ op: "update", table: t, row: clone(r), patch: clone(this.payload) });
          }
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
      async single() {
        await this._gate();
        const r = this._run();
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        return { data: d ?? null, error: d ? null : { message: "no rows" }, count: r.count };
      }
      async maybeSingle() {
        await this._gate();
        const r = this._run();
        const d = Array.isArray(r.data) ? r.data[0] : r.data;
        return { data: d ?? null, error: null, count: r.count };
      }
      then(res, rej) {
        return this._gate().then(() => this._run()).then(res, rej);
      }
    };
    table = (name) => {
      S.reads = (S.reads ?? 0) + 1;
      return {
        select: (cols, opts = {}) => new Query(name, "select", null, opts).select(cols, opts),
        insert: (p) => new Query(name, "insert", p),
        update: (p) => new Query(name, "update", p),
        upsert: (p) => new Query(name, "upsert", p),
        delete: () => new Query(name, "delete", null)
      };
    };
    supabaseAdmin = {
      from: table,
      /**
       * Database functions, recorded rather than executed.
       *
       * The point of a test calling one is not to run PL/pgSQL — it is to prove
       * which transaction a path reached, how many times, and with what. A caller
       * that never gets here (because authorization refused it first) leaves no
       * entry, which is what "fails closed" looks like from the outside.
       *
       * Set S.rpcResults[name] to decide what it answers.
       */
      rpc: async (name, args) => {
        (S.rpcs ??= []).push({ name, args });
        const r = S.rpcResults?.[name];
        if (typeof r === "function") return r(args);
        return r ?? { data: null, error: null };
      },
      storage: {
        from: (bucket) => ({
          download: async (path) => {
            const key = `${bucket}/${path}`;
            const bytes = S.files[key];
            if (!bytes) return { data: null, error: { message: "not found" } };
            return {
              data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer, type: S.mime?.[key] ?? "image/jpeg" },
              error: null
            };
          },
          // A signed URL is how private evidence reaches a staff screen. The fake
          // hands back a recognisable stand-in so a test can tell "signed" from
          // "served straight out of a public bucket", which is the real risk.
          // A signed UPLOAD url is scoped to one path. Returning the path back is
          // what lets a test prove the server pinned it to one vehicle's folder
          // instead of handing out the bucket.
          createSignedUploadUrl: async (path) => ({
            data: { path, token: `upload-token:${bucket}/${path}` },
            error: null
          }),
          createSignedUrl: async (path, seconds) => ({
            data: { signedUrl: `signed://${bucket}/${path}?exp=${seconds}` },
            error: null
          }),
          remove: async (paths) => {
            for (const p of paths) delete S.files[`${bucket}/${p}`];
            return { data: null, error: null };
          },
          upload: async (path, body) => {
            S.files[`${bucket}/${path}`] = [...body ?? []];
            return { data: { path }, error: null };
          }
        })
      }
    };
    supabase = supabaseAdmin;
    fake_supabase_src_default = supabaseAdmin;
  }
});

// src/lib/roles.server.ts
var roles_server_exports = {};
__export(roles_server_exports, {
  TIER_LABELS: () => TIER_LABELS,
  TIER_SUMMARY: () => TIER_SUMMARY,
  getActor: () => getActor,
  requireManager: () => requireManager,
  requireOwner: () => requireOwner,
  requireStaff: () => requireStaff,
  requireTier: () => requireTier
});
async function getActor(userId) {
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_fake_supabase_src(), fake_supabase_src_exports));
  const { data: rows2 } = await supabaseAdmin2.from("user_roles").select("role").eq("user_id", userId);
  const roles = (rows2 ?? []).map((r) => String(r.role));
  const role = roles.find((r) => r === "admin") ?? roles.find((r) => r === "team") ?? roles.find((r) => r === "coordinator");
  if (!role) return null;
  let email = null;
  try {
    const { data } = await supabaseAdmin2.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  } catch {
  }
  return { userId, email, role, tier: TIER_BY_ROLE[role] };
}
async function requireTier(userId, minimum) {
  const actor = await getActor(userId);
  if (!actor) throw new Error("Forbidden");
  if (TIER_RANK[actor.tier] < TIER_RANK[minimum]) throw new Error("Forbidden");
  return actor;
}
var requireStaff, requireManager, requireOwner;
var init_roles_server = __esm({
  "src/lib/roles.server.ts"() {
    init_roles();
    requireStaff = (userId) => requireTier(userId, "coordinator");
    requireManager = (userId) => requireTier(userId, "manager");
    requireOwner = (userId) => requireTier(userId, "owner");
  }
});

// .waitlist-aging-build/react-start.mjs
var createServerFn = () => {
  const api = { middleware: () => api, handler: (fn) => fn };
  return api;
};
var createMiddleware = () => ({ server: (fn) => fn });

// .waitlist-aging-build/auth.mjs
var requireSupabaseAuth = {};

// src/lib/waitlist-aging.functions.ts
init_waitlist_aging();
var waitlistAgingGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertWaitlistAgingEnabled();
  return next();
});
var getWaitlistAging = createServerFn({ method: "POST" }).middleware([waitlistAgingGate, requireSupabaseAuth]).handler(async ({ context }) => {
  if (AGING_REFUSED) {
    assertWaitlistAgingEnabled();
    return idleWaitlistAging();
  }
  const { loadWaitlistAging: loadWaitlistAging2 } = await Promise.resolve().then(() => (init_waitlist_aging_load(), waitlist_aging_load_exports));
  const { requireStaff: requireStaff2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  await requireStaff2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_fake_supabase_src(), fake_supabase_src_exports));
  return loadWaitlistAging2(supabaseAdmin2);
});
export {
  getWaitlistAging
};
