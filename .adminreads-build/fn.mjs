var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// .adminreads-build/stub-sb.js
var stub_sb_exports = {};
__export(stub_sb_exports, {
  default: () => stub_sb_default,
  supabase: () => supabase,
  supabaseAdmin: () => supabaseAdmin
});
function table(name) {
  const filters = [];
  let head = false;
  const run = () => {
    const st = S();
    if (st.failWith && st.failWith.table === name) {
      return { data: null, count: null, error: { message: st.failWith.message } };
    }
    const rows = (st.db[name] ?? []).filter(
      (r) => filters.every(
        ([c, v]) => c.startsWith("!") ? r[c.slice(1)] !== v : c.startsWith("=") ? (r[c.slice(1)] ?? null) === v : c.startsWith(">") ? String(r[c.slice(1)] ?? "") >= String(v) : c.startsWith("*") ? (r[c.slice(1)] ?? null) !== null : r[c] === v
      )
    );
    return head ? { data: null, count: st.missingCount ? null : rows.length, error: null } : { data: rows.map((r) => ({ ...r })), count: rows.length, error: null };
  };
  const api = {
    select: (_cols, opts) => {
      if (opts && opts.head) head = true;
      return api;
    },
    eq: (c, v) => (filters.push([c, v]), api),
    neq: (c, v) => (filters.push(["!" + c, v]), api),
    is: (c, v) => (filters.push(["=" + c, v]), api),
    not: (c, _op, _v) => (filters.push(["*" + c, null]), api),
    gte: (c, v) => (filters.push([">" + c, v]), api),
    order: () => api,
    limit: () => api,
    then: (res, rej) => Promise.resolve(run()).then(res, rej)
  };
  return api;
}
var S, supabaseAdmin, supabase, stub_sb_default;
var init_stub_sb = __esm({
  ".adminreads-build/stub-sb.js"() {
    "use strict";
    S = () => globalThis.__ar;
    supabaseAdmin = {
      from: table,
      auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } }
    };
    supabase = supabaseAdmin;
    stub_sb_default = supabaseAdmin;
  }
});

// .adminreads-build/stub-start.js
var createServerFn = () => {
  const api = {
    middleware: () => api,
    inputValidator: (v) => (api._v = v, api),
    handler: (fn) => (args) => fn({ ...args, data: api._v ? api._v(args?.data) : args?.data })
  };
  return api;
};

// .adminreads-build/stub-auth.js
var requireSupabaseAuth = {};

// src/lib/roles.ts
var TIER_RANK = {
  coordinator: 1,
  manager: 2,
  owner: 3
};
var TIER_BY_ROLE = {
  admin: "owner",
  team: "manager",
  coordinator: "coordinator"
};
function tierAllows(have, need) {
  if (!have) return false;
  return TIER_RANK[have] >= TIER_RANK[need];
}

// src/lib/roles.server.ts
async function getActor(userId) {
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_stub_sb(), stub_sb_exports));
  const { data: rows } = await supabaseAdmin2.from("user_roles").select("role").eq("user_id", userId);
  const roles = (rows ?? []).map((r) => String(r.role));
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
var requireStaff = (userId) => requireTier(userId, "coordinator");

// src/lib/admin-overview.ts
var APPLICANT_WINDOW = 500;
var OVERVIEW_APPLICANT_FIELDS = [
  "id",
  "full_name",
  "status",
  "current_step",
  "created_at",
  "reviewed_at"
];
var NOTIFICATION_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone",
  "created_at",
  "status"
];
var OVERVIEW_APPLICANT_SELECT = OVERVIEW_APPLICANT_FIELDS.join(",");
var NOTIFICATION_SELECT = NOTIFICATION_FIELDS.join(",");
var str = (v) => typeof v === "string" ? v : null;
function projectOverviewApplicant(row) {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    status: str(row.status),
    current_step: str(row.current_step),
    created_at: str(row.created_at),
    reviewed_at: str(row.reviewed_at)
  };
}
function projectNotification(row) {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    email: str(row.email),
    phone: str(row.phone),
    created_at: str(row.created_at),
    status: str(row.status),
    type: "application"
  };
}
var PAYMENT_ALERT_TITLES = ["Payment Failed", "Weekly Rent Failed", "Payment Past Due", "Collections Plan"];
function projectPaymentAlert(row) {
  const id = str(row.id);
  const title = str(row.title);
  if (!id || !title || !PAYMENT_ALERT_TITLES.includes(title)) return null;
  return {
    id: `pay:${id}`,
    type: "payment",
    title,
    body: str(row.body),
    full_name: null,
    email: null,
    phone: null,
    created_at: str(row.created_at),
    status: null
  };
}
function mergeAdminNotifications(a, b, limit = 20) {
  return [...a, ...b].sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? "")).slice(0, limit);
}

// src/lib/readiness.ts
var DOC_ALIASES = {
  license_front: ["license_front"],
  license_back: ["license_back"],
  insurance_card: ["insurance_card", "insurance"],
  driver_profile_screenshot: ["driver_profile_screenshot", "gig_profile"]
};
function indexDocuments(documents) {
  const present = /* @__PURE__ */ new Set();
  const checked = /* @__PURE__ */ new Set();
  for (const doc of documents) {
    if (doc?.is_current === false) continue;
    const raw = (doc?.category ?? doc?.doc_type ?? "").trim();
    if (!raw) continue;
    for (const [canonical, names] of Object.entries(DOC_ALIASES)) {
      if (!names.includes(raw)) continue;
      present.add(canonical);
      if (doc.review_status === "rejected") present.delete(canonical);
      if (doc.review_status === "verified") checked.add(canonical);
    }
  }
  return { has: (c) => present.has(c), verified: (c) => checked.has(c) };
}
var num = (v) => {
  if (v === null || v === void 0 || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
var bool = (v) => v === true ? true : v === false ? false : null;
var clock = () => Date.now();
var now = () => clock();
var positive = (detail, evidence, partial = 1) => ({
  state: "positive",
  evidence,
  detail,
  partial
});
var attention = (detail, evidence) => ({
  state: "attention",
  evidence,
  detail
});
var unknown = (detail) => ({ state: "unknown", detail });
var FACTORS = [
  // ---- Gig work: the core of whether this person can earn -------------- 30
  {
    key: "gig_account",
    remedy: "interview",
    label: "Gig account",
    group: "Gig work",
    weight: 10,
    evaluate: (a, s) => {
      const st = s.gig_account_status;
      if (st === "active") return positive("Gig account active (staff noted, not platform-verified)", "staff_verified");
      if (st === "deactivated") return attention("Gig account deactivated (staff noted)", "staff_verified");
      if (st === "pending") return positive("Gig account pending (staff noted)", "staff_verified", 0.4);
      const g = a.gig_status;
      if (g === "Yes, already driving" || g === "Yes")
        return positive("Already driving", "self_reported");
      if (g === "Not yet, ready to start" || g === "Pending")
        return positive("Ready to start, not yet driving", "self_reported", 0.4);
      return unknown("Gig account status not established");
    }
  },
  {
    key: "trip_volume",
    remedy: "interview",
    label: "Trip volume",
    group: "Gig work",
    weight: 8,
    evaluate: (a, s) => {
      const staff = num(s.trip_count);
      const self = num(a.trips_completed);
      const shots = Array.isArray(a.trip_screenshots) ? a.trip_screenshots.filter(Boolean).length : 0;
      const n = staff ?? self;
      if (n === null) return unknown("Trip count not provided");
      const evidence = staff !== null ? "staff_verified" : shots > 0 ? "document" : "self_reported";
      const band = n >= 1e3 ? 1 : n >= 500 ? 0.8 : n >= 200 ? 0.6 : n >= 50 ? 0.3 : 0;
      if (band === 0) return attention(`Only ${n} trips completed`, evidence);
      return positive(`${n.toLocaleString()} trips`, evidence, band);
    }
  },
  {
    key: "driver_rating",
    remedy: "interview",
    label: "Driver rating",
    group: "Gig work",
    weight: 7,
    evaluate: (a, s, d) => {
      const staff = num(s.driver_rating);
      const self = num(a.rating);
      const r = staff ?? self;
      if (r === null) return unknown("Driver rating not provided");
      const shot = Boolean(a.profile_screenshot_url) || d.has("driver_profile_screenshot");
      const evidence = staff !== null || d.verified("driver_profile_screenshot") ? "staff_verified" : shot ? "document" : "self_reported";
      if (r < 4.5) return attention(`Rating ${r}`, evidence);
      const band = r >= 4.9 ? 1 : r >= 4.7 ? 0.75 : 0.5;
      return positive(`Rating ${r}`, evidence, band);
    }
  },
  {
    key: "tenure",
    remedy: "interview",
    label: "Platform tenure",
    group: "Gig work",
    weight: 3,
    evaluate: (_a, s) => {
      const m = num(s.months_on_platform);
      if (m === null) return unknown("Time on platform not established");
      if (m < 3) return attention(`${m} months on platform`, "staff_verified");
      return positive(`${m} months on platform`, "staff_verified", m >= 12 ? 1 : 0.6);
    }
  },
  {
    key: "platforms",
    remedy: "applicant",
    label: "Platform breadth",
    group: "Gig work",
    weight: 2,
    evaluate: (a, s) => {
      const fromStaff = Array.isArray(s.gig_apps) ? s.gig_apps.filter(Boolean).length : 0;
      const fromSelf = Array.isArray(a.platforms) ? a.platforms.filter(Boolean).length : 0;
      const n = fromStaff || fromSelf;
      if (!n) return unknown("Platforms not listed");
      const evidence = fromStaff ? "staff_verified" : "self_reported";
      return positive(
        `${n} platform${n === 1 ? "" : "s"}`,
        evidence,
        n >= 3 ? 1 : n === 2 ? 0.7 : 0.4
      );
    }
  },
  // ---- Licence ---------------------------------------------------------- 18
  {
    key: "license_valid",
    remedy: "applicant",
    label: "Licence valid",
    group: "Licence",
    weight: 10,
    evaluate: (a, s) => {
      const staff = bool(s.license_active);
      if (staff === true) return positive("Licence confirmed active", "staff_verified");
      if (staff === false) return attention("Licence not active", "staff_verified");
      const self = bool(a.license_valid);
      if (self === true) return positive("Licence reported valid", "self_reported");
      if (self === false) return attention("Licence reported invalid", "self_reported");
      return unknown("Licence status not provided");
    }
  },
  {
    key: "license_doc",
    remedy: "request_document",
    label: "Licence on file",
    group: "Licence",
    weight: 4,
    evaluate: (a, _s, d) => {
      const onFile = Boolean(a.license_photo_url) || d.has("license_front") || d.has("license_back");
      if (!onFile) return unknown("No licence image");
      return d.verified("license_front") || d.verified("license_back") ? positive("Licence image checked by staff", "staff_verified") : positive("Licence image on file", "document");
    }
  },
  {
    key: "license_tenure",
    remedy: "interview",
    label: "Years licensed",
    group: "Licence",
    weight: 4,
    evaluate: (a, s) => {
      const y = num(s.license_years) ?? num(a.years_licensed);
      if (y === null) return unknown("Years licensed not provided");
      const evidence = num(s.license_years) !== null ? "staff_verified" : "self_reported";
      if (y < 2) return attention(`${y} years licensed`, evidence);
      return positive(`${y} years licensed`, evidence, y >= 5 ? 1 : 0.7);
    }
  },
  // ---- Insurance -------------------------------------------------------- 17
  {
    key: "insurance_cover",
    remedy: "applicant",
    label: "Insurance cover",
    group: "Insurance",
    weight: 8,
    evaluate: (a, s) => {
      const has = bool(s.has_personal_insurance);
      const active = bool(s.policy_active);
      if (has === true && active === true)
        return positive("Policy confirmed active", "staff_verified");
      if (has === true && active === false) return attention("Policy not active", "staff_verified");
      if (has === false) return attention("No personal insurance", "staff_verified");
      const self = bool(a.full_coverage_insurance);
      if (self === true)
        return positive(
          "Full coverage declared",
          a.insurance_doc_url ? "document" : "self_reported"
        );
      if (self === false) return attention("No full coverage", "self_reported");
      if (a.insurance_answer === "not_sure")
        return unknown("Applicant unsure whether they have full coverage");
      return unknown("Insurance not provided");
    }
  },
  {
    key: "insurance_doc",
    remedy: "request_document",
    label: "Insurance document",
    group: "Insurance",
    weight: 4,
    evaluate: (a, s, d) => {
      if (bool(s.insurance_verified) === true || d.verified("insurance_card"))
        return positive("Insurance verified by staff", "staff_verified");
      if (a.insurance_doc_url || d.has("insurance_card"))
        return positive("Insurance document on file", "document");
      return unknown("No insurance document");
    }
  },
  {
    key: "rideshare_endorsement",
    remedy: "applicant",
    label: "Rideshare endorsement",
    group: "Insurance",
    weight: 3,
    evaluate: (a, s) => {
      const st = bool(s.rideshare_endorsement);
      if (st === true) return positive("Rideshare endorsement confirmed", "staff_verified");
      if (st === false) return attention("No rideshare endorsement", "staff_verified");
      const self = bool(a.insurance_rideshare_endorsement);
      if (self === true) return positive("Rideshare endorsement reported", "self_reported");
      if (self === false) return attention("No rideshare endorsement", "self_reported");
      return unknown("Endorsement not established");
    }
  },
  {
    key: "insurance_name",
    remedy: "verify",
    label: "Policy name matches",
    group: "Insurance",
    weight: 2,
    evaluate: (_a, s) => {
      const m = bool(s.insurance_name_matches_license);
      if (m === true) return positive("Policy name matches licence", "staff_verified");
      if (m === false) return attention("Policy name does not match licence", "staff_verified");
      return unknown("Name match not checked");
    }
  },
  // ---- Driving history — all four are staff-only, all four stay unknown
  //      until somebody asks. Nothing here may be inferred from a null. -- 20
  {
    key: "dui",
    remedy: "interview",
    label: "DUI history",
    group: "Driving history",
    weight: 7,
    evaluate: (_a, s) => {
      const d = bool(s.has_dui);
      if (d === false) return positive("No DUI on record", "staff_verified");
      if (d === true) return attention("DUI on record", "staff_verified");
      return unknown("DUI history not checked");
    }
  },
  {
    key: "violations",
    remedy: "interview",
    label: "Major violations",
    group: "Driving history",
    weight: 5,
    evaluate: (_a, s) => {
      const v = bool(s.major_violations);
      if (v === false) return positive("No major violations", "staff_verified");
      if (v === true) return attention("Major violations on record", "staff_verified");
      return unknown("Violations not checked");
    }
  },
  {
    key: "accidents",
    remedy: "interview",
    label: "Recent accidents",
    group: "Driving history",
    weight: 5,
    evaluate: (_a, s) => {
      const n = num(s.accidents_last_3yr);
      if (n === null) return unknown("Accident history not checked");
      if (n === 0) return positive("No accidents in 3 years", "staff_verified");
      return attention(`${n} accident${n === 1 ? "" : "s"} in 3 years`, "staff_verified");
    }
  },
  {
    key: "points",
    remedy: "interview",
    label: "Licence points",
    group: "Driving history",
    weight: 3,
    evaluate: (_a, s) => {
      const n = num(s.license_points);
      if (n === null) return unknown("Licence points not checked");
      if (n === 0) return positive("No licence points", "staff_verified");
      return n <= 3 ? positive(`${n} licence points`, "staff_verified", 0.4) : attention(`${n} licence points`, "staff_verified");
    }
  },
  // ---- Commitment and ability to transact ------------------------------- 15
  {
    key: "drive_type",
    remedy: "interview",
    label: "Driving commitment",
    group: "Commitment",
    weight: 4,
    evaluate: (a, s) => {
      const t = s.drive_type;
      if (t === "full_time") return positive("Full-time driver", "staff_verified");
      if (t === "part_time") return positive("Part-time driver", "staff_verified", 0.5);
      const self = a.drive_type;
      if (self === "full_time") return positive("Full-time driver", "self_reported");
      if (self === "part_time") return positive("Part-time driver", "self_reported", 0.5);
      return unknown("Full or part time not established");
    }
  },
  {
    key: "timing",
    remedy: "applicant",
    label: "Vehicle timing",
    group: "Commitment",
    weight: 4,
    evaluate: (a, s) => {
      const target = typeof s.needed_by_date === "string" ? Date.parse(s.needed_by_date) : NaN;
      if (Number.isFinite(target)) {
        const days = Math.ceil((target - now()) / 864e5);
        if (days >= 0 && days <= 14)
          return positive(`Needs a vehicle within ${days} days`, "staff_verified");
        if (days > 14) return positive("Has a target date", "staff_verified", 0.5);
      }
      const wanted = typeof a.pickup_date === "string" ? Date.parse(a.pickup_date) : NaN;
      if (Number.isFinite(wanted)) {
        const days = Math.ceil((wanted - now()) / 864e5);
        if (days >= 0 && days <= 14)
          return positive(`Wants to start within ${days} days`, "self_reported");
        if (days > 14) return positive("Has a start date in mind", "self_reported", 0.5);
      }
      const t = a.start_timing;
      if (t === "Today" || t === "This week")
        return positive(`Wants to start ${String(t).toLowerCase()}`, "self_reported");
      if (t === "Within 2 weeks")
        return positive("Wants to start within 2 weeks", "self_reported", 0.6);
      if (t === "Just checking options") return attention("Just checking options", "self_reported");
      return unknown("Timing not provided");
    }
  },
  {
    key: "payment_ready",
    remedy: "interview",
    label: "Payment method",
    group: "Commitment",
    weight: 4,
    evaluate: (a, s) => {
      const own = bool(s.card_in_own_name);
      if (own === false) return attention("Card not in driver's name", "staff_verified");
      if (a.card_last4 || a.card_on_file_at) return positive("Card on file", "document");
      if (own === true) return positive("Card confirmed in own name", "staff_verified");
      return unknown("No payment method yet");
    }
  },
  {
    key: "rate_confirmed",
    remedy: "interview",
    label: "Rate agreed",
    group: "Commitment",
    weight: 3,
    evaluate: (_a, s) => {
      const r = bool(s.rate_confirmed);
      if (r === true) return positive("Rate confirmed", "staff_verified");
      if (r === false) return attention("Rate not accepted", "staff_verified");
      return unknown("Rate not discussed");
    }
  }
];
var TOTAL_WEIGHT = FACTORS.reduce((a, f) => a + f.weight, 0);
function findDisqualifiers(a, s) {
  const out = [];
  const age = num(s.driver_age);
  if (age !== null && age < 21) out.push("Driver under 21");
  if (bool(s.license_active) === false) out.push("Licence not active");
  if (bool(s.has_dui) === true) out.push("DUI on record");
  if (s.gig_account_status === "deactivated") out.push("Gig account deactivated");
  if (bool(s.card_in_own_name) === false) out.push("Payment card not in driver's name");
  if (bool(s.has_personal_insurance) === true && bool(s.insurance_name_matches_license) === false) {
    out.push("Insurance name does not match licence");
  }
  if (bool(a.license_valid) === false) out.push("Licence reported invalid");
  return out;
}
var THRESHOLDS = {
  /**
   * Enough of the picture for an authorised human to decide.
   *
   * PROVISIONAL. No applicant in company history reaches 60% coverage, so no
   * real row has ever exercised this threshold — it rests on judgement, not on
   * evidence. Revisit after roughly ten applicants have been through the
   * improved interview workflow.
   */
  READY_COVERAGE: 60,
  /** Strong enough, of what is known, to be worth a decision. */
  READY_QUALIFICATION: 75,
  /**
   * Below this, "promising" is just a small sample of good answers.
   * 20 rather than 25 because the real applicants cluster at 14% and 24%:
   * a floor of 25 would turn on a single percentage point, a floor of 20
   * sits in the empty gap between the two clusters and does not move if
   * somebody answers one more question.
   */
  PROMISING_COVERAGE: 20,
  /** Strong enough, of what is known, to be worth chasing. */
  PROMISING_QUALIFICATION: 75,
  /**
   * Concern needs evidence too. Below this coverage a low qualification is a
   * thin sample, not a bad applicant, so it reads as More Info Needed rather
   * than Needs Attention. A critical concern raises the flag at any coverage.
   *
   * PROVISIONAL, for the same reason as READY_COVERAGE: no applicant on file
   * has a recorded concern, so nothing has ever tested this branch. Revisit
   * alongside READY_COVERAGE.
   */
  ATTENTION_COVERAGE: 40,
  ATTENTION_QUALIFICATION: 50
};
function computeReadiness(app, screening = null, documents = []) {
  const s = screening ?? {};
  const d = indexDocuments(documents);
  const factors = FACTORS.map((f) => {
    const v = f.evaluate(app, s, d);
    const earned2 = v.state === "positive" ? f.weight * (v.partial ?? 1) : 0;
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      weight: f.weight,
      state: v.state,
      evidence: v.evidence ?? null,
      earned: Math.round(earned2 * 100) / 100,
      detail: v.detail,
      remedy: f.remedy
    };
  });
  const known = factors.filter((f) => f.state !== "unknown");
  const knownWeight = known.reduce((a, f) => a + f.weight, 0);
  const earned = known.reduce((a, f) => a + f.earned, 0);
  const verifiedWeight = known.filter((f) => f.evidence === "document" || f.evidence === "staff_verified").reduce((a, f) => a + f.weight, 0);
  const qualification = knownWeight > 0 ? earned / knownWeight * 100 : null;
  const coverage = knownWeight / TOTAL_WEIGHT * 100;
  const verifiedCoverage = verifiedWeight / TOTAL_WEIGHT * 100;
  const disqualifiers = findDisqualifiers(app, s);
  const state = classify(qualification, coverage, disqualifiers.length);
  const byWeight = (x, y) => y.weight - x.weight || y.earned - x.earned;
  const attentionList = factors.filter((f) => f.state === "attention").sort(byWeight);
  return {
    qualification: qualification === null ? null : Math.round(qualification),
    coverage: Math.round(coverage),
    verifiedCoverage: Math.round(verifiedCoverage),
    state,
    stateLabel: STATE_LABEL[state],
    factors,
    positives: factors.filter((f) => f.state === "positive").sort(byWeight),
    attention: attentionList,
    unknowns: factors.filter((f) => f.state === "unknown").sort(byWeight),
    disqualifiers
  };
}
function classify(qualification, coverage, criticalCount) {
  if (criticalCount > 0) return "needs_attention";
  if (qualification === null) {
    return "more_info_needed";
  }
  if (coverage >= THRESHOLDS.ATTENTION_COVERAGE && qualification < THRESHOLDS.ATTENTION_QUALIFICATION) {
    return "needs_attention";
  }
  if (coverage >= THRESHOLDS.READY_COVERAGE && qualification >= THRESHOLDS.READY_QUALIFICATION) {
    return "decision_ready";
  }
  if (coverage >= THRESHOLDS.PROMISING_COVERAGE && qualification >= THRESHOLDS.PROMISING_QUALIFICATION) {
    return "promising_more_info";
  }
  return "more_info_needed";
}
var STATE_LABEL = {
  needs_attention: "Needs Attention",
  decision_ready: "Decision Ready",
  promising_more_info: "Promising \u2014 More Info Needed",
  more_info_needed: "More Info Needed"
};

// src/lib/readiness-index.ts
function byLead(rows) {
  const out = /* @__PURE__ */ new Map();
  for (const r of rows ?? []) {
    const id = r?.lead_id;
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(r);
    else out.set(id, [r]);
  }
  return out;
}
function buildReadinessIndex(applications, screenings, documents) {
  const screeningByLead = byLead(screenings);
  const docsByLead = byLead(documents);
  const index = /* @__PURE__ */ new Map();
  for (const app of applications) {
    const id = app?.id;
    if (!id) continue;
    index.set(
      id,
      computeReadiness(app, screeningByLead.get(id)?.[0] ?? null, docsByLead.get(id) ?? [])
    );
  }
  return index;
}
var READINESS_APPLICATION_COLUMNS = [
  "id",
  "platforms",
  "trips_completed",
  "rating",
  // start_timing is the retired question; pickup_date is what Part 1 asks.
  // Both are read, the date first.
  "start_timing",
  "pickup_date",
  "drive_type",
  "license_valid",
  "license_photo_url",
  "years_licensed",
  "full_coverage_insurance",
  "insurance_answer",
  "insurance_doc_url",
  "insurance_rideshare_endorsement",
  "profile_screenshot_url",
  "trip_screenshots",
  "gig_status"
];
var READINESS_SCREENING_COLUMNS = [
  "lead_id",
  "gig_account_status",
  "months_on_platform",
  "trip_count",
  "driver_rating",
  "drive_type",
  "license_active",
  "license_years",
  "driver_age",
  "has_personal_insurance",
  "policy_active",
  "insurance_name_matches_license",
  "rideshare_endorsement",
  "accidents_last_3yr",
  "has_dui",
  "major_violations",
  "license_points",
  "insurance_verified",
  "card_in_own_name",
  "rate_confirmed",
  "needed_by_date"
];
var READINESS_APPLICATION_SELECT = READINESS_APPLICATION_COLUMNS.join(",");
var READINESS_SCREENING_SELECT = READINESS_SCREENING_COLUMNS.join(",");
var READINESS_DOCUMENT_SELECT = "lead_id:driver_id,category,review_status,is_current";

// src/lib/admin-overview.functions.ts
var getAdminNotifications = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireStaff(context.userId);
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_stub_sb(), stub_sb_exports));
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString();
  const { data, error } = await supabaseAdmin2.from("applications").select(NOTIFICATION_SELECT).is("deleted_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(15);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Notification data unavailable");
  const pay = await supabaseAdmin2.from("notifications").select("id,title,body,created_at").is("driver_id", null).is("user_id", null).is("partner_id", null).in("title", [...PAYMENT_ALERT_TITLES]).gte("created_at", since).order("created_at", { ascending: false }).limit(15);
  if (pay.error) throw new Error(pay.error.message);
  const apps = (data ?? []).map(projectNotification).filter((r) => r !== null);
  const payments = (pay.data ?? []).map(projectPaymentAlert).filter((r) => r !== null);
  return { rows: mergeAdminNotifications(apps, payments) };
});
var getOverviewApplicants = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const actor = await requireStaff(context.userId);
  const canSeeReadiness = tierAllows(actor.tier, "manager");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_stub_sb(), stub_sb_exports));
  const [newAppsQ, pendingAppsQ, appsQ] = await Promise.all([
    // New = finished the wizard AND nobody has opened it. Status alone
    // would keep counting work somebody already read and left alone.
    supabaseAdmin2.from("applications").select("id", { count: "exact", head: true }).eq("status", "new").is("reviewed_at", null).is("deleted_at", null),
    supabaseAdmin2.from("applications").select("id", { count: "exact", head: true }).eq("status", "partial").is("deleted_at", null),
    supabaseAdmin2.from("applications").select(canSeeReadiness ? `${OVERVIEW_APPLICANT_SELECT},${READINESS_APPLICATION_SELECT}` : OVERVIEW_APPLICANT_SELECT).neq("status", "duplicate").is("deleted_at", null).order("created_at", { ascending: false }).limit(APPLICANT_WINDOW)
  ]);
  for (const q of [newAppsQ, pendingAppsQ, appsQ]) {
    if (q.error) throw new Error(q.error.message);
  }
  if (!Number.isSafeInteger(newAppsQ.count) || newAppsQ.count < 0 || !Number.isSafeInteger(pendingAppsQ.count) || pendingAppsQ.count < 0 || !appsQ.data) {
    throw new Error("Application counts or data unavailable");
  }
  const rows = appsQ.data ?? [];
  const applicants = rows.map(projectOverviewApplicant).filter((r) => r !== null);
  let readiness = {};
  if (canSeeReadiness) {
    const [screeningsQ, leadDocsQ] = await Promise.all([
      supabaseAdmin2.from("driver_screenings").select(READINESS_SCREENING_SELECT),
      supabaseAdmin2.from("documents").select(READINESS_DOCUMENT_SELECT).not("driver_id", "is", null)
    ]);
    for (const q of [screeningsQ, leadDocsQ]) {
      if (q.error) throw new Error(q.error.message);
      if (!q.data) throw new Error("Readiness evidence unavailable");
    }
    const index = buildReadinessIndex(
      rows,
      screeningsQ.data ?? [],
      leadDocsQ.data ?? []
    );
    readiness = Object.fromEntries(index);
  }
  return {
    newApps: newAppsQ.count,
    pendingApps: pendingAppsQ.count,
    applicants,
    readiness,
    canSeeReadiness
  };
});
export {
  getAdminNotifications,
  getOverviewApplicants
};
