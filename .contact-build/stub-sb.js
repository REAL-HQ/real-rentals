
// Read through on every call, never captured: reset() installs a NEW world
// between scenarios, and a stub holding the first one reported writes against
// a database nobody was looking at any more.
const S = () => globalThis.__contact;
function table(name) {
  const filters = [];
  let cap, payload = null, kind = "select";
  const rows = () => {
    const all = (S().db[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    return cap == null ? all : all.slice(0, cap);
  };
  const result = () => {
    // failWith stands for the database refusing THIS table — a missing column
    // on applications. Applying it to user_roles too would refuse the tier
    // lookup first, and the test would be watching the wrong refusal.
    if (S().failWith && name === "applications") return { data: null, error: S().failWith };
    if (kind === "update") {
      const hit = rows();
      S().writes.push({ table: name, patch: payload, ids: hit.map((r) => r.id) });
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (kind === "insert") {
      S().inserts.push({ table: name, row: payload });
      (S().db[name] ??= []).push(payload);
      return { data: [payload], error: null };
    }
    // Copies. A real select hands back a snapshot; handing back the live row
    // let the UPDATE below rewrite the "before" values under the caller, and
    // the audit entry then claimed nothing had changed.
    return { data: rows().map((r) => ({ ...r })), error: null };
  };
  const api = {
    select: () => api,
    eq: (c, v) => (filters.push([c, v]), api),
    is: (c, v) => (filters.push([c, v]), api),
    order: () => api,
    limit: (n) => ((cap = n), api),
    update: (p) => ((kind = "update"), (payload = p), api),
    insert: (p) => ((kind = "insert"), (payload = p), api),
    maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (res, rej) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}
export const supabaseAdmin = {
  from: table,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
