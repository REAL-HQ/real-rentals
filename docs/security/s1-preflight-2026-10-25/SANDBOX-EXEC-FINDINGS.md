# `sandbox_exec`: read-only investigation (2026-10-25)

Two read-only catalog queries were run against production. They returned role names, counts and
normalized statement shapes (constants replaced by `$n`), and no row data. Nothing was changed.

| Question | Finding |
|---|---|
| Who can assume the role | Only `supabase_admin`, the Supabase platform role (`pg_has_role(...,'SET')`). |
| Can `postgres` assume it? | No. `postgres` holds the membership with ADMIN only (`set=false`, `inherit=false`, granted by `supabase_admin`), so it can neither switch into the role nor inherit its privileges. |
| API-facing roles | `anon`, `authenticated`, `authenticator` and `service_role` are not members and cannot SET or USE it. `authenticator` (PostgREST) can switch only to `anon`, `authenticated` and `service_role`. |
| Exposed functions | No function grants to the role. It owns no relations, functions or schemas. No function references "sandbox". No client-executable SECURITY DEFINER function performs SET ROLE, SET SESSION AUTHORIZATION or dblink. |
| Other access routes | dblink and postgres_fdw are not installed, and there are no user mappings. `pg_net` is HTTP only. There are no cron jobs running as the role. |
| Privileges | SELECT on 82 public, 16 auth, 2 storage and 2 extensions tables. INSERT on 80 public, 2 storage and 2 extensions tables. **No UPDATE, DELETE or TRUNCATE anywhere**, and no column grants. Most grants come from the platform's default privileges for `postgres` in `public`, `storage`, `auth` and `extensions`. |
| Login | LOGIN, BYPASSRLS, not superuser, no expiry. Password hashing is scram-sha-256. The credential itself cannot be read without superuser access. |
| Usage | Observed between 2026-06-13 and 2026-10-20: 1,000 calls across 484 statements. Most are psql `\d` catalog introspection; 957 are SELECTs and 12 are INSERTs. The INSERTs went to `vehicles` (4), `payments` (2), `fleet_inbox_jobs` (2), `fleet_import_batches`, `fleet_import_items`, `fleet_import_proposals` and `maintenance_records` (1 each). **There were no writes to `applications`.** This pattern matches an interactive psql or agent sandbox session, consistent with Lovable's agent tooling. |
| Repository | No reference to `sandbox_exec` anywhere in the application, migrations or configuration. |

**Conclusion.** The role is platform-managed infrastructure. It cannot be reached by application users
(anonymous visitors, drivers, Coordinators, Managers or Owners) through the API, any database function
or any role switch. Its insert ability is therefore not an application attack path. The remaining
trust boundary is whoever controls the Lovable platform sandbox for this project: Lovable itself, and
anyone who can direct the Lovable agent, i.e. workspace members with edit access. That boundary exists
equally before and after S1. S1 neither depends on the role nor changes it.

**Recommendations (owner decisions; nothing to change now):**
1. Keep Lovable workspace edit access limited to trusted staff.
2. Optionally ask Lovable support to confirm the role's purpose and credential custody, and whether its
   INSERT default privileges can be narrowed. This is not required for S1.
3. The 2 historical `payments` INSERTs by the sandbox role (dates unknown) may deserve a separate
   read-only review against the payments rules in AGENTS.md.
4. Optionally, a later S1 v2 could also cover `sandbox_exec` for application status. That is a
   platform-role decision, so it is not included in v1.
