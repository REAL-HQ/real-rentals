# M2 Window 2 cutover: smallest approval interruption (2026-10-24)

**Status: NO-GO.** This is the proposed procedure only. Each numbered owner step is its own approval.

## Builds

| Build | Branch | Content hashing | Identity verification | Before step 3 | Steps 3 to resume |
|---|---|---|---|---|---|
| Release A | `release/m2-app-flags-off` `f8b2480f` | off | off | legacy approvals | approvals refused |
| **Hash-only (new)** | `release/m2-app-hash-only` `7220bf34` | **on** | off | legacy approvals, identical to A | approvals refused (`positive_identity_required`), nothing written |
| Release B | `release/m2-app-flags-on` `393ec914` (fixture fix on `6ee81415`) | on | on | must not be live before step 2 | verify identity, then approve |

The hash-only build is Release A plus one line, `DOCUMENT_CONTENT_SHA256_ENABLED = true`.
- **Before step 3, approvals are unchanged.** The legacy refusals require *both* flags
  (`applications.functions.ts`).
- **From step 3, approvals are frozen.** Identity verification is unreachable, so
  `approve_application_checked` refuses every new approval.
- **Uploads are hashed once step 2 is installed.** Before step 2, they confirm with a null hash and
  the missing function is probed once.
- **Tests:**
  - `scripts/m2-hash-only.test.ts`, full `npm test`, and the M2 suite including the live
    backfill rehearsal pass;
  - `agreement-evidence` passes 11/11 (run non-root);
  - dark-flag coverage passes with 61 modules (`documents.functions` is no longer dark).

**Release B finding:** Release B's own readiness chain fails at `document-registration.test.mjs`. Its
fake Storage client has no `info()`, which hashing needs. The real `@supabase/storage-js` 2.118
has `info()`, so production is not affected. The hash-only branch carries the one-fixture fix.
Fixed on Release B in `393ec914` (owner-approved; fixture only, 17 assertions unchanged). Release B is green on typecheck, build, full `npm test`, agreement-evidence 11/11 and `test:m2` with the live backfill rehearsal.

## Sequence (approval interruption: only from step 3 to the owner's resume)

| # | When | Action | Approvals |
|---|---|---|---|
| 1 | Window 1, after steps 1–2 verify, **before the backfill** | publish **hash-only** (owner approval); wait for the rollout | normal |
| 2 | Window 1 continues | backfill `--write`, gate report `missing=0 mismatched=0`, `no-executor-create` | normal |
| 3 | maintenance window opens | staff notice (below); Lovable export taken by the owner | normal until step 3 |
| 4 | Window 2 | preflight read; 3-pre → 3 → 3-post → verify; steps 4–29, each verify; `no-executor-create` | **frozen from step 3** |
| 5 | after step 29 | evidence fingerprint (`proposed/m2-window2/evidence-fingerprint-readonly.sql`) recorded; gate report re-read | frozen |
| 6 | owner authorizes resume | publish **Release B**; the first approval by the owner or a named Manager on a known applicant, checked against its audit row | resume |

**Why that placement:**
- The upload code caches "step 2 is missing" once per worker process. Published *before* step 2,
  the hash-only build could leave uploads unhashed after step 2 until workers recycle.
- Published *after* the backfill, uploads in between would be unhashed.
- Between steps 2 and the backfill, the backfill covers everything uploaded earlier, and the build
  covers everything after. No backfill re-run is needed at resume; the gate is re-read anyway.

**Estimated freeze:** about 60 Window 2 calls (29 guarded writes plus their read-only verifies and
the final checks). No hosted timing has been measured. Plan a **90-minute** window outside approval
hours, plus the owner's resume decision.

## Stop points

| Stopped | State | Approvals | Action |
|---|---|---|---|
| Before 3-pre | Window 1 state | normal (hash-only) | stand down; nothing to undo |
| After 3-pre, before 3-post | executor holds `CREATE` | frozen | resume: step 3 then 3-post. Abandon: 3-post. Then `no-executor-create`. |
| After 3, before 13 | boundary on, executor without grants | frozen (Approve unavailable) | **do not pause here**; continue to 13. If impossible: stand down frozen, owner decides |
| After 13, before 29 | approvals possible only with Release B | frozen (hash-only live) | run step 29's file now (stop-point table), `no-executor-create`, stand down frozen; resume steps later |
| After 29 | complete | frozen | step 4 of the sequence; wait for the owner's resume |
| Any failure | that file rolled back (one transaction) | frozen if past 3-pre | read-only `scripts/m2-hosted-preflight.ts` logic and stop-point table; **no automatic retry** |

Before any real approval, the existing reverse rollbacks remain valid. After one, recovery is the
forward-fix route below. Archive-then-roll-back is not adopted.

## Forward-fix route (built and rehearsed)

`node scripts/m2-forward-fix.mjs <fix.sql> <out> [--allow-boundary 'private.f(args)']` builds a guard v3
request. Its guarantees:
1. **Lint:** only `CREATE OR REPLACE FUNCTION`, `ALTER FUNCTION … SET/RESET`, `COMMENT ON
   FUNCTION` and `GRANT/REVOKE EXECUTE`. No data statement, DROP, table or policy DDL, DO,
   BEGIN or COMMIT. No Security 0031 name.
2. **In the same request:** the evidence fingerprint is taken before and after, and any difference
   raises `RRFIX_EVIDENCE_CHANGED`, rolling back everything. The fingerprint covers:
   - identity reviews, approval operations, approval audit rows and agreement evidence;
   - content bindings, bound documents and approval versions;
   - the five 0031 policies;
   - the triggers and trigger functions on the evidence tables;
   - every approval-boundary function.
3. **Boundary functions** (`approval_*`, the identity RPCs, anything raising
   `positive_identity_required`) can change only when the owner names them. Even then, a named
   function must still raise every refusal code it raised before (`RRFIX_REFUSAL_REMOVED`).
   - This is a backstop, not a proof of semantics.
   - A named boundary fix also needs code review and a harness approval-flow rehearsal.

Rehearsal: `scripts/m2-forward-fix.test.ts` runs all 29 steps with a seeded verified approval.
- A data-writing fix is refused by the lint, and a tampered request by the guard.
- A non-boundary fix leaves every row of every table in `public`, `private`, `storage` and `auth`
  unchanged, including payments, applications, agreements and audit. The fingerprint, Security
  0031 and all 30 verify results are also unchanged.
- An unnamed boundary change is refused.
- An identity bypass is refused even when its function is named.
- A named, code-preserving boundary fix applies with every row unchanged.

**Standalone fingerprints:** compare them only when taken through the same channel. Policy and type
names print relative to `search_path`. The in-request comparison is unaffected.

**Recovery is not only forward fixes.**
- Before the first real approval, the full reverse rollback remains available.
- The Lovable export is the forensic baseline.
- The daily backup remains the last resort for platform loss.

## Staff communication

**24 hours before:**
> "Scheduled maintenance on [date, time] for about 90 minutes. During it and until we confirm, new
> applicant approvals will be paused. Applications, uploads, rentals, payments and agreements keep
> working. Please don't approve applicants or sign agreements in that period. Approvals made
> before the window are not affected."

**At start:**
> "Maintenance started. Approve is paused. If Approve shows an error, leave the applicant as
> they are."

**At resume:**
> "Maintenance complete. Approvals now include a Verify Identity step: compare the licence photos
> with the applicant before approving."

**If stopped:**
> "Maintenance is paused. Approvals stay paused until further notice. Nothing needs to be redone."
