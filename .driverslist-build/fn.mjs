var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// .driverslist-build/stub-sb.js
var stub_sb_exports = {};
__export(stub_sb_exports, {
  default: () => stub_sb_default,
  supabase: () => supabase,
  supabaseAdmin: () => supabaseAdmin
});
function table(name) {
  const filters = [];
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    neq: (c, v) => (filters.push(["!" + c, v]), api),
    // is() is implemented, not a no-op: the real query excludes deleted
    // applicants with .is("deleted_at", null), and a stub that ignores it
    // would report a soft-deleted person as still on the list.
    is: (c, v) => (filters.push(["=" + c, v]), api),
    order: () => api,
    limit: () => api,
    then: (res, rej) => {
      const rows = (S().db[name] ?? []).filter(
        (r) => filters.every(
          ([c, v]) => c.startsWith("!") ? r[c.slice(1)] !== v : c.startsWith("=") ? (r[c.slice(1)] ?? null) === v : r[c] === v
        )
      );
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej);
    },
    maybeSingle: async () => ({ data: (S().db[name] ?? [])[0] ?? null, error: null })
  };
  return api;
}
var S, supabaseAdmin, supabase, stub_sb_default;
var init_stub_sb = __esm({
  ".driverslist-build/stub-sb.js"() {
    "use strict";
    S = () => globalThis.__dl;
    supabaseAdmin = {
      from: table,
      auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } }
    };
    supabase = supabaseAdmin;
    stub_sb_default = supabaseAdmin;
  }
});

// .driverslist-build/stub-start.js
var createServerFn = () => {
  const api = {
    middleware: () => api,
    inputValidator: (v) => (api._v = v, api),
    handler: (fn) => (args) => fn({ ...args, data: api._v ? api._v(args?.data) : args?.data })
  };
  return api;
};

// .driverslist-build/stub-auth.js
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

// src/lib/drivers-list.ts
var COORDINATOR_LIST_FIELDS = [
  "id",
  // Who to call, and how.
  "full_name",
  "phone",
  "email",
  "city",
  "state",
  // Where the paperwork stands — the label the list already shows. A
  // lifecycle status is not identity data.
  "status",
  // When it arrived, and whether anybody has reached them yet.
  "created_at",
  "contacted_at",
  // Grouping: the duplicate badge and the collapsed history rows.
  "primary_application_id",
  "resubmission_count",
  "deleted_at",
  // Which car they are being considered for. An id, not a document.
  "vehicle_id",
  // The marketing source chip.
  "gclid",
  "utm_campaign",
  // Contact Status itself, which is the whole point of the screen.
  "contact_status",
  "contact_status_note",
  "contact_follow_up_on",
  "contact_status_at",
  "contact_status_by"
];
function projectDriverRow(row, canSeeSensitive) {
  if (canSeeSensitive) return row;
  const out = { ...row };
  for (const f of COORDINATOR_LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  }
  return out;
}

// src/lib/drivers-list.functions.ts
var listDriverRows = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const actor = await requireStaff(context.userId);
  const canSeeSensitive = tierAllows(actor.tier, "manager");
  const { supabaseAdmin: supabaseAdmin2 } = await Promise.resolve().then(() => (init_stub_sb(), stub_sb_exports));
  const { data, error } = await supabaseAdmin2.from("applications").select("*").neq("status", "duplicate").is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []).map((r) => projectDriverRow(r, canSeeSensitive)),
    canSeeSensitive
  };
});
export {
  listDriverRows
};
