# Combined local security rehearsal — 2026-10-31 (LOCAL ONLY)

Scope: Owner t28u. Disposable Postgres 17.11 on the box (port 55499, unix socket). **No production SQL, no SQL on either
staging project, no Stripe, no seed, no deploy.** Every script refuses production (7642734024280108049), new staging
(7702070854497379551) and old staging (7692130048193495360) system ids.

## 1. RECONSTRUCTED S1 (staging-only candidate)
- Accepted as a **staging-only candidate**. It is **not** the original artifact (bd86d450) and is **not** byte-identical.
- 29/29 local tests pass (`proposed/security-s1-RECONSTRUCTED/test/results-2026-10-31.txt`); documented differences unchanged.
- **Defect found and fixed by this rehearsal:** the wrapper's evidence `INSERT INTO public.audit_log` omitted `summary`,
  which is `NOT NULL` in the production-structure `audit_log`. The old harness used a simplified audit_log, so it missed this.
  Fixed in `src/build-request.sh` (wrapper only; inner sha256 `59cde2a8…` unchanged). The harness audit_log now has
  `summary text NOT NULL`.
- Cross-database comparison: `scripts/staging/local-rehearsal/normalized-fingerprint-readonly.sql` (ADAPTED, labelled).
  It covers functions (whitespace-normalised def + ACL + owner + secdef), tables (columns **by name**, ACLs, constraints, triggers, policies).
  It excludes OIDs and attnums. Two independent local builds (different OIDs) gave the identical overall fingerprint `908894d7…`.

## 2. Baseline (production structure, from repo migrations)
`build-baseline.sh`: 118 supabase files, 0 failures. Drizzle: the 23 **production** ledger rows (id, hash, created_at taken
from the 0031 v2 package's journal pin). Local first-23 md5 = `5cfa7e88…` = production.
Baseline adaptations, each labelled:
- Supabase/Lovable **default privileges** emulated (tables ALL → anon/authenticated/service_role, SELECT+INSERT → sandbox_exec,
  functions EXECUTE). Without this, ACLs did not match. With it, `public.audit_log` ACL matches 0031's production pin exactly.
- `GAPFILL-20260628200526-ASSUMED.sql` (`applications.sms_consent`). This is an **assumption**: the receipt text is unknown.
- 4 Sept named files skipped as dev twins of receipted UUID migrations; duplicate 20260925093000 skipped; pg_net/pg_cron stubbed.
- Exclusions kept (10 policies, 4 vehicles columns, 20260628200526); all already absent after the build.
Reproduction vs production (hash evidence captured earlier):
- B objects: 197 compared, 194 identical, 0 missing either way. **3 functions differ**: `enforce_screening_pipeline`,
  `vehicle_media_enhanced_unpublished`, `vehicle_media_sync_trigger`.
- 0031 role-helper defs and `audit_log` catalog pins: match. 0031 policies md5 after install = `d3387761…` = production.
- Every package preflight's production-state checks passed (journal, 0031 md5, objects absent, helpers, audit grants).
- **Not matching:** 0031's whole-catalog hash (local `65ef87f2…` vs production `c753236e…`). This is expected from the
  stubbed auth/storage schemas and role attributes. It cannot be localised without production's catalog JSON, which was never captured.
- Conclusion: the baseline reproduces production **security behaviour** for every guarded surface tested. It is **not** a
  full schema reproduction (3 functions, sms_consent assumption, stubbed platform schemas).

## 3. Combined install (in order) — `combined-install.sh`
Adaptation: only the system id is substituted, plus 0031's catalog_sha256 (local value). Diffs: 0031 2 lines; each other package 1 line in the inner file and 1 in the preflight;
verify-afters 0. Unguarded inner files are used, because the outer byte-guards pin production bytes.

| Step | Preflight | Install | Verify-after |
|---|---|---|---|
| 0031 v2 | (inner checks) | OK | (inner post-checks) |
| RECONSTRUCTED S1 | (inner checks) | OK, after the summary fix | 29-test suite separately |
| insurance activation setting | all ok | OK | 15/15 |
| insurance verification authority | all ok | OK | 8/8 |
| payments DELETE guard | all ok | OK | 6/6 |
| payments write guard | all ok | OK | 6/6 |
| 0023 | all ok | OK | 7/7 |

## 4. Functional tests — `functional-tests.sh`: 24/24 pass
- Allowed: server approve; Owner setter (set to false, exception stays OFF); Manager insurance verification via the setter; server checked activation once verified (rental active, audit row); server payment record; Manager adds an owed charge; server void-with-reason.
- Refused: Coordinator, Manager browser session and driver approving; Coordinator insurance setter; driver/service_role writing insurance_verified directly; activation while insurance is unverified (with and without ack, exception OFF); browser call of checked activation; Manager flipping the exception; direct setting write; Manager marking paid, voiding or inserting paid; Manager and service_role DELETE; anon read.

## 5. The 4 receipted migrations whose repo text ≠ production receipt
**Full receipt text was not captured** (only `md5(array_to_string(statements, E'\n'))`). An exact text diff cannot be produced.
Query needed (NOT run; requires Owner approval):
`SET TRANSACTION READ ONLY; SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version IN ('20260925160000','20260925161000','20260925170000','20261011180000');`

| Migration | Receipt md5 | Finding | Impact on production equivalence |
|---|---|---|---|
| 20260925160000_staff_tiers_invites_audit | `d41d8cd9…` = md5 of **empty** | receipt has no statements (NULL or empty array). Diff = the whole repo file vs nothing | Objects (staff_invites table, policy, indexes) in the B comparison: identical. Low |
| 20260925161000_vehicle_expenses | `d41d8cd9…` empty | same | vehicle_expenses table, 2 policies, trigger, 3 indexes: identical. Low |
| 20260925170000_audit_log_revoke_default_grants | `d41d8cd9…` empty | same | Production audit_log ACL equals exactly what this file produces on default grants (0031 pin matched locally). Low |
| 20261011180000_contact_status | `61ccff32…` (repo raw `478627cf…`, stripped `a2b13d41…`, no statement-split variant matched) | text differs in an unknown way | All 5 contact_* columns exist in production (S1 production evidence and column grants). CHECK and index text unverified. Medium until the text is read |
Recommendation: none of the 4 is shown to introduce an unapproved production difference. For staging, apply the repo files (effects match the evidence).
If the receipt text read later shows any statement not in the repo file, refuse that migration for staging and record it.
