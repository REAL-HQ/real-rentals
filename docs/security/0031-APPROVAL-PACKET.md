# Security 0031 — final installation approval packet

Prepared 2026-10-23 by Claude Code. Package `32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`,
verified and unmodified at `docs/security/0031-package/`.

> ## VERDICT: NO-GO for execution.
> Executor authority for the one `storage.objects` policy is **unverified**
> (§2). Everything else is ready. **Nothing was executed.**

---

## 1. Execution route

**The Supabase migrations mechanism** — one new file under
`supabase/migrations/`, containing the package verbatim.

Evidence it is the right route: `supabase_migrations.schema_migrations` holds
**105** receipts; the Oct 7 migration `20261007034524` was recorded
`created_by = apikey@lovable.dev` as a **single statement** whose stored text is
byte-identical to the repo file (`9285a2ea…`, 4,162 bytes) and which created two
`storage.objects` policies that exist today. The drizzle route is excluded: the
Lovable deploy does not run it.

The package is one `DO $rr0031$ … $rr0031$;` block — one statement, as that
route requires.

## 2. Executor authority — **UNVERIFIED. This is the blocker.**

The package needs `current_user = postgres` **and** authority to
`CREATE POLICY ON storage.objects`.

| | |
|---|---|
| `current_user = postgres` | satisfied on every path I can read |
| Authority over `storage.objects` | **not established** |

Read-only, today: `postgres` is **not** superuser; `storage.objects` is owned by
`supabase_storage_admin`, which has **zero members**; `postgres` has no `CREATE`
on the `storage` schema. On that evidence it **cannot**.

Against that: the Oct 7 migration did create two such policies through this
route. Two explanations fit — the executor was not `postgres` and ownership of
its new table was normalized afterwards, or `postgres` held privileges since
revoked — and **no read-only operation distinguishes them**, because
`created_by` is an API identity, not a role.

**If executed without this resolved** and the authority is absent, the result is
a clean failure: `ERROR: must be owner of table objects`, the whole statement
aborts, **zero policies installed, nothing changed** (§5, proven). The risk is a
wasted migration version, not damage. That is still not a reason to execute.

## 3. Atomicity of all five policies

One statement, one transaction. In order inside the single `DO` block:

1. Target, checksum, journal, partial-install, RLS, role-helper and catalog
   gates.
2. `pg_advisory_xact_lock(7310031)`; `LOCK TABLE drizzle.__drizzle_migrations
   EXCLUSIVE`; `LOCK TABLE` the five relations `SHARE UPDATE EXCLUSIVE`
   (`postgres` holds `MAINTAIN`/`UPDATE`/`DELETE`/`TRUNCATE` on
   `storage.objects`, so this lock succeeds); `LOCK TABLE public.audit_log
   SHARE ROW EXCLUSIVE`.
3. `EXECUTE approved_sql` — **all five** `CREATE POLICY` statements.
4. Post-checks, then exactly one `audit_log` evidence row.

`lock_timeout 5s`, `statement_timeout 30s`. Any failure anywhere aborts
everything, including the four policies already created in step 3.

**Proven, not assumed:** in a disposable cluster modelling the production
privilege shape, a role without storage-owner membership creates four policies,
fails on the fifth, and leaves **0** behind.

## 4. Expected receipts

| Ledger | Before | After |
|---|---|---|
| `supabase_migrations.schema_migrations` | 105 | **106** (one new version row) |
| `drizzle.__drizzle_migrations` | 23 | **23 — unchanged** |

You have accepted this. Both journal pins require exactly the 23 rows *during*
the statement, which holds, so `JOURNAL_DRIFT_OR_REPLAY` and
`POST_JOURNAL_CHANGED` both pass. 0031 gets no drizzle receipt; replay stays
protected by `PARTIAL_INSTALL` and `EXECUTION_EVIDENCE_REPLAY` instead.

**Precondition:** drizzle `0023` must not be applied first — it would move the
ledger to 24 and both pins would fail. It is pending today.

## 5. Failure and rollback without partial installation

Refusals, each aborting the whole statement with nothing applied:

| Stage | Guards |
|---|---|
| Before DDL | `UNSEALED_TARGET_PROFILE`, `TARGET_MISMATCH`, `SQL_CHECKSUM_MISMATCH`, `JOURNAL_DRIFT_OR_REPLAY`, `PARTIAL_INSTALL`, `RLS_MISMATCH`, `ROLE_HELPER_DRIFT`, `SCHEMA_POLICY_GRANT_DRIFT`, `AUDIT_CATALOG_DRIFT`, `AUDIT_INSERT_UNAVAILABLE` |
| After DDL | `POST_POLICY_MISMATCH` (all five compared byte-exactly), `POST_JOURNAL_CHANGED`, `POST_UNEXPECTED_CATALOG_CHANGE` (only the five policies may differ — grants, columns, owners and helpers must be identical) |
| Evidence | `EXECUTION_EVIDENCE_REPLAY`, `EXECUTION_EVIDENCE_MISMATCH` |

Partial installation is impossible by construction: `PARTIAL_INSTALL` refuses to
start if any of the five already exist, and a mid-transaction failure discards
the rest.

**Verified in a disposable cluster** (`scripts/0031-feasibility/`, 16/16): a
privilege failure on the fifth policy leaves 0; rollback removes all five,
leaves the ledger at 23 and RLS enabled on all five relations.

**All ten pre-flight gates pass against production today**, recomputed
read-only — including the catalog seal, which still hashes to
`c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446`.

## 6. Post-install verification and rollback checkpoint

### Verify (read-only, immediately after)

```sql
-- 1. Five policies, all RESTRICTIVE SELECT for authenticated. Expect 5.
SELECT schemaname, tablename, policyname, permissive, cmd, roles
FROM pg_policies
WHERE policyname IN ('coordinator_application_containment','coordinator_review_containment',
  'coordinator_document_containment','coordinator_identity_storage_containment',
  'coordinator_agreement_containment')
ORDER BY policyname;

-- 2. storage.objects restrictive count: expect 0 -> 1.
SELECT count(*) FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND permissive='RESTRICTIVE';

-- 3. Exactly one evidence row.
SELECT count(*) FROM public.audit_log
WHERE action='security_migration_verified' AND entity_type='database_migration'
  AND entity_id='0031_coordinator_containment';

-- 4. Ledgers: expect 106 and 23.
SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations) AS supabase,
       (SELECT count(*) FROM drizzle.__drizzle_migrations)          AS drizzle;
```

Expected: 5 rows / 1 / 1 / (106, 23). Anything else → roll back.

### Functional check — the one to do by hand

Sign in as a **Coordinator**: identity documents and the four identity buckets
must be unreadable. Sign in as **Owner** and as **Manager**: nothing they could
do before may now be refused.

### Rollback checkpoint

Roll back if any verification value differs, or if an Owner or Manager loses
access. One statement, nothing else touched:

```sql
DROP POLICY IF EXISTS coordinator_application_containment ON public.applications;
DROP POLICY IF EXISTS coordinator_review_containment      ON public.application_identity_reviews;
DROP POLICY IF EXISTS coordinator_document_containment    ON public.documents;
DROP POLICY IF EXISTS coordinator_agreement_containment   ON public.agreements;
DROP POLICY IF EXISTS coordinator_identity_storage_containment ON storage.objects;
```

No grants, ownership, RLS flags or data are touched by install or rollback, so
rollback cannot lose data. The `audit_log` evidence row stays by design — the
log is immutable — and does **not** block a later retry: the replay guard keys
on that row, so a re-install after rollback would raise
`EXECUTION_EVIDENCE_REPLAY` and must be approved as a fresh decision.

---

## What this needs from you

1. **Resolve §2** — the executor's authority over `storage.objects`. Without it
   this stays NO-GO.
2. **Then** approve execution, if you want it attempted.

## Standing context

The fifth policy is **durability, not current closure**. All four identity
buckets' permissive SELECT policies already resolve to Owner-only, so
Coordinators cannot read identity objects today. This keeps that true if a
future permissive policy is added. Important; not urgent.

**0031 investigation stops here** unless new evidence materially changes §2.
