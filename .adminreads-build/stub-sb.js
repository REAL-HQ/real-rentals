
const S = () => globalThis.__ar;
function table(name) {
  const filters = [];
  let head = false;
  const run = () => {
    const st = S();
    if (st.failWith && st.failWith.table === name) {
      return { data: null, count: null, error: { message: st.failWith.message } };
    }
    const rows = (st.db[name] ?? []).filter((r) =>
      filters.every(([c, v]) =>
        c.startsWith("!") ? r[c.slice(1)] !== v
        : c.startsWith("=") ? (r[c.slice(1)] ?? null) === v
        : c.startsWith(">") ? String(r[c.slice(1)] ?? "") >= String(v)
        : c.startsWith("*") ? (r[c.slice(1)] ?? null) !== null
        : r[c] === v,
      ),
    );
    return head
      ? { data: null, count: st.missingCount ? null : rows.length, error: null }
      : { data: rows.map((r) => ({ ...r })), count: rows.length, error: null };
  };
  const api = {
    select: (_cols, opts) => { if (opts && opts.head) head = true; return api; },
    eq: (c, v) => (filters.push([c, v]), api),
    neq: (c, v) => (filters.push(["!" + c, v]), api),
    is: (c, v) => (filters.push(["=" + c, v]), api),
    not: (c, _op, _v) => (filters.push(["*" + c, null]), api),
    gte: (c, v) => (filters.push([">" + c, v]), api),
    order: () => api,
    limit: () => api,
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return api;
}
export const supabaseAdmin = {
  from: table,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
