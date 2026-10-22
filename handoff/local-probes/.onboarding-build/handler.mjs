var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/onboarding-checklist.ts
function onboardingCohort(status) {
  return ONBOARDING_STATUSES.includes(status);
}
function assertOnboardingChecklistEnabled() {
  if (ONBOARDING_CHECKLIST_ENABLED !== true) {
    throw new Error("Onboarding checklist is disabled.");
  }
}
var ONBOARDING_CHECKLIST_ENABLED, ONBOARDING_ROW_CAP, ONBOARDING_STATUSES, ONBOARDING_CHECKLIST_REFUSED;
var init_onboarding_checklist = __esm({
  "src/lib/onboarding-checklist.ts"() {
    "use strict";
    ONBOARDING_CHECKLIST_ENABLED = false;
    ONBOARDING_ROW_CAP = 1e3;
    ONBOARDING_STATUSES = ["approved", "active", "closed"];
    ONBOARDING_CHECKLIST_REFUSED = !ONBOARDING_CHECKLIST_ENABLED;
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
async function readInIdBatches(ids, query, batchSize = COUNTED_ID_BATCH) {
  const rows2 = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const chunk = ids.slice(index, index + batchSize);
    if (chunk.length === 0) continue;
    const read = await readCounted((from, to) => query(chunk, from, to));
    if (!read.ok || read.truncated) return { ok: false };
    rows2.push(...read.rows);
  }
  return { ok: true, rows: rows2 };
}
var COUNTED_PAGE, COUNTED_MAX, COUNTED_ID_BATCH;
var init_count_paged_read = __esm({
  "src/lib/count-paged-read.ts"() {
    "use strict";
    COUNTED_PAGE = 200;
    COUNTED_MAX = 1e5;
    COUNTED_ID_BATCH = 100;
  }
});

// src/components/admin/types.ts
var REQUIRED_DOC_TYPES;
var init_types = __esm({
  "src/components/admin/types.ts"() {
    "use strict";
    REQUIRED_DOC_TYPES = [
      "license_front",
      "license_back",
      "insurance_card",
      "driver_profile_screenshot"
    ];
  }
});

// src/lib/required-docs.ts
function canonicalRequiredDoc(row) {
  if (row.is_current === false || row.review_status === "rejected") return null;
  const cat = (row.category ?? "").trim();
  if (!cat) return null;
  const canonical = VAULT_TO_REQUIRED[cat] ?? cat;
  if (!REQUIRED_DOC_TYPES.includes(canonical)) return null;
  return canonical;
}
var VAULT_TO_REQUIRED;
var init_required_docs = __esm({
  "src/lib/required-docs.ts"() {
    "use strict";
    init_types();
    VAULT_TO_REQUIRED = {
      insurance: "insurance_card",
      gig_profile: "driver_profile_screenshot"
    };
  }
});

// src/lib/driver-readiness-facts.ts
function text(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function money(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function stampMillis(value) {
  const raw = text(value);
  if (!raw) return null;
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(raw);
  const parsed = Date.parse(day ? `${day[1]}T23:59:59.999Z` : raw);
  return Number.isNaN(parsed) ? null : parsed;
}
function later(left, right) {
  const a = stampMillis(left);
  const b = stampMillis(right);
  if (a == null) return text(right);
  if (b == null) return text(left);
  return b > a ? text(right) : text(left);
}
function fact(key, label, state, source, at) {
  return {
    key,
    label,
    state,
    source: state === "done" ? source : null,
    at: state === "done" ? at : null
  };
}
function liveRental(rental) {
  return !CANCELLED_RENTAL.has((rental.status ?? "").toLowerCase());
}
function docTime(doc) {
  return text(doc.reviewed_at) ?? text(doc.created_at);
}
function countedDoc(doc) {
  return canonicalRequiredDoc(doc);
}
function licenseFact(id, documents) {
  const mine = documents.filter((doc) => doc.driver_id === id && countedDoc(doc) != null);
  const front = mine.filter((doc) => countedDoc(doc) === "license_front");
  const back = mine.filter((doc) => countedDoc(doc) === "license_back");
  if (front.length === 0 || back.length === 0) {
    return fact("license", READINESS_FACT_LABELS.license, "missing", null, null);
  }
  let at = null;
  for (const doc of [...front, ...back]) at = later(at, docTime(doc));
  return fact("license", READINESS_FACT_LABELS.license, "done", "Document Vault", at);
}
function documentsFact(id, documents) {
  const present = /* @__PURE__ */ new Set();
  let at = null;
  for (const doc of documents) {
    if (doc.driver_id !== id) continue;
    const canonical = countedDoc(doc);
    if (!canonical) continue;
    present.add(canonical);
    at = later(at, docTime(doc));
  }
  const count = present.size;
  const total = REQUIRED_DOC_TYPES.length;
  const label = `Documents ${count}/${total}`;
  if (count < total) return fact("documents", label, "missing", null, null);
  return fact("documents", label, "done", "Document Vault", at);
}
function hasCard(row) {
  return text(row.card_last4) != null || text(row.stripe_payment_method_id) != null || text(row.card_on_file_at) != null;
}
function cardFact(app, rentals) {
  if (hasCard(app)) return fact("card", READINESS_FACT_LABELS.card, "done", "Application", text(app.card_on_file_at));
  let at = null;
  let found = false;
  for (const rental of rentals) {
    if (rental.application_id !== app.id || !liveRental(rental) || !hasCard(rental)) continue;
    found = true;
    at = later(at, text(rental.card_on_file_at));
  }
  if (!found) return fact("card", READINESS_FACT_LABELS.card, "missing", null, null);
  return fact("card", READINESS_FACT_LABELS.card, "done", "Rental", at);
}
function agreementFact(id, agreements) {
  let at = null;
  let found = false;
  for (const agreement of agreements) {
    if (agreement.application_id !== id) continue;
    if (text(agreement.voided_at) || agreement.status === "voided") continue;
    if (agreement.status !== "signed") continue;
    found = true;
    at = later(at, text(agreement.signed_at));
  }
  if (!found) return fact("agreement", READINESS_FACT_LABELS.agreement, "missing", null, null);
  return fact("agreement", READINESS_FACT_LABELS.agreement, "done", "Agreement", at);
}
function pickupFact(id, rentals) {
  let at = null;
  let found = false;
  for (const rental of rentals) {
    if (rental.application_id !== id || !liveRental(rental)) continue;
    const start = text(rental.start_date);
    if (!start) continue;
    found = true;
    at = later(at, start);
  }
  if (!found) return fact("pickup", READINESS_FACT_LABELS.pickup, "unknown", null, null);
  return fact("pickup", READINESS_FACT_LABELS.pickup, "done", "Rental", at);
}
function interviewFact(screening) {
  const at = text(screening?.interview_completed_at);
  if (!at) return fact("interview", READINESS_FACT_LABELS.interview, "missing", null, null);
  return fact("interview", READINESS_FACT_LABELS.interview, "done", "Interview", at);
}
function insuranceFact(screening) {
  if (screening?.insurance_verified !== true) {
    return fact("insurance", READINESS_FACT_LABELS.insurance, "missing", null, null);
  }
  return fact("insurance", READINESS_FACT_LABELS.insurance, "done", "Screening", text(screening.insurance_verified_at));
}
function mvrFact(screening) {
  if (screening?.mvr_authorized !== true) return fact("mvr", READINESS_FACT_LABELS.mvr, "missing", null, null);
  return fact("mvr", READINESS_FACT_LABELS.mvr, "done", "Screening", null);
}
function idFact() {
  return fact("id", READINESS_FACT_LABELS.id, "unknown", null, null);
}
function paidDeposit(payment) {
  if (payment.type !== "deposit") return false;
  if (payment.status !== "paid") return false;
  const net = money(payment.net_collected);
  const collected = net == null ? money(payment.amount) : net;
  return collected != null && collected > 0;
}
function depositFact(app, payments, rentals) {
  const hits = [];
  for (const payment of payments) {
    if (payment.driver_id !== app.id || !paidDeposit(payment)) continue;
    hits.push({ at: text(payment.paid_date), source: "Payment" });
  }
  for (const rental of rentals) {
    if (rental.application_id !== app.id || !liveRental(rental)) continue;
    if (rental.deposit_status === "refunded") continue;
    const received = rental.deposit_held === true || rental.deposit_status != null && RENTAL_DEPOSIT_RECEIVED.has(rental.deposit_status);
    if (!received) continue;
    hits.push({ at: text(rental.deposit_settled_at), source: "Rental" });
  }
  if (hits.length === 0 && app.deposit_status === "paid") hits.push({ at: null, source: "Application" });
  if (hits.length === 0) return fact("deposit", READINESS_FACT_LABELS.deposit, "missing", null, null);
  let best = hits[0];
  for (const hit of hits.slice(1)) {
    const next = stampMillis(hit.at);
    const prev = stampMillis(best.at);
    if (next != null && (prev == null || next > prev)) best = hit;
  }
  return fact("deposit", READINESS_FACT_LABELS.deposit, "done", best.source, best.at);
}
function readinessFacts(input) {
  const id = input.application.id;
  return [
    licenseFact(id, input.documents),
    cardFact(input.application, input.rentals),
    agreementFact(id, input.agreements),
    pickupFact(id, input.rentals),
    interviewFact(input.screening),
    documentsFact(id, input.documents),
    insuranceFact(input.screening),
    mvrFact(input.screening),
    idFact(),
    depositFact(input.application, input.payments, input.rentals)
  ];
}
function nextMissingFact(facts) {
  const missing = facts.find((item) => item.state === "missing");
  if (missing) return missing.label;
  if (facts.some((item) => item.state === "unknown")) return "Unknown";
  return "Complete";
}
function driverDisplayName(value) {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name || "Unnamed Driver";
}
var READINESS_FACT_LABELS, CANCELLED_RENTAL, RENTAL_DEPOSIT_RECEIVED;
var init_driver_readiness_facts = __esm({
  "src/lib/driver-readiness-facts.ts"() {
    "use strict";
    init_types();
    init_required_docs();
    READINESS_FACT_LABELS = {
      license: "License (Front And Back)",
      card: "Card On File",
      agreement: "Agreement Signed",
      pickup: "Pickup Scheduled",
      interview: "Interview Complete",
      insurance: "Insurance Verified",
      mvr: "MVR Authorized",
      id: "ID Verified",
      deposit: "Deposit Received"
    };
    CANCELLED_RENTAL = /* @__PURE__ */ new Set(["cancelled", "canceled", "void", "voided"]);
    RENTAL_DEPOSIT_RECEIVED = /* @__PURE__ */ new Set([
      "held",
      "pending_disposition",
      "partially_refunded",
      "forfeited",
      "applied"
    ]);
  }
});

// src/lib/onboarding-checklist-build.ts
function forDriver(rows2, id, field) {
  return rows2.filter((row) => row[field] === id);
}
function buildOnboardingChecklist(input) {
  const drivers = [];
  for (const app of input.applications) {
    if (app.deleted_at || app.status === "duplicate" || !onboardingCohort(app.status)) continue;
    const screening = input.screenings.find((row) => row.lead_id === app.id) ?? null;
    const steps = readinessFacts({
      application: app,
      documents: forDriver(input.documents, app.id, "driver_id"),
      screening,
      agreements: forDriver(input.agreements, app.id, "application_id"),
      payments: forDriver(input.payments, app.id, "driver_id"),
      rentals: forDriver(input.rentals, app.id, "application_id")
    });
    drivers.push({
      id: app.id,
      name: driverDisplayName(app.full_name),
      status: app.status,
      steps,
      nextMissingStep: nextMissingFact(steps)
    });
  }
  return { failed: false, truncated: input.truncated, cap: ONBOARDING_ROW_CAP, drivers };
}
var init_onboarding_checklist_build = __esm({
  "src/lib/onboarding-checklist-build.ts"() {
    "use strict";
    init_onboarding_checklist();
    init_driver_readiness_facts();
  }
});

// src/lib/onboarding-checklist-load.ts
var onboarding_checklist_load_exports = {};
__export(onboarding_checklist_load_exports, {
  loadOnboardingChecklist: () => loadOnboardingChecklist
});
async function loadOnboardingChecklist(admin) {
  const applications = await readCounted(
    (from, to) => admin.from("applications").select(APPLICATION_COLUMNS, { count: "exact" }).is("deleted_at", null).in("status", [...ONBOARDING_STATUSES]).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
    ONBOARDING_ROW_CAP
  );
  if (!applications.ok) return failed();
  const ids = applications.rows.map((row) => String(row.id));
  const documents = await readInIdBatches(
    ids,
    (chunk, from, to) => admin.from("documents").select("id,driver_id,category,is_current,review_status,reviewed_at,created_at", { count: "exact" }).in("driver_id", chunk).eq("is_current", true).order("id", { ascending: true }).range(from, to),
    COUNTED_ID_BATCH
  );
  if (!documents.ok) return failed();
  const screenings = await readInIdBatches(
    ids,
    (chunk, from, to) => admin.from("driver_screenings").select("id,lead_id,interview_completed_at,insurance_verified,insurance_verified_at,mvr_authorized", { count: "exact" }).in("lead_id", chunk).order("id", { ascending: true }).range(from, to),
    COUNTED_ID_BATCH
  );
  if (!screenings.ok) return failed();
  const agreements = await readInIdBatches(
    ids,
    (chunk, from, to) => admin.from("agreements").select("id,application_id,status,signed_at,voided_at", { count: "exact" }).in("application_id", chunk).order("id", { ascending: true }).range(from, to),
    COUNTED_ID_BATCH
  );
  if (!agreements.ok) return failed();
  const payments = await readInIdBatches(
    ids,
    (chunk, from, to) => admin.from("payments").select("id,driver_id,type,status,net_collected,amount,paid_date", { count: "exact" }).in("driver_id", chunk).eq("type", "deposit").order("id", { ascending: true }).range(from, to),
    COUNTED_ID_BATCH
  );
  if (!payments.ok) return failed();
  const rentals = await readInIdBatches(
    ids,
    (chunk, from, to) => admin.from("rentals").select(
      "id,application_id,status,start_date,card_last4,stripe_payment_method_id,card_on_file_at,deposit_held,deposit_status,deposit_settled_at",
      { count: "exact" }
    ).in("application_id", chunk).order("id", { ascending: true }).range(from, to),
    COUNTED_ID_BATCH
  );
  if (!rentals.ok) return failed();
  return buildOnboardingChecklist({
    applications: applications.rows,
    documents: documents.rows,
    screenings: screenings.rows,
    agreements: agreements.rows,
    payments: payments.rows,
    rentals: rentals.rows,
    truncated: applications.truncated
  });
}
var failed, APPLICATION_COLUMNS;
var init_onboarding_checklist_load = __esm({
  "src/lib/onboarding-checklist-load.ts"() {
    "use strict";
    init_count_paged_read();
    init_onboarding_checklist();
    init_onboarding_checklist_build();
    failed = () => ({
      failed: true,
      truncated: false,
      cap: ONBOARDING_ROW_CAP,
      drivers: []
    });
    APPLICATION_COLUMNS = "id,full_name,status,deleted_at,card_last4,stripe_payment_method_id,card_on_file_at,deposit_status,license_expiration,insurance_expires_on";
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

// .onboarding-build/stub/supabase.js
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
  ".onboarding-build/stub/supabase.js"() {
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

// .onboarding-build/stub/react-start.js
var createServerFn = () => {
  const api = { middleware: () => api, handler: (fn) => fn };
  return api;
};
var createMiddleware = () => ({ server: (fn) => fn });

// .onboarding-build/stub/auth-middleware.js
var requireSupabaseAuth = {};

// src/lib/onboarding-checklist.functions.ts
init_onboarding_checklist();
var onboardingChecklistGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertOnboardingChecklistEnabled();
  return next();
});
var idle = () => ({
  failed: false,
  truncated: false,
  cap: ONBOARDING_ROW_CAP,
  drivers: []
});
var getOnboardingChecklist = createServerFn({ method: "GET" }).middleware([onboardingChecklistGate, requireSupabaseAuth]).handler(async ({ context }) => {
  if (ONBOARDING_CHECKLIST_REFUSED) {
    assertOnboardingChecklistEnabled();
    return idle();
  }
  const { loadOnboardingChecklist: loadOnboardingChecklist2 } = await Promise.resolve().then(() => (init_onboarding_checklist_load(), onboarding_checklist_load_exports));
  const { requireManager: requireManager2 } = await Promise.resolve().then(() => (init_roles_server(), roles_server_exports));
  await requireManager2(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_supabase(), supabase_exports));
  return loadOnboardingChecklist2(supabaseAdmin2);
});
export {
  getOnboardingChecklist
};
