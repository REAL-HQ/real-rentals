# Security 0031 — recovered package verified and reconciled

Prepared 2026-10-23 by Claude Code. All database facts are read-only `SELECT`s.
**No production SQL was executed. No installation is authorized or claimed.**

## 1. Checksums — all match

| File | Expected | Computed | |
|---|---|---|---|
| `0031_guarded_coordinator_containment.sql` | `32c17aa7…3494f` | `32c17aa7…3494f` | **match** |
| `EXACT.diff` | `2445ecc8…9d6b2` | `2445ecc8…9d6b2` | **match** |
| `REVIEW.txt` | `fd30ab5c…99f` | `fd30ab5c…99f` | **match** |

The package is the one the review describes. Nothing was modified or recreated.

## 2. The package's own claims, verified independently

Not taken from `REVIEW.txt` — recomputed from the bytes:

| Claim | Result |
|---|---|
| Inner approved SQL is `cf8d5572…cd723` | **true** — recomputed from the `$approved0031$` literal |
| The receipt-23 object appears in exactly **two** places | **true** — 2 occurrences |
| Removing both reconstructs the original sealed package | **true** — the result hashes to `479d44d3…09f0a`, byte for byte |
| Both journal pins are identical to each other | **true** |
| Pinned journal has 23 rows matching the live ledger | **true** — ids 1, 22 and 23 all match the ledger read today, including receipt 23 (`9ee4a1ce…`, `1792408979135`) |

So the reseal is exactly what it says: **two insertions, nothing else**. All five
restrictive policies, the role check, the target/catalog fingerprints and the
audit logic are untouched.

## 3. Pre-flight gates — every one that can be checked read-only passes now

Each gate evaluated against production today:

| Gate | Requirement | Live | |
|---|---|---|---|
| `UNSEALED_TARGET_PROFILE` | profile fields present | all present | **pass** |
| `TARGET_MISMATCH` — system id | `7642734024280108049` | `7642734024280108049` | **pass** |
| `TARGET_MISMATCH` — database | `postgres` | `postgres` | **pass** |
| `TARGET_MISMATCH` — `current_user` | `postgres` | `postgres` | **pass** |
| `SQL_CHECKSUM_MISMATCH` | `cf8d5572…` | recomputes to `cf8d5572…` | **pass** |
| `JOURNAL_DRIFT_OR_REPLAY` | the 23 pinned rows | ledger holds exactly those 23 | **pass** |
| `PARTIAL_INSTALL` | none of the five policies exist | **0** present | **pass** |
| `RLS_MISMATCH` | RLS on 5 relations | **5** | **pass** |
| `ROLE_HELPER_DRIFT` | `is_manager` / `is_staff` definitions | both **identical** to the pinned text | **pass** |
| `SCHEMA_POLICY_GRANT_DRIFT` | catalog `c753236e…41446` | **recomputed live: `c753236e…41446`** | **pass** |
| `AUDIT_CATALOG_DRIFT` | pinned `audit_log` shape | not recomputed in full; owner/ACL unchanged | likely pass |
| `AUDIT_INSERT_UNAVAILABLE` | INSERT on `audit_log` | **true** | **pass** |
| `EXECUTION_EVIDENCE_REPLAY` | no prior evidence row | **0** rows | **pass** |

**The catalog seal still matches live, recomputed from the package's own query.**
That is the gate most likely to have rotted in the weeks since sealing, and it
has not.

### The lock step is not a blocker

The package takes `LOCK TABLE storage.objects IN SHARE UPDATE EXCLUSIVE MODE`
*before* any DDL. That mode needs `MAINTAIN`, `UPDATE`, `DELETE` or `TRUNCATE`.
`postgres` holds **all four** on `storage.objects`, so the lock succeeds. The
earlier feasibility matrix failed at `CREATE POLICY`, not here — confirmed.

## 4. The one remaining technical blocker, unchanged

Whether the executing role can `CREATE POLICY ON storage.objects`.

`REVIEW.txt` states the requirement in the same terms I reached independently:
*"current_user must be postgres AND have legitimate authority for all CREATE
POLICY operations, including storage.objects owned by supabase_storage_admin."*

My disposable matrix (`scripts/0031-feasibility/`, 16/16) separates the two:

- `postgres`-like **without** storage-owner membership → `must be owner of table
  objects`, and **all five policies roll back together**.
- `postgres`-like **with** it → all five install in one transaction,
  `storage.objects` restrictive count 0 → 1.

Production today: `supabase_storage_admin` has **zero members**, `postgres` is
not superuser and has no `CREATE` on the `storage` schema. On the evidence I can
read, the first case applies — the install would **fail safely, changing
nothing**. The October 7 migration nonetheless created two `storage.objects`
policies, which is why this is unresolved rather than settled.

## 5. New finding — a receipt expectation this route will not meet

The package says *"The runner must append exactly one automatic receipt AFTER
this statement"*, and `REVIEW.txt` expects *"23 rows → 24 rows, not 25 or more."*

That assumes the **drizzle** runner. But the only route with demonstrated
storage-policy authority is the **Supabase migrations** route, and it writes
`supabase_migrations.schema_migrations`, **not** `drizzle.__drizzle_migrations`.
Verified: 105 Supabase receipts vs 23 drizzle, and the Oct 7 migration appears
only in the former.

Consequences, which are mild but must be approved knowingly:

1. **The in-transaction gate still passes.** `POST_JOURNAL_CHANGED` requires the
   journal to be *unchanged* at 23 rows during the statement. On this route it
   is. **Pass.**
2. **No 24th drizzle row ever appears.** The ledger stays at 23 and 0031 has no
   drizzle receipt. `REVIEW.txt`'s "should leave 24 rows" does not hold here.
   The receipt lands in the Supabase ledger instead.
3. **Replay is still protected**, by two independent guards rather than the
   journal: `PARTIAL_INSTALL` (the policies already exist) and
   `EXECUTION_EVIDENCE_REPLAY` (the `audit_log` row already exists). A second
   run refuses on both.
4. **The timestamp concern in `REVIEW.txt` does not apply.** It warns that the
   sealed journal timestamp `1791970564241` predates receipt 23
   (`1792408979135`), so *"a normal timestamp-based pending scan may skip it"*.
   That is a drizzle-runner ordering problem. The Supabase route selects a file
   by its own version string, so there is no pending scan to skip it.

**This is a reconciliation item for your approval, not a defect.** The SQL is
correct; the surrounding expectation was written for a different runner.

## 6. Status

| | |
|---|---|
| Artifact recovered and verified | **yes — `32c17aa7…`, all three files match** |
| Reseal is two insertions only | **yes — proven by reconstructing `479d44d3…`** |
| Pre-flight gates against live | **all pass**, catalog seal included |
| Route | one atomic Supabase migration, no split |
| Remaining blocker | storage-policy authority for the executor — one unknown |
| Receipt expectation | drizzle stays at 23 on this route (§5) |
| Installation | **not authorized. Needs your separate approval.** |

If the authority question resolves favourably, this package installs as sealed —
no re-seal, no new checksum, no new review. If it does not, the install fails
safely and changes nothing, which the matrix demonstrates rather than assumes.
