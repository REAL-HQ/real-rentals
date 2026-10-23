# Security 0031 — reconciliation with the October 7 evidence, and one installation plan

Prepared 2026-10-23 by Claude Code. Every database fact below is a read-only
`SELECT` against production. **No production SQL was executed.**

## 1. Grok's finding is correct, and I have verified it

An October 7 Lovable-generated migration did create two Storage policies, and
both exist in production today.

The file is `supabase/migrations/20261007034524_2033b2f1-e324-4b1a-bf59-e2ad2fa70e0d.sql`:

```sql
DROP POLICY IF EXISTS "Staff manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Managers manage vehicle doc objects" ON storage.objects FOR ALL TO authenticated …
CREATE POLICY "Staff manage operational vehicle doc objects" ON storage.objects FOR ALL TO authenticated …
```

Both policies are present in `pg_policy` on `storage.objects` right now, and the
file has a receipt in `supabase_migrations.schema_migrations` (105 receipts,
`20260611133219` … `20261011180000`; 4 of them dated `20261007`).

**So some execution path does have `CREATE POLICY` authority on
`storage.objects`.** My earlier conclusion — that this needs Lovable engineering
— was wrong about *that*. The correction matters, and it is not the whole story.

## 2. What the evidence does and does not establish

It establishes that the executor of `supabase/migrations/*` had ownership or
superuser rights over `storage.objects` on October 7.

It does **not** establish that executor's identity, and per your instruction I
am not assuming it. What I can state as a matter of logic rather than guesswork:

> `storage.objects` is owned by `supabase_storage_admin`. `CREATE POLICY`
> requires superuser or ownership, and ownership checks pass only for a member
> of the owning role. Verified **today**, `current_user` on the path available
> to me is `postgres`, which is **not** superuser, **not** the owner, and
> **not** a member of `supabase_storage_admin` or `supabase_admin`.
>
> Therefore the October 7 executor was either not `postgres`, or was `postgres`
> with role memberships it no longer has. Either way, **`postgres` cannot create
> that policy today.**

| Fact (verified read-only, 2026-10-23) | Value |
|---|---|
| `current_user` / `session_user` on this path | `postgres` / `postgres` |
| `rolsuper` | **false** |
| `rolbypassrls` | true |
| `pg_has_role(current_user,'supabase_storage_admin','USAGE')` | **false** |
| `pg_has_role(current_user,'supabase_admin','USAGE')` | **false** |
| owner of `storage.objects` | `supabase_storage_admin` |
| policies on `storage.objects` | 24, **all PERMISSIVE, 0 RESTRICTIVE** |

## 3. The actual blocker, restated — it is a seal problem, not an authority problem

`drizzle/migrations/0031_guarded_coordinator_containment.sql` pins
`"execution_role": "postgres"` in its sealed profile and enforces it:

```sql
OR current_user IS DISTINCT FROM profile->>'execution_role'
THEN RAISE EXCEPTION 'TARGET_MISMATCH';
```

Put those two facts together and 0031 **as sealed** cannot execute anywhere:

| Path | Storage-policy authority | 0031's `current_user = postgres` check | Outcome |
|---|---|---|---|
| `supabase/migrations/*` (proved Oct 7) | **yes** | fails — executor is not `postgres` | `TARGET_MISMATCH` |
| as `postgres` (drizzle, this connection) | **no** | passes | `ERROR: must be owner of table objects` |

There is also a third problem with the drizzle route independent of roles:
**Lovable's deploy does not run drizzle migrations.** The two ledgers are
separate mechanisms — `supabase/migrations/` (105 receipts, run by Lovable) and
`drizzle.__drizzle_migrations` (23 receipts, not run by the deploy). Putting
0031 in `drizzle/migrations/` does not install it.

**Conclusion:** the fix is to re-seal 0031 to the executor that actually has the
authority, and to ship the Storage policy through `supabase/migrations/`. That
is a package change requiring independent review — not a privilege escalation,
and not a Lovable engineering ticket. I am **not** making that change silently.

## 4. Migration numbering, reconciled

All four of your bullets are correct and they describe two independent ledgers:

| | `drizzle.__drizzle_migrations` | `supabase_migrations.schema_migrations` |
|---|---|---|
| receipts | **23** | **105** |
| covers | `drizzle/migrations/0000…0022` | timestamped `supabase/migrations/*` |
| run by | not the Lovable deploy | the Lovable deploy |
| holds the Oct 7 storage policies | no | **yes** |

Full mapping of the drizzle ledger (every hash matched a file, in order, no
gaps): ids 1–23 → `0000_fleet_inbox_job_queue.sql` …
`0022_waitlist_resolve_phone_conflict.sql` (id 23, applied 2026-10-19 11:22 UTC).
`drizzle/migrations/meta/_journal.json` has 24 entries (idx 0–23), so **0023 is
the only pending drizzle migration** — Grok's report is right.

**0031 is not the next number in that sequence.** There is no 0024–0030; the
file is named after the *security finding* number. That is a naming collision
with a sequential ledger, and it is the source of the confusion.

### Would 0023 execute alongside 0031?

**Yes, and it would break 0031 — but only through the journal pin, not the
catalog seal.** Precisely:

- `0023_application_resume_atomic_security.sql` creates
  `public.application_recovery_attempts` (+ index, RLS, grants), backfills
  cooldowns from `applications.resubmission_history` (read-only on
  `applications`), and creates three functions
  (`reserve_application_recovery`, `finish_application_recovery`,
  `resolve_application_identity_review`).
- 0031's `catalog_sha256` seals a **named allowlist of seven relations**:
  `public.{applications, application_identity_reviews, documents, agreements,
  user_roles}`, `storage.objects`, `drizzle.__drizzle_migrations` — capturing
  owner, RLS, ACL, columns, constraints and policies, plus the `private.is_manager`
  / `private.is_staff` helpers. **0023 performs no DDL on any of those seven**
  (it only reads `applications`, and references the others inside new function
  bodies, which the seal does not cover). So **`catalog_sha256` is unaffected** —
  verified statement by statement.
- But drizzle applies pending migrations **in index order**. 0023 (idx 23) runs
  before any 0031, commits, and the journal becomes **24** rows — which fails
  `JOURNAL_DRIFT_OR_REPLAY` in a package pinned at 23.

**Ordering rule:** install 0031 **before** 0023, or install 0023 first and
re-seal 0031's journal pin to 24 rows. They cannot go in the same drizzle run
with 0031 pinned at 23.

## 5. The resealed artifact is still missing

Reported SHA-256:

```
32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f
```

Searched again today, after a full `git fetch --all --prune`:

- **280 refs, 6,887 unique blobs** — every blob hashed. No match.
- Google Drive full-text search for the hash: no result. The handoff archive
  (`REAL-RENTALS-CLAUDE-HANDOFF-2026-10-22.zip`) contains no 0031 SQL.
- The only 0031 package anywhere available is the 22-entry version on
  `codex/0031-isolated-sync`, sha256
  `479d44d3377103c78894ee46426621ca777dc9de68832918d5dcaf8fd6309f0a`.

**That hash is therefore unverified, and I am not treating it as verified.**
I have not recreated the file.

### Smallest action to recover it

In order of least effort, any one of these ends it:

1. **Have whoever produced it push the file**, to any branch in
   `REAL-HQ/real-rentals`. One `git push` and I verify the hash in one command.
2. **Or upload the exact file** to the Drive folder holding the handoff package.
3. **Or paste the file's bytes** into a message. It is reviewed SQL, not a secret.

If none of those can produce it, the package must be **re-derived and
re-reviewed from the approved inner SQL** (`cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723`),
and the result is a **new** package with a **new** seal — it cannot inherit the
old one's approval. Say the word and I will prepare that for independent review;
I will not do it silently.

## 6. One installation plan

**Status: not executable yet.** Two things are unresolved, and both are small.
The plan is written so that when they land, nothing else has to be rethought.

### Open prerequisites

| # | Needed | How |
|---|---|---|
| P1 | The resealed artifact, or approval to re-derive it | §5 |
| P2 | The identity and present authority of the `supabase/migrations/` executor | **No read-only operation reports it** — see `0031-executor-verification.md`. Recommended: one narrow question to Lovable Support, zero execution. The probe is the fallback and **would be recorded**, so it is not run |

### 6.1 Prerequisite: establishing the executor

Superseded by `docs/security/0031-executor-verification.md`. Summary: no
supported read-only operation reports the migration executor's effective role.
The probe that would self-report **creates a migration receipt**, which is
persistent deployment state, so **it has not been run** — the exact statement
and its consequences are in that document for your separate approval. The
recommended first step is one narrow question to Lovable Support, which costs
and risks nothing.

### 6.2 Expected executor

**Unresolved, and deliberately not guessed.** Object ownership from the Oct 7
migration points at `postgres`, but ownership can be normalized after creation,
so it is evidence rather than proof. If the executor is `postgres`, the existing
seal's `execution_role` pin is already correct and **nothing needs resealing**.
If it is not, the role pin changes and that makes a **new package** with a new
checksum, which cannot inherit the old approval.

### 6.3 Policies installed (unchanged from the approved package)

Five RESTRICTIVE `SELECT` policies for `authenticated`, qualifier
`private.is_manager() IS TRUE OR private.is_staff() IS FALSE` (plus a bucket /
category carve-out on the two document relations):

| Policy | Relation |
|---|---|
| `coordinator_application_containment` | `public.applications` |
| `coordinator_review_containment` | `public.application_identity_reviews` |
| `coordinator_document_containment` | `public.documents` |
| **`coordinator_identity_storage_containment`** | **`storage.objects`** |
| `coordinator_agreement_containment` | `public.agreements` (conditional) |

### 6.4 One transaction, all five policies — no split

**Owner instruction 2026-10-23: a single atomic installation of all five
policies through the proven Supabase route. Do not split unless the
single-transaction route is demonstrated impossible and a split plan is
separately reviewed.** The earlier Part A / Part B split in this document is
**withdrawn**.

This is also the better engineering answer, and one finding makes it cleaner
than expected:

> **Installing through `supabase/migrations/` does not touch the drizzle
> ledger.** `drizzle.__drizzle_migrations` stays at 23 rows, so a package whose
> journal pin expects **23** — the missing resealed artifact — is exactly right
> for this route.

- All four `public.*` policies sit on tables `postgres` owns. The fifth,
  `storage.objects`, is the only one needing storage authority.
- The package is a single `DO` block, and the October 7 precedent shows this
  mechanism submits a whole file as one statement — so all five policies, the
  pre-flight guards, the post-flight re-verification and the `audit_log`
  evidence row commit together or not at all.
- Atomicity is therefore **preserved**, which the split would have broken.

Unresolved: whether that executor still has `CREATE POLICY` authority on
`storage.objects`. See `docs/security/0031-executor-verification.md` §3 — the
October 7 success does not establish present-day authority, and two
explanations fit the evidence equally.

### 6.5 Journal changes

| Ledger | Before | After |
|---|---|---|
| `drizzle.__drizzle_migrations` | 23 | **23 — unchanged.** The Supabase route does not write this ledger, which is why a pin at 23 is correct |
| `supabase_migrations.schema_migrations` | 105 | 106 |

**0023 must not be applied between sealing and installing**, or the journal pin
fails (§4).

### 6.6 Transaction behaviour

Each migration file runs in its own transaction, and the guarded package is a
single `DO` block: every pre-flight check, all five `CREATE POLICY` statements,
the post-flight re-verification and the `audit_log` evidence row commit together
or not at all. `LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE` is
taken before the writes. Any guard — `UNSEALED_TARGET_PROFILE`,
`TARGET_MISMATCH`, `SQL_CHECKSUM_MISMATCH`, `JOURNAL_DRIFT_OR_REPLAY`,
`PARTIAL_INSTALL`, `RLS_MISMATCH`, `ROLE_HELPER_DRIFT`,
`SCHEMA_POLICY_GRANT_DRIFT`, `AUDIT_CATALOG_DRIFT`, `AUDIT_INSERT_UNAVAILABLE`,
`POST_POLICY_MISMATCH`, `POST_JOURNAL_CHANGED`,
`POST_UNEXPECTED_CATALOG_CHANGE` — aborts the whole thing with nothing applied.

Running all five on the Supabase route keeps that single-transaction property
intact. This is why the split is withdrawn: it would have traded the package's
strongest guarantee for nothing.

### 6.7 Rollback

```sql
DROP POLICY IF EXISTS coordinator_application_containment ON public.applications;
DROP POLICY IF EXISTS coordinator_review_containment      ON public.application_identity_reviews;
DROP POLICY IF EXISTS coordinator_document_containment    ON public.documents;
DROP POLICY IF EXISTS coordinator_agreement_containment   ON public.agreements;
DROP POLICY IF EXISTS coordinator_identity_storage_containment ON storage.objects;
```

Dropping five policies that nothing else references. No grants, ownership, RLS
flags or data are touched by install or rollback, so rollback cannot lose data.
The `audit_log` evidence row stays by design — the log is immutable.

### 6.8 Post-install verification (all read-only)

1. Five policies exist, `permissive = 'RESTRICTIVE'`, `cmd = 'SELECT'`,
   `roles = {authenticated}`, qualifiers byte-identical to the sealed
   `POST_POLICY_MISMATCH` literal.
2. `storage.objects` restrictive policy count goes **0 → 1**.
3. Exactly one `audit_log` row with `action='security_migration_verified'`,
   `entity_id='0031_coordinator_containment'`.
4. Both ledgers moved by exactly the expected amounts (§6.5).
5. `catalog_sha256` recomputes to the sealed value once the five new policies are
   excluded (the package's own `POST_UNEXPECTED_CATALOG_CHANGE` check).
6. **Functional, and this is the one worth doing by hand:** sign in as a
   Coordinator and confirm identity documents and the four identity buckets are
   unreadable; sign in as Owner and as Manager and confirm nothing they could do
   before is now refused.

### 6.9 Standing context on urgency

The fifth policy is **durability, not current closure**. All four identity
buckets' permissive `SELECT` policies already resolve to
`private.has_role(auth.uid(),'admin')` — Owner only. Coordinators cannot read
identity objects today. The restrictive policy keeps that true if a future
permissive policy is ever added. So this is important and it is not an
emergency; doing it correctly beats doing it fast.

## 7. Where this leaves the decision

| | |
|---|---|
| Does an execution path with Storage-policy authority exist? | **Yes — verified, October 7** |
| Can 0031 install as currently sealed? | **No — on either path, for two different reasons** |
| Is the blocker Lovable engineering? | **No.** It is a re-seal plus a path change, both ours |
| Is the resealed artifact available? | **No.** §5 lists three one-step ways to produce it |
| Installation status | **Blocked, by P1 and P2 — both small, neither needing Lovable** |
