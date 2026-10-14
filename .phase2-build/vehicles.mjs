var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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

// .phase2-build/stub/supabase.js
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
  ".phase2-build/stub/supabase.js"() {
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
    table = (name) => ({
      select: (cols, opts = {}) => new Query(name, "select", null, opts).select(cols, opts),
      insert: (p) => new Query(name, "insert", p),
      update: (p) => new Query(name, "update", p),
      upsert: (p) => new Query(name, "upsert", p),
      delete: () => new Query(name, "delete", null)
    });
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

// .phase2-build/stub/audit-server.js
var audit_server_exports = {};
__export(audit_server_exports, {
  logAudit: () => logAudit
});
var logAudit;
var init_audit_server = __esm({
  ".phase2-build/stub/audit-server.js"() {
    "use strict";
    logAudit = async (actor, entry) => {
      (globalThis.__fakeSb.audit ??= []).push({ actor: actor?.role ?? null, ...entry });
    };
  }
});

// src/lib/vehicle-doc-presence.ts
var vehicle_doc_presence_exports = {};
__export(vehicle_doc_presence_exports, {
  FINANCE_SLOTS: () => FINANCE_SLOTS,
  isFinanceKind: () => isFinanceKind,
  isOwnerOnlyDocKind: () => isOwnerOnlyDocKind,
  presentSlots: () => presentSlots,
  slotForKind: () => slotForKind,
  vehicleDocPresence: () => vehicleDocPresence
});
function slotForKind(kind) {
  return kind && CLASS_TO_SLOT[kind] || null;
}
function isFinanceKind(kind) {
  const s = slotForKind(kind);
  return !!s && FINANCE_SLOTS.has(s);
}
function isOwnerOnlyDocKind(kind) {
  return isFinanceKind(kind) || slotForKind(kind) === "title";
}
function vehicleDocPresence(direct, linked) {
  const bySlot = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  for (const d of linked) seen.set(d.id, { ...d, source: "linked" });
  for (const d of direct) seen.set(d.id, { ...d, source: "direct" });
  const ordered = [...seen.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === "direct" ? -1 : 1;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  for (const d of ordered) {
    const slot = slotForKind(d.kind);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, d);
  }
  return {
    bySlot,
    documentCount: seen.size,
    sharedCount: [...seen.values()].filter((d) => (d.relatedVehicles ?? 1) > 1).length,
    hasMaintenanceEvidence: [...seen.values()].some((d) => MAINTENANCE_KINDS.has(d.kind))
  };
}
function presentSlots(kinds) {
  const s = /* @__PURE__ */ new Set();
  for (const k of kinds) {
    const slot = slotForKind(k);
    if (slot) s.add(slot);
  }
  return s;
}
var CLASS_TO_SLOT, FINANCE_SLOTS, MAINTENANCE_KINDS;
var init_vehicle_doc_presence = __esm({
  "src/lib/vehicle-doc-presence.ts"() {
    "use strict";
    CLASS_TO_SLOT = {
      registration: "registration",
      insurance_card: "insurance_card",
      insurance_policy: "insurance_card",
      insurance_renewal: "insurance_card",
      title: "title",
      lien_release: "lien_release",
      purchase: "purchase",
      purchase_agreement: "purchase",
      bill_of_sale: "purchase",
      purchase_document: "purchase",
      loan_document: "purchase",
      payoff_statement: "purchase",
      lender_statement: "purchase",
      inspection_cert: "inspection_cert",
      inspection: "inspection_cert",
      emissions: "emissions",
      other: "other"
    };
    FINANCE_SLOTS = /* @__PURE__ */ new Set(["purchase", "lien_release"]);
    MAINTENANCE_KINDS = /* @__PURE__ */ new Set(["service_receipt", "repair_invoice", "oil_service", "tires", "brakes", "parts_receipt"]);
  }
});

// src/lib/vehicle-doc-presence.server.ts
var vehicle_doc_presence_server_exports = {};
__export(vehicle_doc_presence_server_exports, {
  loadVehicleDocPresence: () => loadVehicleDocPresence
});
async function loadVehicleDocPresence(sb, vehicleId, includeFinance) {
  const [{ data: own }, { data: links }] = await Promise.all([
    sb.from("documents").select("id,kind,file_name,expires_at,created_at").eq("vehicle_id", vehicleId).eq("is_current", true).is("driver_id", null),
    sb.from("document_vehicle_links").select("document_id").eq("vehicle_id", vehicleId)
  ]);
  const ids = (links ?? []).map((l) => l.document_id);
  let linked = [];
  if (ids.length) {
    const [{ data: docs }, { data: all }] = await Promise.all([
      sb.from("documents").select("id,kind,file_name,expires_at,created_at").in("id", ids).eq("is_current", true).is("driver_id", null),
      sb.from("document_vehicle_links").select("document_id").in("document_id", ids)
    ]);
    const count = {};
    for (const l of all ?? []) count[l.document_id] = (count[l.document_id] ?? 0) + 1;
    linked = (docs ?? []).map((d) => ({ ...d, relatedVehicles: count[d.id] ?? 1 }));
  }
  const keep = (d) => includeFinance || !isFinanceKind(d.kind);
  const direct = (own ?? []).filter(keep);
  linked = linked.filter(keep);
  const p = vehicleDocPresence(direct, linked);
  const kinds = [...new Set([...direct, ...linked].map((d) => String(d.kind ?? "")))];
  return { ...p, kinds, direct, linked };
}
var init_vehicle_doc_presence_server = __esm({
  "src/lib/vehicle-doc-presence.server.ts"() {
    "use strict";
    init_vehicle_doc_presence();
  }
});

// src/lib/vehicle-defaults.ts
function resolveVehicleDefaults(explicit, def) {
  const out = { sources: {} };
  for (const f of DEFAULT_FIELDS) {
    const v = explicit[f];
    if (v !== void 0) {
      out[f] = v;
      out.sources[f] = v === null ? "not_set" : "explicit";
    } else if (def && def[f] != null) {
      out[f] = Number(def[f]);
      out.sources[f] = "company_default";
    } else {
      out[f] = null;
      out.sources[f] = "not_set";
    }
  }
  return out;
}
var DEFAULT_FIELDS;
var init_vehicle_defaults = __esm({
  "src/lib/vehicle-defaults.ts"() {
    "use strict";
    DEFAULT_FIELDS = ["weekly_rate", "monthly_rate", "deposit"];
  }
});

// src/lib/vehicle-defaults.server.ts
var vehicle_defaults_server_exports = {};
__export(vehicle_defaults_server_exports, {
  loadDefaultFor: () => loadDefaultFor,
  resolveForCreate: () => resolveForCreate
});
async function loadDefaultFor(bodyType) {
  if (!bodyType) return null;
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data } = await supabaseAdmin2.from("vehicle_defaults").select("body_type,weekly_rate,monthly_rate,deposit").eq("body_type", bodyType).maybeSingle();
  return data ?? null;
}
async function resolveForCreate(bodyType, explicit) {
  return resolveVehicleDefaults(explicit, await loadDefaultFor(bodyType));
}
var init_vehicle_defaults_server = __esm({
  "src/lib/vehicle-defaults.server.ts"() {
    "use strict";
    init_vehicle_defaults();
  }
});

// src/lib/vehicle-lifecycle.ts
var vehicle_lifecycle_exports = {};
__export(vehicle_lifecycle_exports, {
  VEHICLE_DEPENDENCIES: () => VEHICLE_DEPENDENCIES,
  confirmMatches: () => confirmMatches,
  deleteBlockers: () => deleteBlockers
});
function deleteBlockers(counts) {
  return counts.filter((c) => c.count > 0);
}
function confirmMatches(unit, typed) {
  return !!unit && unit.trim().toUpperCase() === typed.trim().toUpperCase();
}
var VEHICLE_DEPENDENCIES;
var init_vehicle_lifecycle = __esm({
  "src/lib/vehicle-lifecycle.ts"() {
    "use strict";
    VEHICLE_DEPENDENCIES = [
      { table: "rentals", column: "vehicle_id", label: "Rentals" },
      { table: "agreements", column: "vehicle_id", label: "Agreements" },
      { table: "payments", column: "vehicle_id", label: "Payments" },
      { table: "financial_transactions", column: "vehicle_hint_id", label: "Ledger Entries" },
      { table: "vehicle_expenses", column: "vehicle_id", label: "Expenses" },
      { table: "toll_charges", column: "vehicle_id", label: "Tolls" },
      { table: "vehicle_finance", column: "vehicle_id", label: "Finance Records" },
      { table: "vehicle_titles", column: "vehicle_id", label: "Title Records" },
      { table: "maintenance_records", column: "vehicle_id", label: "Service Records" },
      { table: "maintenance_schedules", column: "vehicle_id", label: "Service Schedules" },
      { table: "vehicle_downtime", column: "vehicle_id", label: "Downtime" },
      { table: "inspections", column: "vehicle_id", label: "Inspections" },
      { table: "condition_media", column: "vehicle_id", label: "Condition Photos" },
      { table: "incidents", column: "vehicle_id", label: "Incidents" },
      { table: "issues", column: "vehicle_id", label: "Issues" },
      { table: "odometer_readings", column: "vehicle_id", label: "Mileage Readings" },
      { table: "vehicle_media", column: "vehicle_id", label: "Photos" },
      { table: "documents", column: "vehicle_id", label: "Documents" },
      { table: "document_vehicle_links", column: "vehicle_id", label: "Document Links" },
      { table: "applications", column: "vehicle_id", label: "Applications" },
      { table: "outbound_messages", column: "vehicle_id", label: "Messages" },
      { table: "fleet_import_proposals", column: "applied_vehicle_id", label: "Fleet Inbox Proposals" },
      { table: "fleet_import_proposals", column: "match_vehicle_id", label: "Fleet Inbox Matches" },
      { table: "fleet_service_transactions", column: "applied_vehicle_id", label: "Service Imports" },
      { table: "fleet_service_transactions", column: "match_vehicle_id", label: "Service Import Matches" },
      { table: "vehicle_field_provenance", column: "vehicle_id", label: "Field History" },
      { table: "vehicle_autofill_events", column: "vehicle_id", label: "Auto-Fill History" }
    ];
  }
});

// .phase2-build/stub/react-start-server.js
var getRequestHeader;
var init_react_start_server = __esm({
  ".phase2-build/stub/react-start-server.js"() {
    "use strict";
    getRequestHeader = () => globalThis.__fakeSb?.experience ?? null;
  }
});

// src/lib/experience.server.ts
var experience_server_exports = {};
__export(experience_server_exports, {
  ownerView: () => ownerView,
  requestedExperience: () => requestedExperience
});
function requestedExperience() {
  try {
    return getRequestHeader("x-rr-experience") ?? null;
  } catch {
    return null;
  }
}
function ownerView(actor) {
  return actor?.tier === "owner" && requestedExperience() !== "admin";
}
var init_experience_server = __esm({
  "src/lib/experience.server.ts"() {
    "use strict";
    init_react_start_server();
  }
});

// .phase2-build/stub/react-start.js
var createServerFn = () => {
  const api = { middleware: () => api, inputValidator: (v) => (api._v = v, api), handler: (fn) => Object.assign(fn, { _validate: api._v }) };
  return api;
};

// .phase2-build/stub/auth-middleware.js
var requireSupabaseAuth = {};

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/lib/vehicles.functions.ts
init_roles_server();

// src/lib/audit.ts
async function logAudit2(actor, entry) {
  const mod = await Promise.resolve().then(() => (init_audit_server(), audit_server_exports));
  return mod.logAudit(actor, entry);
}
function diffFields(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const from = before?.[k] ?? null;
    const to = after?.[k] ?? null;
    if (String(from ?? "") !== String(to ?? "")) out[k] = { from, to };
  }
  return out;
}

// src/lib/vin.ts
var VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
var TRANSLITERATE = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9
};
var WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
function normalizeVin(raw) {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function checkVin(raw) {
  const normalized = normalizeVin(raw);
  if (!normalized) {
    return { normalized, formatValid: false, checkDigitValid: null, problem: "No VIN entered." };
  }
  if (normalized.length !== 17) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      problem: `A VIN is 17 characters; this has ${normalized.length}.`
    };
  }
  if (!VIN_ALPHABET.test(normalized)) {
    return {
      normalized,
      formatValid: false,
      checkDigitValid: null,
      // Naming the culprit is the difference between a useful error and a
      // shrug, because these are exactly the characters people mistype.
      problem: "A VIN never contains the letters I, O or Q \u2014 check for 1 and 0."
    };
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = normalized[i];
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLITERATE[ch];
    if (value === void 0) {
      return { normalized, formatValid: false, checkDigitValid: null, problem: `Unexpected character "${ch}".` };
    }
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  const checkDigitValid = normalized[8] === expected;
  return {
    normalized,
    formatValid: true,
    checkDigitValid,
    problem: checkDigitValid ? null : "The check digit does not match. This is normal for some imported vehicles \u2014 confirm the VIN is right before saving."
  };
}

// src/lib/vehicle-readiness.ts
function hasValidRate(rate) {
  if (rate === null || rate === void 0 || rate === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && n > 0;
}
var LABELS = { year: "year", make: "make", model: "model", vin: "a valid VIN", weekly_rate: "a weekly rate above $0", photo: "at least one photo" };
function notReadyMessage(dbMessage) {
  const m = /vehicle_not_rental_ready:([a-z_,]+)/.exec(dbMessage);
  if (!m) return null;
  const parts = m[1].split(",").filter(Boolean).map((k) => LABELS[k] ?? k);
  return `Not rental ready yet \u2014 add ${parts.join(" and ")} first.`;
}

// src/lib/display-normalize.ts
var KEEP_UPPER = /* @__PURE__ */ new Set([
  "BMW",
  "GMC",
  "VW",
  "AMG",
  "GT",
  "GTI",
  "SE",
  "LE",
  "XLE",
  "SEL",
  "SL",
  "SLE",
  "SLT",
  "LT",
  "LS",
  "LTZ",
  "EX",
  "LX",
  "DX",
  "XL",
  "XLT",
  "SUV",
  "AWD",
  "FWD",
  "RWD",
  "4WD",
  "2WD",
  "RS",
  "SS",
  "ST",
  "SV",
  "SR",
  "SR5",
  "TRD",
  "HD",
  "EV",
  "RX",
  "NX",
  "ES",
  "IS",
  "GX",
  "LX",
  "CX",
  "MX",
  "QX",
  "FX",
  "II",
  "III",
  "IV"
]);
function caseWord(w) {
  if (!w) return w;
  if (/\d/.test(w) || KEEP_UPPER.has(w)) return w;
  return w.split("-").map((part) => KEEP_UPPER.has(part) || /\d/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()).join("-");
}
function normalizeDisplayText(value) {
  const s = value.trim().replace(/\s+/g, " ");
  if (!/[A-Z]/.test(s) || s !== s.toUpperCase()) return s;
  return s.split(" ").map(caseWord).join(" ");
}

// src/lib/us-states.ts
var US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DC", name: "District of Columbia" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" }
];
var US_STATE_CODES = US_STATES.map((s) => s.code);
var CODES = new Set(US_STATE_CODES);
function isUsStateCode(v) {
  return CODES.has(
    String(v ?? "").trim().toUpperCase()
  );
}

// src/lib/date-format.ts
var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toDate(v) {
  if (v === null || v === void 0 || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v, ..._ignored) {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// src/lib/vehicles.functions.ts
async function loadVehicleDocPresence2(sb, vehicleId, includeFinance) {
  const m = await Promise.resolve().then(() => (init_vehicle_doc_presence_server(), vehicle_doc_presence_server_exports));
  return m.loadVehicleDocPresence(sb, vehicleId, includeFinance);
}
var OWNERSHIP_TYPES = [
  { value: "owned", label: "Owned outright" },
  { value: "financed", label: "Financed" },
  { value: "leased", label: "Leased" },
  { value: "partner", label: "Partner vehicle" }
];
var BODY_TYPES = [
  "sedan",
  "suv",
  "xl",
  "truck",
  "van",
  "minivan",
  "coupe",
  "hatchback",
  "wagon",
  "convertible",
  "other"
];
var VEHICLE_STATUSES = [
  { value: "onboarding", label: "Needs Setup" },
  { value: "available", label: "Available" },
  { value: "rented", label: "Rented" },
  { value: "maintenance", label: "In maintenance" },
  { value: "reserved", label: "Reserved" },
  { value: "archived", label: "Archived" },
  { value: "sold", label: "Sold" },
  { value: "retired", label: "Retired" }
];
var INACTIVE_STATUSES = ["archived", "sold", "retired"];
var suggestUnitNumber = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({ prefix: external_exports.string().trim().max(8).optional() }).parse(d ?? {})
).handler(async ({ data, context }) => {
  await requireStaff(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: next, error } = await supabaseAdmin2.rpc("next_unit_number", {
    _prefix: data.prefix || "RR"
  });
  if (error) {
    console.error("[vehicles] unit number suggestion failed", error.message);
    return { suggestion: "" };
  }
  return { suggestion: String(next ?? "") };
});
var VPIC_FIELDS = [
  { from: "ModelYear", to: "year", label: "Year" },
  { from: "Make", to: "make", label: "Make" },
  { from: "Model", to: "model", label: "Model" },
  { from: "Trim", to: "trim", label: "Trim" },
  { from: "BodyClass", to: "body_class", label: "Body style" },
  { from: "DriveType", to: "drivetrain", label: "Drivetrain" },
  { from: "EngineCylinders", to: "engine_cylinders", label: "Cylinders" },
  { from: "DisplacementL", to: "engine_displacement", label: "Displacement (L)" },
  { from: "FuelTypePrimary", to: "fuel_type", label: "Fuel" },
  { from: "Doors", to: "doors", label: "Doors" },
  { from: "Manufacturer", to: "manufacturer", label: "Manufacturer" },
  { from: "PlantCountry", to: "plant_country", label: "Built in" },
  { from: "Series", to: "series", label: "Series" }
];
function meaningful(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^(not applicable|n\/a|unknown|null)$/i.test(s)) return null;
  return s;
}
function mapVpicRecord(rec) {
  const out = {};
  for (const f of VPIC_FIELDS) {
    const v = meaningful(rec[f.from]);
    if (v) out[f.to] = v;
  }
  return out;
}
function bodyClassToBodyType(bodyClass) {
  const s = (bodyClass ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("pickup")) return "truck";
  if (s.includes("minivan")) return "minivan";
  if (s.includes("van")) return "van";
  if (s.includes("sport utility") || s.includes("suv") || s.includes("crossover")) return "suv";
  if (s.includes("hatchback")) return "hatchback";
  if (s.includes("wagon")) return "wagon";
  if (s.includes("convertible") || s.includes("roadster")) return "convertible";
  if (s.includes("coupe")) return "coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "sedan";
  return "other";
}
var decodeVin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ vin: external_exports.string().trim().min(1).max(40) }).parse(d)).handler(async ({ data, context }) => {
  await requireStaff(context.userId);
  const check = checkVin(data.vin);
  if (!check.formatValid) {
    return {
      ok: false,
      formatValid: false,
      checkDigitValid: null,
      warning: null,
      decoded: {},
      error: check.problem ?? "That VIN is not valid."
    };
  }
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(check.normalized)}?format=json`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      return {
        ok: false,
        formatValid: true,
        checkDigitValid: check.checkDigitValid,
        warning: check.problem,
        decoded: {},
        error: `The VIN decoder returned ${res.status}. Enter the details manually.`
      };
    }
    const body = await res.json();
    const rec = body.Results?.[0];
    if (!rec) {
      return {
        ok: false,
        formatValid: true,
        checkDigitValid: check.checkDigitValid,
        warning: check.problem,
        decoded: {},
        error: "The decoder returned nothing for that VIN."
      };
    }
    const decoded = mapVpicRecord(rec);
    const bodyType = bodyClassToBodyType(decoded.body_class);
    if (bodyType) decoded.body_type = bodyType;
    return {
      ok: Object.keys(decoded).length > 0,
      formatValid: true,
      checkDigitValid: check.checkDigitValid,
      warning: check.problem,
      decoded,
      error: Object.keys(decoded).length ? void 0 : "The decoder had no details for that VIN."
    };
  } catch (err) {
    console.error("[vehicles] VIN decode failed", err);
    return {
      ok: false,
      formatValid: true,
      checkDigitValid: check.checkDigitValid,
      warning: check.problem,
      decoded: {},
      error: "Could not reach the VIN decoder. Enter the details manually."
    };
  }
});
var createInput = external_exports.object({
  unit_number: external_exports.string().trim().max(40).nullish(),
  vin: external_exports.string().trim().max(40).nullish(),
  year: external_exports.number().int().min(1900).max(2100),
  make: external_exports.string().trim().min(1).max(60),
  model: external_exports.string().trim().min(1).max(60),
  trim: external_exports.string().trim().max(60).nullish(),
  color: external_exports.string().trim().max(40).nullish(),
  body_type: external_exports.enum(BODY_TYPES).nullish(),
  current_odometer: external_exports.number().int().min(0).max(2e6).nullish(),
  license_plate: external_exports.string().trim().max(20).nullish(),
  plate_state: external_exports.string().trim().max(4).nullish(),
  status: external_exports.string().trim().max(30).default("available"),
  ownership_type: external_exports.enum(["owned", "financed", "leased", "partner"]).nullish(),
  partner_id: external_exports.string().uuid().nullish(),
  weekly_rate: external_exports.number().min(0).max(1e5).nullish(),
  deposit: external_exports.number().min(0).max(1e5).nullish(),
  monthly_rate: external_exports.number().min(0).max(4e5).nullish(),
  /** Quick Add "Save & Make Available" — an explicit human choice. */
  make_available: external_exports.boolean().optional()
});
var createVehicle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => createInput.parse(d)).handler(
  async ({
    data,
    context
  }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
    const vin = data.vin ? normalizeVin(data.vin) : null;
    if (vin) {
      const check = checkVin(vin);
      if (!check.formatValid)
        return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };
      const { data: dupe } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model").ilike("vin", vin).maybeSingle();
      if (dupe) {
        const label = dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`;
        return { ok: false, error: `${label} already has that VIN.`, field: "vin" };
      }
    }
    if (data.plate_state && !isUsStateCode(data.plate_state)) {
      return {
        ok: false,
        error: "Choose the state that issued the plate.",
        field: "plate_state"
      };
    }
    if (data.license_plate) {
      const problem = plateProblem(data.license_plate.trim().toUpperCase());
      if (problem) return { ok: false, error: problem, field: "license_plate" };
      const { data: dupe } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model").ilike("license_plate", data.license_plate.trim()).maybeSingle();
      if (dupe) {
        const label = dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`;
        return { ok: false, error: `${label} already has that plate.`, field: "license_plate" };
      }
    }
    if (data.unit_number) {
      const { data: dupe } = await supabaseAdmin2.from("vehicles").select("id").ilike("unit_number", data.unit_number.trim()).maybeSingle();
      if (dupe)
        return {
          ok: false,
          error: `Unit ${data.unit_number} is already in use.`,
          field: "unit_number"
        };
    }
    const { resolveForCreate: resolveForCreate2 } = await Promise.resolve().then(() => (init_vehicle_defaults_server(), vehicle_defaults_server_exports));
    const priced = await resolveForCreate2(data.body_type, {
      weekly_rate: data.weekly_rate,
      monthly_rate: data.monthly_rate,
      deposit: data.deposit
    });
    const { data: row, error } = await supabaseAdmin2.from("vehicles").insert({
      unit_number: data.unit_number?.trim() || null,
      vin,
      year: data.year,
      make: normalizeDisplayText(data.make),
      model: normalizeDisplayText(data.model),
      trim: data.trim ? normalizeDisplayText(data.trim) : null,
      color: data.color ? normalizeDisplayText(data.color) : null,
      body_type: data.body_type || null,
      current_odometer: data.current_odometer ?? null,
      license_plate: data.license_plate?.trim().toUpperCase() || null,
      plate_state: data.plate_state?.trim().toUpperCase() || null,
      // Available only when a human explicitly asked for it (Quick Add's
      // "Save & Make Available") AND the car is Rental Ready — the status
      // trigger re-checks this server-side. Otherwise Needs Setup.
      status: ["available", "reserved"].includes(data.status || "available") ? data.make_available && vin && hasValidRate(priced.weekly_rate) ? "available" : "onboarding" : data.status,
      partner_id: data.partner_id || null,
      // Unknown stays unknown: null means "Not Set", never $0.
      weekly_rate: priced.weekly_rate,
      monthly_rate: priced.monthly_rate,
      // No hard-coded deposit: explicit, configured company default, or Not Set.
      deposit: priced.deposit
    }).select("id,unit_number").single();
    if (error || !row) {
      const msg = String(error?.message ?? "");
      if (msg.includes("vehicles_vin_unique_idx"))
        return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
      if (msg.includes("vehicles_plate_unique_idx"))
        return {
          ok: false,
          error: "Another vehicle already has that plate.",
          field: "license_plate"
        };
      if (msg.includes("vehicles_unit_number_unique_idx"))
        return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
      console.error("[vehicles] create failed", msg);
      return { ok: false, error: msg || "Could not create the vehicle." };
    }
    if (data.ownership_type && actor.tier === "owner") {
      const { error: finErr } = await supabaseAdmin2.from("vehicle_finance").upsert(
        {
          vehicle_id: row.id,
          ownership_type: data.ownership_type,
          updated_by: actor.userId
        },
        {
          onConflict: "vehicle_id"
        }
      );
      if (finErr) console.error("[vehicles] ownership type not recorded", finErr.message);
    }
    await logAudit2(actor, {
      action: "vehicle.created",
      summary: `Added ${row.unit_number ? row.unit_number + " \u2014 " : ""}${data.year} ${data.make} ${data.model}`,
      entityType: "vehicle",
      entityId: row.id,
      metadata: {
        vin,
        unit_number: row.unit_number,
        ownership_type: data.ownership_type ?? null
      }
    });
    return { ok: true, id: row.id, unit_number: row.unit_number };
  }
);
var archiveVehicle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({ id: external_exports.string().uuid(), reason: external_exports.string().trim().min(3).max(500) }).parse(d)
).handler(async ({ data, context }) => {
  const actor = await requireManager(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { count } = await supabaseAdmin2.from("rentals").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).eq("status", "active");
  if ((count ?? 0) > 0) {
    return { ok: false, error: "This vehicle is on an active rental. End the rental first." };
  }
  const { data: before } = await supabaseAdmin2.from("vehicles").select("unit_number,year,make,model,status,archived_at").eq("id", data.id).maybeSingle();
  if (!before) return { ok: false, error: "Vehicle not found." };
  if (before.status === "archived") return { ok: false, error: "This vehicle is already archived." };
  const { data: rows2, error } = await supabaseAdmin2.from("vehicles").update({ status: "archived", archived_at: (/* @__PURE__ */ new Date()).toISOString(), archive_reason: data.reason }).eq("id", data.id).eq("status", before.status).select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows2?.length) return { ok: false, error: "This vehicle changed while you were archiving it. Refresh and try again." };
  await logAudit2(actor, {
    action: "vehicle.archived",
    summary: `${before.unit_number ?? `${before.year} ${before.make} ${before.model}`} archived`,
    entityType: "vehicle",
    entityId: data.id,
    metadata: { from_status: before.status, to_status: "archived", reason: data.reason }
  });
  return { ok: true };
});
var restoreVehicle = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(
  async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
    const { data: before } = await supabaseAdmin2.from("vehicles").select("unit_number,year,make,model,status,archive_reason").eq("id", data.id).maybeSingle();
    if (!before) return { ok: false, error: "Vehicle not found." };
    if (before.status !== "archived") return { ok: false, error: "This vehicle is not archived." };
    const { data: last } = await supabaseAdmin2.from("audit_log").select("metadata").eq("entity_type", "vehicle").eq("entity_id", data.id).eq("action", "vehicle.archived").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const previousStatus = last?.metadata?.from_status ?? null;
    const { data: rows2, error } = await supabaseAdmin2.from("vehicles").update({ status: "onboarding", archived_at: null, archive_reason: null }).eq("id", data.id).eq("status", "archived").select("id");
    if (error) return { ok: false, error: error.message };
    if (!rows2?.length) return { ok: false, error: "This vehicle was already restored." };
    await logAudit2(actor, {
      action: "vehicle.restored",
      summary: `${before.unit_number ?? `${before.year} ${before.make} ${before.model}`} restored to Onboarding`,
      entityType: "vehicle",
      entityId: data.id,
      metadata: {
        from_status: "archived",
        to_status: "onboarding",
        previous_status: previousStatus,
        archive_reason: before.archive_reason ?? null
      }
    });
    const { data: missing } = await supabaseAdmin2.rpc("vehicle_rental_ready_missing", { _vehicle_id: data.id });
    return { ok: true, previousStatus, missing: missing ?? [] };
  }
);
async function countDependencies(sb, id) {
  const { VEHICLE_DEPENDENCIES: VEHICLE_DEPENDENCIES2 } = await Promise.resolve().then(() => (init_vehicle_lifecycle(), vehicle_lifecycle_exports));
  return Promise.all(
    VEHICLE_DEPENDENCIES2.map(async (d) => {
      const { count, error } = await sb.from(d.table).select("*", { count: "exact", head: true }).eq(d.column, id);
      return { label: d.label, count: error ? -1 : count ?? 0 };
    })
  );
}
var getVehicleDeleteCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  const { requireOwner: requireOwner2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  await requireOwner2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: v } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model,vin,status").eq("id", data.id).maybeSingle();
  if (!v) return { ok: false, error: "Vehicle not found." };
  const counts = await countDependencies(supabaseAdmin2, data.id);
  return {
    ok: true,
    vehicle: { unit_number: v.unit_number, year: v.year, make: v.make, model: v.model, vinLast6: (v.vin ?? "").slice(-6), status: v.status },
    blockers: counts.filter((c) => c.count !== 0)
  };
});
var deleteVehiclePermanently = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid(), confirm: external_exports.string().max(40) }).parse(d)).handler(async ({ data, context }) => {
  const { requireOwner: requireOwner2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  const actor = await requireOwner2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { confirmMatches: confirmMatches2 } = await Promise.resolve().then(() => (init_vehicle_lifecycle(), vehicle_lifecycle_exports));
  const { data: v } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model,vin,status,archive_reason").eq("id", data.id).maybeSingle();
  if (!v) return { ok: false, error: "Vehicle not found." };
  if (v.status !== "archived") return { ok: false, error: "Archive the vehicle before deleting it permanently." };
  if (!confirmMatches2(v.unit_number, data.confirm)) return { ok: false, error: "The unit number you typed does not match." };
  const blockers = (await countDependencies(supabaseAdmin2, data.id)).filter((c) => c.count !== 0);
  if (blockers.length) {
    return { ok: false, error: `Blocked by linked records: ${blockers.map((b) => b.label).join(", ")}.` };
  }
  await logAudit2(actor, {
    action: "vehicle.deleted_permanently",
    summary: `${v.unit_number} ${v.year} ${v.make} ${v.model} permanently deleted`,
    entityType: "vehicle",
    entityId: data.id,
    metadata: { unit_number: v.unit_number, vin_last6: (v.vin ?? "").slice(-6), archive_reason: v.archive_reason }
  });
  const { data: rows2, error } = await supabaseAdmin2.from("vehicles").delete().eq("id", data.id).eq("status", "archived").select("id");
  if (error) return { ok: false, error: error.message };
  if (!rows2?.length) return { ok: false, error: "The vehicle was not deleted." };
  return { ok: true };
});
var getVehicleProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => external_exports.object({ id: external_exports.string().uuid() }).parse(d)).handler(async ({ data, context }) => {
  const actor = await requireStaff(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: vehicle } = await supabaseAdmin2.from("vehicles").select("*").eq("id", data.id).maybeSingle();
  if (!vehicle) return null;
  const v = vehicle;
  const isManager = actor.tier === "manager" || actor.tier === "owner";
  const isOwnerView = (await Promise.resolve().then(() => (init_experience_server(), experience_server_exports))).ownerView(actor);
  const [{ data: rental }, { data: partner }, publishedMedia, maint, insp, rentals, media] = await Promise.all([
    supabaseAdmin2.from("rentals").select("id,driver_id,application_id,start_date,end_date").eq("vehicle_id", data.id).eq("status", "active").maybeSingle(),
    v.partner_id ? supabaseAdmin2.from("partners").select("name").eq("id", v.partner_id).maybeSingle() : Promise.resolve({ data: null }),
    supabaseAdmin2.from("vehicle_media").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).eq("published", true),
    supabaseAdmin2.from("maintenance_records").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).neq("status", "completed"),
    supabaseAdmin2.from("inspections").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id),
    supabaseAdmin2.from("rentals").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id),
    supabaseAdmin2.from("vehicle_media").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id)
  ]);
  const presence = await loadVehicleDocPresence2(supabaseAdmin2, data.id, isOwnerView);
  let driverName = null;
  if (rental?.application_id) {
    const { data: app } = await supabaseAdmin2.from("applications").select("full_name").eq("id", rental.application_id).maybeSingle();
    driverName = app?.full_name ?? null;
  }
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const alerts = [];
  const pushAlert = (what, date) => {
    if (!date) return;
    const days = Math.round((new Date(date).getTime() - today.getTime()) / 864e5);
    if (days <= 45) alerts.push({ what, expires_on: date, days });
  };
  pushAlert("Plate", v.plate_expires_on);
  pushAlert("Registration", v.registration_expires_on);
  pushAlert("Insurance", v.insurance_expires_on);
  const { data: schedule } = await supabaseAdmin2.from("maintenance_schedules").select("item,next_due_on,next_due_miles").eq("vehicle_id", data.id).order("next_due_on", { ascending: true }).limit(1).maybeSingle();
  let finance = null;
  if (isOwnerView) {
    const { data: fin } = await supabaseAdmin2.from("vehicle_finance").select("*").eq("vehicle_id", data.id).maybeSingle();
    finance = fin ?? null;
  }
  let financials = null;
  if (isManager) {
    const { data: pl } = await supabaseAdmin2.rpc("vehicle_pl", {});
    const row = (pl ?? []).find((p) => p.vehicle_id === data.id);
    if (row) {
      financials = {
        revenue: Number(row.revenue ?? 0),
        expenses: Number(row.expenses ?? 0),
        maintenance: Number(row.maintenance ?? 0),
        net: Number(row.net ?? 0),
        days_on_rent: Number(row.days_on_rent ?? 0)
      };
    }
  }
  let ownerTitle = null;
  if (isOwnerView) {
    const { data: t } = await supabaseAdmin2.from("vehicle_titles").select("title_number,title_status").eq("vehicle_id", data.id).maybeSingle();
    ownerTitle = t ?? null;
  }
  const shapedVehicle = isOwnerView ? { ...v, title_number: ownerTitle?.title_number ?? null, title_status: ownerTitle?.title_status ?? null } : { ...v, title_number: null, title_status: v.title_on_file ? "on_file" : null };
  const { presentSlots: presentSlots2 } = await Promise.resolve().then(() => (init_vehicle_doc_presence(), vehicle_doc_presence_exports));
  const titleFacts = {
    documentOnFile: presentSlots2(presence.kinds).has("title"),
    metadataRecorded: !!v.title_on_file
  };
  return {
    vehicle: shapedVehicle,
    title: titleFacts,
    finance,
    canSeeFinance: isOwnerView,
    canEdit: isManager,
    unitLabel: v.unit_number || `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim(),
    vinLast4: v.vin ? String(v.vin).slice(-4) : "",
    isActive: !INACTIVE_STATUSES.includes(String(v.status ?? "")),
    currentRental: rental ? {
      id: rental.id,
      driver_name: driverName,
      application_id: rental.application_id,
      start_date: rental.start_date,
      end_date: rental.end_date
    } : null,
    partnerName: partner?.name ?? null,
    counts: {
      documents: presence.documentCount,
      sharedDocuments: presence.sharedCount,
      openMaintenance: maint.count ?? 0,
      inspections: insp.count ?? 0,
      rentals: rentals.count ?? 0,
      photos: media.count ?? 0,
      publishedPhotos: publishedMedia.count ?? 0
    },
    // For the non-blocking Fleet Profile checklist only.
    profileContext: await (async () => {
      const { count: maintAll } = await supabaseAdmin2.from("maintenance_records").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id);
      return {
        docKinds: presence.kinds,
        maintenanceCount: maintAll ?? 0,
        inspectionCount: insp.count ?? 0,
        photoCount: media.count ?? 0,
        title: titleFacts
      };
    })(),
    alerts: alerts.sort((a, b) => a.days - b.days),
    nextService: schedule ? {
      item: schedule.item,
      due_date: schedule.next_due_on,
      due_mileage: schedule.next_due_miles
    } : null,
    financials,
    readinessFacts: await (async () => {
      const [insp2, sched, iss, inc] = await Promise.all([
        supabaseAdmin2.from("inspections").select("completed_at").eq("vehicle_id", data.id).eq("inspection_type", "pre_delivery").eq("status", "passed").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin2.from("maintenance_schedules").select("item,next_due_on,next_due_miles").eq("vehicle_id", data.id).eq("is_active", true).limit(200),
        supabaseAdmin2.from("issues").select("title,severity,status").eq("vehicle_id", data.id).not("status", "in", "(resolved,closed)").limit(100),
        supabaseAdmin2.from("incidents").select("incident_type,severity,status,drivable").eq("vehicle_id", data.id).not("status", "in", "(closed,written_off)").limit(100)
      ]);
      return {
        lastPreDeliveryPassedAt: insp2.data?.completed_at ?? null,
        schedules: (sched.data ?? []).map((s) => ({ item: s.item, next_due_on: s.next_due_on, next_due_miles: s.next_due_miles })),
        openIssues: (iss.data ?? []).map((i) => ({ title: i.title, severity: i.severity })),
        openIncidents: (inc.data ?? []).map((i) => ({ type: i.incident_type, severity: i.severity, drivable: i.drivable })),
        hasActiveRental: !!rental
      };
    })()
  };
});
var VEHICLE_SECTIONS = {
  identity: [
    "unit_number",
    "year",
    "make",
    "model",
    "trim",
    "color",
    "body_type",
    // The Vehicle Details card shows the plate, so the drawer that card opens
    // can edit it. Same column, same write path, same duplicate check as
    // Registration & Title — one plate with two doors, not two plates.
    "license_plate",
    "plate_state",
    "seats",
    "doors",
    "mpg",
    "miles_per_tank",
    "fuel_type",
    "description",
    "status",
    "partner_id",
    "current_odometer",
    "internal_notes",
    "weekly_rate",
    "monthly_rate",
    "deposit",
    "badges",
    "uber_eligibility"
  ],
  insurance: [
    "insurance_carrier",
    "insurance_policy_number",
    "insurance_coverage",
    "insurance_effective_on",
    "insurance_expires_on",
    "insurance_status",
    "insurance_agent_name",
    "insurance_agent_phone",
    "insurance_agent_email"
  ],
  dmv: [
    "vin",
    "license_plate",
    "plate_state",
    "plate_expires_on",
    "registration_number",
    "registration_state",
    "registration_expires_on",
    "title_status",
    "title_number"
  ],
  gps: [
    "gps_provider",
    "gps_device_id",
    "gps_serial",
    "gps_imei",
    "gps_sim",
    "gps_status",
    "gps_installed_on",
    "gps_tracking_url",
    "gps_geofence_status",
    "gps_install_notes",
    // A reading, not a setting. Editable only so a bad one can be corrected;
    // the editor shows it apart from the device fields and says as much.
    "gps_odometer"
  ],
  // Service intervals and toll accounts had no home once the old editor went.
  service: [
    "maintenance_status",
    "oil_interval_miles",
    "last_oil_change_miles",
    "last_tire_date",
    "last_brake_inspection_date",
    "toll_transponder_id",
    "toll_account"
  ],
  keys: ["key_count", "spare_key", "key_type", "key_tag", "key_location", "key_notes"]
};
var PLATE_RE = /^[A-Z0-9][A-Z0-9 -]{1,19}$/;
function plateProblem(plate) {
  return PLATE_RE.test(plate) ? null : "A plate is 2 to 20 letters, numbers, spaces or dashes.";
}
var UPPERCASE_FIELDS = /* @__PURE__ */ new Set(["vin", "license_plate", "plate_state", "registration_state"]);
var NUMERIC_FIELDS = /* @__PURE__ */ new Set([
  "year",
  "seats",
  "doors",
  "mpg",
  "miles_per_tank",
  "current_odometer",
  "weekly_rate",
  "monthly_rate",
  "deposit",
  "key_count",
  "gps_odometer",
  "oil_interval_miles",
  "last_oil_change_miles"
]);
var SECTION_LABEL = {
  identity: "details",
  insurance: "insurance",
  dmv: "registration and title",
  gps: "GPS",
  keys: "keys",
  service: "service intervals and tolls"
};
var FIELD_LABEL = {
  unit_number: "unit number",
  body_type: "body type",
  current_odometer: "odometer",
  internal_notes: "internal notes",
  weekly_rate: "weekly rate",
  monthly_rate: "monthly rate",
  partner_id: "partner",
  miles_per_tank: "range",
  fuel_type: "fuel",
  insurance_carrier: "carrier",
  insurance_policy_number: "policy number",
  insurance_coverage: "coverage",
  insurance_expires_on: "policy expiry",
  insurance_effective_on: "effective date",
  insurance_status: "insurance status",
  insurance_agent_name: "agent",
  insurance_agent_phone: "agent phone",
  insurance_agent_email: "agent email",
  license_plate: "plate",
  plate_state: "plate state",
  plate_expires_on: "plate expiry",
  registration_number: "registration number",
  registration_state: "registration state",
  registration_expires_on: "registration expiry",
  title_status: "title status",
  title_number: "title number",
  gps_provider: "GPS provider",
  gps_device_id: "device ID",
  gps_serial: "serial",
  gps_imei: "IMEI",
  gps_sim: "SIM",
  gps_status: "GPS status",
  gps_installed_on: "install date",
  gps_tracking_url: "tracking link",
  gps_geofence_status: "geofence",
  gps_install_notes: "install notes",
  gps_odometer: "reported odometer",
  key_count: "key count",
  spare_key: "spare key",
  key_type: "key type",
  key_tag: "key tag",
  key_location: "key location",
  key_notes: "key notes",
  uber_eligibility: "platforms",
  maintenance_status: "maintenance status",
  oil_interval_miles: "oil interval",
  last_oil_change_miles: "last oil change",
  last_tire_date: "last tyre date",
  last_brake_inspection_date: "last brake inspection",
  toll_transponder_id: "transponder",
  toll_account: "toll account"
};
async function applySection(supabaseAdmin2, actor, data) {
  {
    const allowed = VEHICLE_SECTIONS[data.section];
    const named = (k) => ({
      field: k,
      label: FIELD_LABEL[k] ?? k.replace(/_/g, " ")
    });
    const intended = data.intended?.length ? [...new Set(data.intended)] : Object.keys(data.values).filter((k) => allowed.includes(k));
    const ignored = intended.filter((k) => !allowed.includes(k)).map((k) => ({
      ...named(k),
      reason: `The ${SECTION_LABEL[data.section]} editor does not save that field.`
    }));
    const patch = {};
    const canTitle = (await Promise.resolve().then(() => (init_experience_server(), experience_server_exports))).ownerView(actor);
    const TITLE_KEYS = ["title_number", "title_status"];
    const titleMoved = /* @__PURE__ */ new Set();
    if (canTitle && TITLE_KEYS.some((k) => k in data.values)) {
      const clean = (x) => typeof x === "string" && x.trim() ? x.trim() : null;
      const { data: wasTitle } = await supabaseAdmin2.from("vehicle_titles").select("title_number,title_status").eq("vehicle_id", data.id).maybeSingle();
      const row = {
        vehicle_id: data.id,
        updated_by: actor.userId,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      for (const k of TITLE_KEYS)
        if (k in data.values) {
          row[k] = clean(data.values[k]);
          if ((wasTitle?.[k] ?? null) !== row[k]) titleMoved.add(k);
        }
      const { error: tErr } = await supabaseAdmin2.from("vehicle_titles").upsert(row, { onConflict: "vehicle_id" });
      if (tErr) throw new Error("Could not save title details");
      const { data: t } = await supabaseAdmin2.from("vehicle_titles").select("title_number,title_status").eq("vehicle_id", data.id).maybeSingle();
      await supabaseAdmin2.from("vehicles").update({ title_on_file: !!(t?.title_number || t?.title_status) }).eq("id", data.id);
      await logAudit2(actor, {
        action: "vehicle.title_updated",
        summary: "Updated Owner-only title details",
        entityType: "vehicle",
        entityId: data.id,
        metadata: { fields: TITLE_KEYS.filter((k) => k in data.values) }
      });
    }
    for (const key of allowed) {
      if (!(key in data.values)) continue;
      if (TITLE_KEYS.includes(key)) continue;
      let v = data.values[key];
      if (typeof v === "string") {
        v = v.trim();
        if (UPPERCASE_FIELDS.has(key)) v = v.toUpperCase();
        if (v === "") v = null;
      }
      if (NUMERIC_FIELDS.has(key) && v !== null && v !== void 0) {
        const n = Number(v);
        if (!Number.isFinite(n))
          return { ok: false, error: `${FIELD_LABEL[key] ?? key} must be a number.`, field: key };
        v = n;
      }
      patch[key] = v ?? null;
    }
    if (!Object.keys(patch).length) {
      return {
        ok: true,
        saved: [...titleMoved].map(named),
        unchanged: intended.filter(
          (k) => allowed.includes(k) && (!TITLE_KEYS.includes(k) || canTitle && !titleMoved.has(k))
        ).map(named),
        rejected: canTitle ? [] : intended.filter((k) => allowed.includes(k) && TITLE_KEYS.includes(k)).map((k) => ({ ...named(k), reason: "Title details are Owner-only." })),
        ignored
      };
    }
    const { data: before } = await supabaseAdmin2.from("vehicles").select("*").eq("id", data.id).maybeSingle();
    if (!before) return { ok: false, error: "That vehicle no longer exists." };
    if (typeof patch.status === "string" && patch.status !== before.status) {
      if (patch.status === "archived" || before.status === "archived") {
        return {
          ok: false,
          error: patch.status === "archived" ? "Use Archive Vehicle to archive." : "Use Restore Vehicle to bring this vehicle back.",
          field: "status"
        };
      }
      const leaving = INACTIVE_STATUSES.includes(patch.status);
      if (leaving) {
        const { count } = await supabaseAdmin2.from("rentals").select("id", { count: "exact", head: true }).eq("vehicle_id", data.id).eq("status", "active");
        if ((count ?? 0) > 0) {
          return {
            ok: false,
            error: "This vehicle is on an active rental. End the rental first.",
            field: "status"
          };
        }
        if (!before.archived_at) patch.archived_at = (/* @__PURE__ */ new Date()).toISOString();
      } else if (before.archived_at) {
        patch.archived_at = null;
        patch.archive_reason = null;
      }
    }
    if (typeof patch.vin === "string" && patch.vin) {
      const vin = normalizeVin(patch.vin);
      const check = checkVin(vin);
      if (!check.formatValid)
        return { ok: false, error: check.problem ?? "Invalid VIN.", field: "vin" };
      patch.vin = vin;
      const { data: dupe } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model").ilike("vin", vin).neq("id", data.id).maybeSingle();
      if (dupe) {
        return {
          ok: false,
          error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that VIN.`,
          field: "vin"
        };
      }
    }
    const nextPlate = patch.license_plate;
    if (typeof nextPlate === "string" && nextPlate && nextPlate !== before.license_plate) {
      const problem = plateProblem(nextPlate);
      if (problem) return { ok: false, error: problem, field: "license_plate" };
    }
    const nextPlateState = patch.plate_state;
    if (typeof nextPlateState === "string" && nextPlateState && nextPlateState !== before.plate_state) {
      if (!isUsStateCode(nextPlateState))
        return {
          ok: false,
          error: "Choose the state that issued the plate.",
          field: "plate_state"
        };
    }
    for (const [col, field, label] of [
      ["license_plate", "license_plate", "plate"],
      ["unit_number", "unit_number", "unit number"]
    ]) {
      if (typeof patch[col] === "string" && patch[col]) {
        const { data: dupe } = await supabaseAdmin2.from("vehicles").select("id,unit_number,year,make,model").ilike(col, String(patch[col])).neq("id", data.id).maybeSingle();
        if (dupe) {
          return {
            ok: false,
            error: `${dupe.unit_number || `${dupe.year} ${dupe.make} ${dupe.model}`} already has that ${label}.`,
            field
          };
        }
      }
    }
    const { error } = await supabaseAdmin2.from("vehicles").update(patch).eq("id", data.id);
    if (error) {
      const msg = String(error.message);
      const notReady = notReadyMessage(msg);
      if (notReady) return { ok: false, error: notReady, field: "status" };
      if (msg.includes("vehicles_vin_unique_idx"))
        return { ok: false, error: "Another vehicle already has that VIN.", field: "vin" };
      if (msg.includes("vehicles_plate_unique_idx"))
        return {
          ok: false,
          error: "Another vehicle already has that plate.",
          field: "license_plate"
        };
      if (msg.includes("vehicles_unit_number_unique_idx"))
        return { ok: false, error: "That unit number is already in use.", field: "unit_number" };
      console.error("[vehicles] section update failed", data.section, msg);
      return { ok: false, error: msg };
    }
    const changed = diffFields(before, patch, Object.keys(patch));
    const changedKeys = Object.keys(changed);
    if (changedKeys.length) {
      const label = before.unit_number || `${before.year} ${before.make} ${before.model}`;
      if (changed.status) {
        await logAudit2(actor, {
          action: "vehicle.status.changed",
          summary: `${label} moved from ${String(changed.status.from ?? "\u2014")} to ${String(changed.status.to ?? "\u2014")}`,
          entityType: "vehicle",
          entityId: data.id,
          metadata: { from: changed.status.from, to: changed.status.to }
        });
      }
      const rest = changedKeys.filter((k) => k !== "status");
      if (rest.length) {
        const metadata = {};
        for (const k of rest) metadata[k] = changed[k];
        await logAudit2(actor, {
          action: `vehicle.${data.section}.updated`,
          summary: `Updated ${SECTION_LABEL[data.section]} for ${label} \u2014 ${rest.map((k) => FIELD_LABEL[k] ?? k.replace(/_/g, " ")).join(", ")}`,
          entityType: "vehicle",
          entityId: data.id,
          metadata
        });
      }
    }
    const saved = [];
    const unchanged = [];
    const rejected = [];
    for (const k of intended) {
      if (!allowed.includes(k)) continue;
      if (TITLE_KEYS.includes(k)) {
        if (!canTitle) rejected.push({ ...named(k), reason: "Title details are Owner-only." });
        else (titleMoved.has(k) ? saved : unchanged).push(named(k));
        continue;
      }
      (changedKeys.includes(k) ? saved : unchanged).push(named(k));
    }
    return { ok: true, saved, unchanged, rejected, ignored };
  }
}
var updateVehicleSection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    id: external_exports.string().uuid(),
    section: external_exports.enum(["identity", "insurance", "dmv", "gps", "keys", "service"]),
    // Shapes differ per section and the whitelist is what actually
    // constrains this, so values are validated by column rather than by a
    // schema that would have to be kept in sync with the table twice.
    values: external_exports.record(external_exports.string(), external_exports.unknown()),
    /**
     * The fields the operator actually edited. The drawers post the whole
     * record, so this is the only way the answer can name what changed
     * rather than listing every column on the car.
     */
    intended: external_exports.array(external_exports.string().max(64)).max(200).optional()
  }).parse(d)
).handler(async ({ data, context }) => {
  const actor = await requireManager(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  return applySection(supabaseAdmin2, actor, {
    id: data.id,
    section: data.section,
    values: data.values,
    intended: data.intended
  });
});
var updateVehicleSections = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator(
  (d) => external_exports.object({
    id: external_exports.string().uuid(),
    sections: external_exports.record(
      external_exports.enum(["identity", "insurance", "dmv", "gps", "keys", "service"]),
      external_exports.record(external_exports.string(), external_exports.unknown())
    )
  }).parse(d)
).handler(
  async ({
    data,
    context
  }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
    const ORDER = ["dmv", "identity", "insurance", "gps", "keys", "service"];
    const saved = [];
    const unchanged = [];
    const rejected = [];
    const ignored = [];
    for (const section of ORDER) {
      const values = data.sections[section];
      if (!values || !Object.keys(values).length) continue;
      const res = await applySection(supabaseAdmin2, actor, {
        id: data.id,
        section,
        values,
        intended: Object.keys(values)
      });
      if (!res.ok) return { ok: false, error: res.error, field: res.field, section };
      saved.push(...res.saved ?? []);
      unchanged.push(...res.unchanged ?? []);
      rejected.push(...res.rejected ?? []);
      ignored.push(...res.ignored ?? []);
    }
    return { ok: true, saved, unchanged, rejected, ignored };
  }
);
var shareInput = external_exports.object({
  id: external_exports.string().uuid(),
  includeVin: external_exports.boolean().default(true),
  includeRegistration: external_exports.boolean().default(true),
  includeInsurance: external_exports.boolean().default(true),
  /** Off by default: the carrier and expiry answer most questions on their own. */
  includePolicyNumber: external_exports.boolean().default(false),
  includeRates: external_exports.boolean().default(false),
  includePhotos: external_exports.boolean().default(true)
});
var getVehicleShare = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((d) => shareInput.parse(d)).handler(async ({ data, context }) => {
  const actor = await requireStaff(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  const { data: v } = await supabaseAdmin2.from("vehicles").select(
    "id,unit_number,year,make,model,trim,color,body_type,seats,doors,mpg,miles_per_tank,fuel_type,uber_eligibility,status,current_odometer,photos,description,weekly_rate,monthly_rate,deposit,vin,license_plate,plate_state,plate_expires_on,registration_number,registration_state,registration_expires_on,insurance_carrier,insurance_policy_number,insurance_coverage,insurance_expires_on"
  ).eq("id", data.id).maybeSingle();
  if (!v) return null;
  const row = v;
  const name = `${row.year ?? ""} ${row.make ?? ""} ${row.model ?? ""}${row.trim ? " " + row.trim : ""}`.trim();
  const unitLabel = row.unit_number || name || "Vehicle";
  const sections = [];
  const included = ["Vehicle & specifications"];
  const fmtDate2 = (d) => d ? fmtDate(d) : "\u2014";
  const rows2 = (pairs) => pairs.filter(([, val]) => val !== null && val !== void 0 && String(val).trim() !== "").map(([label, val]) => ({ label, value: String(val) }));
  sections.push({
    heading: "Vehicle",
    rows: rows2([
      ["Unit", row.unit_number],
      ["Year", row.year],
      ["Make", row.make],
      ["Model", row.model],
      ["Trim", row.trim],
      ["Color", row.color],
      ["Body type", row.body_type],
      ["Status", row.status],
      ...data.includeVin ? [["VIN", row.vin]] : []
    ])
  });
  if (data.includeVin) included.push("VIN");
  sections.push({
    heading: "Specifications",
    rows: rows2([
      ["Seats", row.seats],
      ["Doors", row.doors],
      ["Fuel", row.fuel_type],
      ["MPG", row.mpg],
      ["Range per tank", row.miles_per_tank ? `${row.miles_per_tank} miles` : null],
      [
        "Odometer",
        row.current_odometer ? `${Number(row.current_odometer).toLocaleString()} miles` : null
      ],
      [
        "Platforms",
        Array.isArray(row.uber_eligibility) && row.uber_eligibility.length ? row.uber_eligibility.join(", ") : null
      ]
    ])
  });
  if (data.includeRegistration) {
    sections.push({
      heading: "Registration & plate",
      rows: rows2([
        ["Plate", row.license_plate],
        ["Plate state", row.plate_state],
        ["Plate expires", row.plate_expires_on ? fmtDate2(row.plate_expires_on) : null],
        ["Registration #", row.registration_number],
        ["Registration state", row.registration_state],
        [
          "Registration expires",
          row.registration_expires_on ? fmtDate2(row.registration_expires_on) : null
        ]
      ])
    });
    included.push("Registration & plate");
  }
  if (data.includeInsurance) {
    sections.push({
      heading: "Insurance",
      rows: rows2([
        ["Carrier", row.insurance_carrier],
        ["Coverage", row.insurance_coverage],
        ["Expires", row.insurance_expires_on ? fmtDate2(row.insurance_expires_on) : null],
        ...data.includePolicyNumber ? [["Policy number", row.insurance_policy_number]] : []
      ])
    });
    included.push(
      data.includePolicyNumber ? "Insurance incl. policy number" : "Insurance (no policy number)"
    );
  }
  if (data.includeRates) {
    sections.push({
      heading: "Rates",
      rows: rows2([
        ["Weekly", row.weekly_rate != null ? `$${Number(row.weekly_rate).toFixed(2)}` : null],
        ["Monthly", row.monthly_rate != null ? `$${Number(row.monthly_rate).toFixed(2)}` : null],
        ["Deposit", row.deposit != null ? `$${Number(row.deposit).toFixed(2)}` : null]
      ])
    });
    included.push("Rates");
  }
  if (row.description) {
    sections.push({
      heading: "Description",
      rows: [{ label: "", value: String(row.description) }]
    });
  }
  const photos = data.includePhotos ? (row.photos ?? []).filter(Boolean).slice(0, 6) : [];
  if (photos.length) included.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`);
  await logAudit2(actor, {
    action: "vehicle.info.shared",
    summary: `Shared vehicle info for ${unitLabel} \u2014 ${included.join(", ")}`,
    entityType: "vehicle",
    entityId: data.id,
    metadata: { included }
  });
  return {
    title: name || unitLabel,
    unitLabel,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sections: sections.filter((s) => s.rows.length),
    photos,
    included
  };
});
export {
  BODY_TYPES,
  OWNERSHIP_TYPES,
  VEHICLE_SECTIONS,
  VEHICLE_STATUSES,
  archiveVehicle,
  bodyClassToBodyType,
  createVehicle,
  decodeVin,
  deleteVehiclePermanently,
  diffFields,
  getVehicleDeleteCheck,
  getVehicleProfile,
  getVehicleShare,
  mapVpicRecord,
  plateProblem,
  restoreVehicle,
  suggestUnitNumber,
  updateVehicleSection,
  updateVehicleSections
};
