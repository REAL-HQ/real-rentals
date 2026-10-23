# Security 0031 — final installation approval packet

Prepared 2026-10-23 by Claude Code. Package `32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f`,
verified and unmodified at `docs/security/0031-package/`.

> ## VERDICT: the authority blocker is RESOLVED. Execution still needs your approval.
> The one thing that held this packet — executor authority over
> `storage.objects` — is **settled** (§2, §2a). `postgres` holds that authority
> through Supabase's `supautils.policy_grants`, confirmed on production by
> read-only query. Route, receipts, journal, rollback and verification are
> unchanged and still ready. **Nothing was executed.**

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

## 2. Executor authority — **RESOLVED**

The package needs `current_user = postgres` **and** authority to
`CREATE POLICY ON storage.objects`.

| | |
|---|---|
| `current_user = postgres` | satisfied on every path I can read |
| Authority over `storage.objects` | **established — see §2a** |

### The earlier analysis was incomplete

What it established is still true and was re-verified: `postgres` is **not**
superuser; `storage.objects` is owned by `supabase_storage_admin`, which has
**zero members**; `postgres` has **no `CREATE`** on the `storage` schema.

The error was the inference drawn from it — that policy creation is therefore
impossible. That holds for stock PostgreSQL. It does not hold on Supabase, which
adds a supported privileged execution context the analysis had no reason to look
for. The two competing explanations it offered (a different executor with
ownership normalised afterwards, or privileges since revoked) are both
unnecessary: **neither is required to explain the Oct 7 migration.**

This also removes the reason to doubt the three receipts carrying
`created_by = 'reconciled: applied out-of-band'`. A receipt is still not proof of
execution, but the executor's authority is no longer in question.

## 2a. The new evidence — `supautils.policy_grants`

Supabase preloads **`supautils`**, which keeps a per-role allowlist of tables on
which a non-owner may run policy DDL:

```
supautils.policy_grants = {"postgres": [ ...24 tables... ]}
```

That list includes **`storage.objects`**, plus `storage.buckets`,
`storage.prefixes`, `auth.users`, `realtime.subscription` and others.

**Production, read-only:** `supautils.policy_grants` is present and names
`storage.objects` under `postgres`. It is **byte-identical** to the setting on
the disposable rehearsal project. `supautils.privileged_role` is
`supabase_privileged_role` on both, and `postgres` is a member of it on both.

**Demonstrated on the disposable rehearsal project** (`nhcgrevnanuzroudxpux`,
PostgreSQL 17.11), never on production. `CREATE POLICY ... ON storage.objects`
as `postgres` **succeeded**. The asymmetry is what identifies the mechanism —
all in one transaction, as the same role:

| Probe as `postgres` | Result |
|---|---|
| `CREATE POLICY` on `storage.objects` | **SUCCESS** |
| `ALTER TABLE storage.objects ADD COLUMN` | `42501 must be owner of table objects` |
| `SET ROLE supabase_storage_admin` | `42501 permission denied to set role` |

So `postgres` is not the owner, cannot become the owner, and is refused every
other owner-only operation. Only **policy DDL on allowlisted tables** is
permitted.

Ordinary ownership rules still bind everyone else — same statement, same table:

| Role | Result |
|---|---|
| `authenticated` | `42501 must be owner of table objects` |
| `service_role` | `42501 must be owner of table objects` |
| `supabase_privileged_role` | `42501 permission denied for schema storage` |

The privileged role *itself* cannot do it: the grant is to `postgres` by name,
which is why reasoning about role membership never found it.

### Consistent with the package's own design

The package assumes exactly this. At line 104 of
`0031-package/0031_guarded_coordinator_containment.sql`:

> `-- Native CREATE POLICY and INSERT permission checks remain authoritative; no role elevation.`

It never elevates, and it relies on the native check passing. That is precisely
what `supautils.policy_grants` makes true for `postgres`.

### One honest gap

The package does **not** seal `supautils.policy_grants`. It contains no reference
to `supautils` at all, and `SCHEMA_POLICY_GRANT_DRIFT` — despite its name — is
the catalog-seal comparison, not a check on this setting.

Consequence: if Supabase ever removed `storage.objects` from that allowlist, no
pre-flight gate would catch it. The install would instead **fail safe** at
`EXECUTE approved_sql` with `must be owner of table objects`, aborting the whole
statement with zero policies installed (§5). So the gap costs a migration
version, not correctness. **Mitigation, no SQL change required:** re-read the
setting immediately before executing and confirm it still names
`storage.objects` —

```sql
SELECT setting FROM pg_settings WHERE name = 'supautils.policy_grants';
```

Add that as pre-flight gate 11, run read-only, in the same session that will run
the install.

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
rollback cannot lose data.

### An aborted install and a compensating rollback are not the same thing

An earlier draft of this packet ran these together and said the evidence row
blocks a retry. That is wrong for the failure case. Verified against the
package: it contains **zero `EXCEPTION` clauses**, so the nested
`DECLARE … BEGIN … END` around the audit insert is **not** a subtransaction.
Everything is one transaction inside one statement.

**Case A — the install aborts** (any guard fires, including the storage-authority
failure in §2). The policies and the `audit_log` evidence row roll back
**together**. Nothing persists: no policies, **no evidence row**, no Supabase
receipt. A later attempt starts from a clean slate — `PARTIAL_INSTALL` and
`EXECUTION_EVIDENCE_REPLAY` both pass. **A failed install does not block a
retry.**

**Case B — the install commits, then you run the compensating rollback above.**
The evidence row was committed with the policies, and `DROP POLICY` does not
touch `audit_log`; the log is immutable by design. So the row persists after
the policies are gone.

A re-install in Case B then behaves as follows, in the package's own order:
`PARTIAL_INSTALL` (line 66) **passes**, because the policies were dropped; the
five policies are created again at line 105; then `EXECUTION_EVIDENCE_REPLAY`
(line 130) fires and aborts the whole statement, rolling those policies back.
So the re-install **fails cleanly and leaves nothing**, but it cannot succeed
while that row exists.

**Consequence for approval:** reinstalling after a *successful* install that was
later rolled back is not a repeat of this approval. It needs a deliberate
decision about the evidence row — and that decision is yours, not something to
work around. Reinstalling after a *failed* install needs nothing extra.

---

## What this needs from you

§2 is resolved, so only one thing is left.

1. **Approve execution**, or decline it. Nothing else is outstanding: the route
   (§1), the receipts (§4), the unchanged drizzle journal (§4), the rollback
   behaviour (§5) and the post-install verification (§6) are all as previously
   accepted and are unchanged by this update.
2. **One precondition still holds:** drizzle `0023` must not be applied first.
   It would move that ledger to 24 and both journal pins would fail. It is
   pending today — confirm that at execution time.
3. **One line added to pre-flight** (§2a, gate 11): re-read
   `supautils.policy_grants` read-only in the same session and confirm it still
   names `storage.objects`. No change to the approved SQL.

### Summary of the supported installation route

| | |
|---|---|
| Route | One new file under `supabase/migrations/`, the package verbatim, one `DO $rr0031$ … $rr0031$;` statement |
| Executor | `postgres`, authority via `supautils.policy_grants` (§2a) |
| Expected Supabase receipt | `supabase_migrations.schema_migrations` **105 → 106**, one new version row |
| Expected drizzle journal | `drizzle.__drizzle_migrations` **23 → 23, unchanged** — 0031 takes no drizzle receipt |
| Rollback behaviour | Any guard aborts the single statement with **zero** policies installed; partial installation impossible by construction; proven 16/16 in a disposable cluster |
| Post-install verification | §6 — expect 5 policies / 1 restrictive on `storage.objects` / 1 evidence row / ledgers (106, 23), then the Coordinator and Owner/Manager functional check |

**The approved SQL is unmodified.** Package
`32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f` at
`docs/security/0031-package/` is byte-identical to what was verified; this update
changes only this document.

## Standing context

The fifth policy is **durability, not current closure**. All four identity
buckets' permissive SELECT policies already resolve to Owner-only, so
Coordinators cannot read identity objects today. This keeps that true if a
future permissive policy is added. Important; not urgent.

The investigation that was paused pending §2 is complete. Root-cause detail is
in `docs/security/0031-ROOT-CAUSE.md`.
