
const S = () => globalThis.__dl;
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
    order: () => api, limit: () => api,
    then: (res, rej) => {
      const rows = (S().db[name] ?? []).filter((r) =>
        filters.every(([c, v]) =>
          c.startsWith("!")
            ? r[c.slice(1)] !== v
            : c.startsWith("=")
              ? (r[c.slice(1)] ?? null) === v
              : r[c] === v,
        ),
      );
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res, rej);
    },
    maybeSingle: async () => ({ data: (S().db[name] ?? [])[0] ?? null, error: null }),
  };
  return api;
}
export const supabaseAdmin = {
  from: table,
  auth: { admin: { getUserById: async (id) => ({ data: { user: { email: S().emails[id] ?? null } } }) } },
};
export const supabase = supabaseAdmin;
export default supabaseAdmin;
