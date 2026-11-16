
const S = () => globalThis.__identity;
function table(name) {
  const filters = [];
  let payload = null, kind = "select", cap;
  const rows = () => {
    const all = (S().db[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    return cap == null ? all : all.slice(0, cap);
  };
  const result = () => {
    if (kind !== "select") { S().writes.push({ table: name, kind, payload }); return { data: [payload ?? {}], error: null }; }
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const api = {
    select: () => api, eq: (c, v) => (filters.push([c, v]), api), is: () => api,
    // neq/in/not/gte are no-ops here: this stub answers "who may call this",
    // not "what does PostgREST return". They exist so a permitted call runs
    // to completion — an assertion that passes on a MISSING stub method is
    // not an assertion about authorization, which is the mistake this line
    // exists to prevent.
    neq: () => api, gte: () => api, lte: () => api,
    in: () => api, not: () => api, order: () => api, limit: (n) => ((cap = n), api),
    update: (p) => ((kind = "update"), (payload = p), api),
    insert: (p) => ((kind = "insert"), (payload = p), api),
    upsert: (p) => ((kind = "upsert"), (payload = p), api),
    maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res, rej) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}
const storage = {
  from: () => ({
    createSignedUploadUrl: async (p) => ({ data: { signedUrl: "https://example.test/upload", path: p, token: "t" }, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/read" }, error: null }),
    remove: async () => ({ data: [], error: null }),
    list: async () => ({ data: [], error: null }),
  }),
};
export const supabaseAdmin = {
  from: table, storage,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
