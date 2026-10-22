var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/driver-doc-expiry.ts
function assertDriverDocExpiryEnabled() {
  if (DRIVER_DOC_EXPIRY_ENABLED !== true) {
    throw new Error("Driver document expiry is disabled.");
  }
}
var DRIVER_DOC_EXPIRY_ENABLED, DRIVER_DOC_EXPIRY_ROW_CAP, DOC_EXPIRY_REFUSED;
var init_driver_doc_expiry = __esm({
  "src/lib/driver-doc-expiry.ts"() {
    "use strict";
    DRIVER_DOC_EXPIRY_ENABLED = false;
    DRIVER_DOC_EXPIRY_ROW_CAP = 1e3;
    DOC_EXPIRY_REFUSED = !DRIVER_DOC_EXPIRY_ENABLED;
  }
});

// src/lib/count-paged-read.ts
function badCount(count) {
  return !Number.isSafeInteger(count) || count < 0 || count > COUNTED_MAX;
}
async function readCounted(query, cap = COUNTED_MAX) {
  const rows2 = [];
  const seen = /* @__PURE__ */ new Set();
  let total;
  const stop = Math.min(cap, COUNTED_MAX);
  do {
    const room = stop - rows2.length;
    if (room <= 0) break;
    const size = Math.min(COUNTED_PAGE, room);
    const from = rows2.length;
    const to = from + size - 1;
    let page;
    try {
      page = await query(from, to);
    } catch {
      return { ok: false };
    }
    if (page.error || !Array.isArray(page.data) || badCount(page.count)) return { ok: false };
    if (total !== void 0 && total !== page.count) return { ok: false };
    total = page.count;
    const expect = Math.min(total, stop);
    if (page.data.length === 0 && rows2.length < expect) return { ok: false };
    for (const row of page.data) {
      const id = row.id;
      if (typeof id !== "string" || seen.has(id)) return { ok: false };
      seen.add(id);
      rows2.push(row);
    }
    if (rows2.length > total) return { ok: false };
  } while (total !== void 0 && rows2.length < total && rows2.length < stop);
  if (total === void 0) return { ok: false };
  return { ok: true, rows: rows2, total, truncated: total > stop };
}
var COUNTED_PAGE, COUNTED_MAX;
var init_count_paged_read = __esm({
  "src/lib/count-paged-read.ts"() {
    "use strict";
    COUNTED_PAGE = 200;
    COUNTED_MAX = 1e5;
  }
});

// src/lib/driver-readiness-facts.ts
function parseCalendarDay(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamped = new Date(Date.UTC(year, month - 1, day));
  if (stamped.getUTCFullYear() !== year || stamped.getUTCMonth() !== month - 1 || stamped.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}
function easternCalendarDay(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DOC_EXPIRY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function calendarDaysUntil(today, date) {
  const start = parseCalendarDay(today);
  const end = parseCalendarDay(date);
  if (!start || !end) return null;
  const from = Date.UTC(start.year, start.month - 1, start.day);
  const to = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((to - from) / 864e5);
}
function documentDateStatus(raw, today) {
  const parsed = parseCalendarDay(raw);
  if (!parsed) return "unknown";
  const iso = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  const days = calendarDaysUntil(today, iso);
  if (days === null) return "unknown";
  if (days < 0) return "expired";
  if (days <= DOC_EXPIRY_WINDOW_DAYS) return "expiring";
  return "ok";
}
function documentExpiryStatus(application, today, tncOn) {
  const dates = [
    documentDateStatus(application.license_expiration, today),
    documentDateStatus(application.insurance_expires_on, today),
    documentDateStatus(tncOn, today)
  ];
  if (dates.includes("expired")) return "expired";
  if (dates.includes("expiring")) return "expiring";
  if (dates.every((item) => item === "ok")) return "ok";
  return "unknown";
}
function licenceInsuranceStatus(application, today) {
  const dates = [
    documentDateStatus(application.license_expiration, today),
    documentDateStatus(application.insurance_expires_on, today)
  ];
  if (dates.includes("expired")) return "expired";
  if (dates.includes("expiring")) return "expiring";
  if (dates.every((item) => item === "ok")) return "ok";
  return "unknown";
}
function separateDocumentLabel(application, today, tncOn) {
  const word = DOC_EXPIRY_STATUS_LABEL[licenceInsuranceStatus(application, today)];
  const tnc = documentDateStatus(tncOn, today);
  if (tncOn == null || tnc === "unknown") return `${word} \xB7 TNC Unknown`;
  if (tnc === "expired") return `${word} \xB7 TNC Expired`;
  if (tnc === "expiring") return `${word} \xB7 TNC Expires In 30 Days`;
  return word;
}
var DOC_EXPIRY_WINDOW_DAYS, DOC_EXPIRY_TIME_ZONE, DOC_EXPIRY_STATUS_LABEL;
var init_driver_readiness_facts = __esm({
  "src/lib/driver-readiness-facts.ts"() {
    "use strict";
    DOC_EXPIRY_WINDOW_DAYS = 30;
    DOC_EXPIRY_TIME_ZONE = "America/New_York";
    DOC_EXPIRY_STATUS_LABEL = {
      expired: "Expired",
      expiring: "Expires In 30 Days",
      ok: "OK",
      unknown: "Unknown"
    };
  }
});

// src/lib/driver-doc-expiry-load.ts
var driver_doc_expiry_load_exports = {};
__export(driver_doc_expiry_load_exports, {
  loadDriverDocExpiry: () => loadDriverDocExpiry
});
async function loadDriverDocExpiry(admin, today = easternCalendarDay(/* @__PURE__ */ new Date())) {
  const applications = await readCounted(
    (from, to) => admin.from("applications").select(APPLICATION_COLUMNS, { count: "exact" }).is("deleted_at", null).neq("status", "duplicate").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
    DRIVER_DOC_EXPIRY_ROW_CAP
  );
  if (!applications.ok) return failed();
  const drivers = applications.rows.flatMap((row) => {
    const app = row;
    if (typeof app.id !== "string" || app.id.length === 0) return [];
    const dates = {
      license_expiration: app.license_expiration ?? null,
      insurance_expires_on: app.insurance_expires_on ?? null
    };
    return [
      {
        id: app.id,
        status: documentExpiryStatus(dates, today, null),
        separateLabel: separateDocumentLabel(dates, today, null)
      }
    ];
  });
  return {
    failed: false,
    truncated: applications.truncated,
    cap: DRIVER_DOC_EXPIRY_ROW_CAP,
    tncTracked: false,
    drivers
  };
}
var APPLICATION_COLUMNS, failed;
var init_driver_doc_expiry_load = __esm({
  "src/lib/driver-doc-expiry-load.ts"() {
    "use strict";
    init_count_paged_read();
    init_driver_readiness_facts();
    init_driver_doc_expiry();
    APPLICATION_COLUMNS = "id,license_expiration,insurance_expires_on";
    failed = () => ({
      failed: true,
      truncated: false,
      cap: DRIVER_DOC_EXPIRY_ROW_CAP,
      drivers: []
    });
  }
});

// src/lib/roles.ts
var TIER_RANK, TIER_BY_ROLE, TIER_LABELS, TIER_SUMMARY;
var init_roles = __esm({
  "src/lib/roles.ts"() {
    "use strict";
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

// .doc-expiry-build/stub/supabase.js
var supabase_exports = {};
__export(supabase_exports, {
  default: () => supabase_default,
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
var S, rows, clone, uuid, Query, table, supabaseAdmin, supabase, supabase_default;
var init_supabase = __esm({
  ".doc-expiry-build/stub/supabase.js"() {
    "use strict";
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
    supabase_default = supabaseAdmin;
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
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
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
    "use strict";
    init_roles();
    requireStaff = (userId) => requireTier(userId, "coordinator");
    requireManager = (userId) => requireTier(userId, "manager");
    requireOwner = (userId) => requireTier(userId, "owner");
  }
});

// .doc-expiry-build/stub/react-start.js
var createServerFn = () => {
  const api = { middleware: () => api, handler: (fn) => fn };
  return api;
};
var createMiddleware = () => ({ server: (fn) => fn });

// .doc-expiry-build/stub/auth-middleware.js
var requireSupabaseAuth = {};

// src/lib/driver-doc-expiry.functions.ts
init_driver_doc_expiry();
var driverDocExpiryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertDriverDocExpiryEnabled();
  return next();
});
var idle = () => ({
  failed: false,
  truncated: false,
  cap: DRIVER_DOC_EXPIRY_ROW_CAP,
  drivers: []
});
var getDriverDocExpiry = createServerFn({ method: "GET" }).middleware([driverDocExpiryGate, requireSupabaseAuth]).handler(async ({ context }) => {
  if (DOC_EXPIRY_REFUSED) {
    assertDriverDocExpiryEnabled();
    return idle();
  }
  const { loadDriverDocExpiry: loadDriverDocExpiry2 } = await Promise.resolve().then(() => (init_driver_doc_expiry_load(), driver_doc_expiry_load_exports));
  const { requireManager: requireManager2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  await requireManager2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  return loadDriverDocExpiry2(supabaseAdmin2);
});
export {
  getDriverDocExpiry
};
