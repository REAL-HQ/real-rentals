# M2 rehearsal — environment provisioned, replay in progress

2026-10-23. **Status: IN PROGRESS. Not a GO/NO-GO.** The environment exists and
its fidelity is proven; the baseline replay is 4 of 122 migrations in.

No production SQL was executed. No production credential, Stripe key or
customer record was used or copied. One **read-only** catalog query was run
against production, recorded in section 4.

## 1. The environment

| | |
|---|---|
| Lovable project | `c27f585c-ae1a-4ca2-b61f-a0d29c170f64` |
| Workspace | `cGRWl46NvDMHQ0QKwl9X` ("My Lovable") |
| Database | Supabase, provisioned by `enable_database` |
| Access | `query_database` only — no connection string is exposed |

**Isolation.** Production is a different Lovable project in a **different**
workspace, on a different Supabase project. The rehearsal project was created
fresh, and at provisioning held **0 public tables, 0 `auth.users`, 0
`storage.objects`, no `rr_%` role** and none of the packet's objects. Production
has 142 applications and 10 vehicles. They cannot be confused.

## 2. Fidelity — why this is a real hosted rehearsal

| HOSTED-INSTALL pre-check | Rehearsal | Production |
|---|---|---|
| `SHOW server_version` | **17.11** | 17.6 |
| `storage.objects.version` is `text` | **yes** | yes |
| `storage.objects.user_metadata` is `jsonb` | **yes** | yes |
| `postgres` is superuser or BYPASSRLS | **not superuser, BYPASSRLS true** | identical |
| `postgres` holds CREATE on `public` | **yes** | yes |

All six Supabase schemas (`auth`, `storage`, `extensions`, `graphql_public`,
`realtime`, `vault`) and all six Supabase roles are present, and
`storage.objects` has its real 15-column shape.

**Better than the preserved vanilla rehearsal in two ways that matter:**

- `pg_net`, `pg_cron` and `pg_graphql` are **available and installed**. The
  vanilla replay had to strip those `CREATE EXTENSION` lines.
- `pgcrypto` is in `extensions`, so `extensions.digest` works — which
  `scripts/m2-content-sha.test.ts` needs and skipped locally.

**Both runbook transaction modes are reproducible.** `query_database` accepts
multi-statement batches and explicit transactions, proven with a `BEGIN /
CREATE TABLE / ROLLBACK` probe that genuinely rolled back. So a `-1` packet file
runs as `BEGIN; <file> COMMIT;` and an own-transaction file runs verbatim.

## 3. Replay progress — 4 of 122, and what was deliberately omitted

Applied: the DDL of migrations 1, 2, 4 and 5, plus one `storage.objects` policy
from migration 3 (as a privilege probe, section 4).

Current state: **5 tables** (`applications`, `contact_leads`, `investor_leads`,
`user_roles`, `vehicles`), **11 public policies**, 1 storage policy, 1 public
function (`has_role`), **0 rows**.

**Omitted on purpose, and this must not be forgotten:**

- The demo-vehicle seed `INSERT` in migration 1, and the `UPDATE` statements in
  migrations 4 and 6. The authorization is synthetic data only, and the
  rehearsal will get purpose-built synthetic rows instead. **These are data
  statements, not schema**, so the baseline schema is unaffected — but any
  later claim of a "full faithful replay" has to exclude them explicitly.

**118 migrations remain.** The channel is the constraint: there is no
connection string, so every statement is relayed through tool arguments. The
remaining 358 KB of migrations plus the 257 KB packet is mechanical but long,
and the per-step verify queries are what will catch any relay error — a
corrupted statement shows up as a failed verification, which fails the
rehearsal by the rule you set.

## 4. Security 0031 — the blocker looks like a misdiagnosis

This came out of a privilege probe on the rehearsal project and is the most
consequential thing found today.

0031 has been blocked all along on the conclusion that the production executor
cannot create policies on `storage.objects`, because `CREATE POLICY` needs
superuser or table ownership and `BYPASSRLS` does not grant it.

**On the rehearsal project, `CREATE POLICY ... ON storage.objects` succeeded** —
with these facts:

| | Rehearsal | Production (read-only query) |
|---|---|---|
| `storage.objects` owner | `supabase_storage_admin` | `supabase_storage_admin` |
| Members of `supabase_storage_admin` | **none** | **none** |
| `postgres` CREATE on `storage` schema | **no** | **no** |
| `postgres` UPDATE on `storage.objects` | yes | yes |
| `postgres` in `supabase_privileged_role` | **yes** | **yes** |
| Existing `storage.objects` policies | 1 (the one just created) | 24 |
| Server version | 17.11 | 17.6 |

So the privilege that matters is almost certainly membership in
**`supabase_privileged_role`**, which production's `postgres` also holds — and
the earlier reasoning did not account for it.

**This does not yet prove production can do it.** The versions differ (17.11 vs
17.6) and only an attempt on production settles it.

**The bounded check, which needs your approval and which I have not run:** on
production, inside an explicit transaction, `CREATE POLICY` a throwaway policy
on `storage.objects` and then `ROLLBACK`. It persists nothing and leaves no
policy behind; it only answers whether the privilege exists. It is still a write
attempt against production, so it is yours to authorize.

## 5. What remains before any GO/NO-GO

1. Relay the remaining 118 migrations, then
   `proposed/rehearsal/drizzle-prerequisites.sql`.
2. Fail loudly if the baseline is empty or any of the three Drizzle objects is
   missing.
3. `scripts/m2-hosted-preflight.ts` — every line `PASS`.
4. Steps 1 – 29 with every per-step verify returning `t`.
5. The reduced path's `proposed/m2-verify/step29-after-step25.sql`.
6. `proposed/m2-verify/no-executor-create.sql` returning `t`.
7. All rollbacks in reverse, back to the baseline catalog.
8. The ten validation areas, with synthetic rows only.

Two of the ten cannot be reached through `query_database` alone and need to be
reported as such rather than claimed: the **real Storage API upload path**
(`info()` and `download()`, which the content-hash merge binds to) and a true
**PostgREST JWT round trip**, including the schema-cache reload after step 3.
Manager and Coordinator boundaries can be exercised with `SET LOCAL ROLE` plus
`request.jwt.claims`, which is how Supabase RLS is normally tested, and that
distinction will be stated in the final report.
