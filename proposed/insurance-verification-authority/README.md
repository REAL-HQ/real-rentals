# Insurance verification authority v1: only Managers and Owners verify or revoke insurance

**Status: PREPARED, NOT APPROVED. Nothing here has run in production.** It was tested only on the
private local Postgres 17.6 (port 55482) and a local PostgREST (port 55483).

This is a separate, independently installable and reviewable guarded package. It is deliberately
**not** folded into `../activation-insurance-setting`:
- it touches a different table (`public.driver_screenings`);
- it has its own threat (who may make the verification decision);
- it can be approved, installed and rolled back on its own.

Neither package needs the other.

## Artifacts

| Artifact | SHA-256 | Bytes |
|---|---|---|
| `insurance_verification_authority_v1.sql` (one `DO` statement) | `4b74a27baaf385a970491dc312d6b488f4530a048e9fdfc89413c3905e0a55a5` | 24,144 |
| **`request-insurance-verification-authority.sql`** = guard v3 + the package | **`eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950`** | 26,159 |
| Inner DDL (`src/inner.sql`) | `0e5cfa4160b159a2469dda72c83b672a38db89272a297a0d1d302e8c72795983` | — |
| `preflight-readonly.sql` | `d25ea8f1fa6d0f763a2d8c2737d46f6c4467d56047f4a8b53f25943af5f80459` | 3,606 |
| `verify-after-readonly.sql` | `2598914a567c3b118a27b9004159aee6eba4867f496b6659409c5c14c2e32d76` | 4,724 |
| `rollback.sql` (separate approval) | `7525ab3a65bfffd976306c8e4258d86d249ccfddb59be02ec726396def2b45c3` | 14,055 |
| `request-rollback-insurance-verification-authority.sql` | `69d5dcef91d46b2529f70d2783a68289095d998f55937d252f1ae116b729d082` | 16,054 |
| Function bodies (`prosrc`) | setter `f8c7e72c…d9f0`, guard `6f16d187…b080` | — |

- `src/build.py --check` reproduces every file byte for byte.
- The guard comes from `scripts/sql-guard/gen-guard3.py`, byte-identical to the reviewed generator.

## The problem

Today `driver_screenings.insurance_verified`, `insurance_verified_at` and
`insurance_verified_by` are written straight from the browser. Any staff tier, Coordinators
included, can write them under the policy `"Staff manage screenings"`
(`USING private.is_staff()`). The decision is not audited.

## The fix

1. **`public.set_insurance_verification(_application_id uuid, _verified boolean, _note text)`**
   is `SECURITY DEFINER` with `search_path=''`, and `EXECUTE` is granted to `authenticated` only.
   - It refuses unless `private.is_manager()` holds (Manager or Owner) for the caller's own JWT.
   - It sets or clears the decision and its at/by stamps.
   - In the **same transaction** it writes `insurance.verified` or
     `insurance.verification_revoked` with:
     - the actor, role and decision time;
     - from → to and the note;
     - the current insurance document's id, `content_sha256`, path, expiry and review status;
     - the insurer;
     - the policy number as its last 4 characters plus a SHA-256 (the full number is never
       stored in audit);
     - the policy expiry.
   - If the audit write fails, the decision rolls back.
2. **The trigger `zz_insurance_decision_guard`** runs `BEFORE INSERT OR UPDATE` on
   `public.driver_screenings` (`SECURITY INVOKER`). It refuses any change to the three decision
   columns from `authenticated`, `anon` or `service_role`. That covers Coordinators, Managers and
   Owners writing the table directly, and server code. It also refuses inserting a row as
   verified.
   - Every other column stays writable exactly as today: carrier, policy number, carrier phone,
     policy active, name match, interview fields and status.
   - Trusted `postgres`-owned definers (the setter, `purge_application`) pass.
3. **The app.**
   - `setInsuranceVerification` (`requireManager`) calls the setter with the caller's session.
   - `requestInsuranceVerification` (any staff tier, audited) records a Coordinator's request.
   - The insurance card shows the toggle only to Managers and Owners, and shows a **Request
     Verification** button to Coordinators.
   - Every browser screening write strips the decision columns.
   - If the setter is not installed (PGRST202), the server writes the audit row **first**, and
     refuses the decision if that fails, then applies the decision. That is not one transaction,
     and the audit row is marked `atomic: false`.

## What it does not touch

- `public.applications`. The package fingerprints its owner, RLS, ACLs, column ACLs, triggers and
  policies before and after, and refuses on any difference. That is how it stays invisible to the
  S1 and M2 gates.
- Every grant and policy.
- Security 0031, S1 (`zz_application_write_guard`, `private.application_write_guard()`, its
  column grants) and the M2 packages.
- Both ledgers and stored screening values.

## Tests

Results are in `../activation-insurance-setting/test-results.json`
(`bun scripts/activation-insurance-setting.db.test.ts`, 61 passed).

**Package mechanics.**
- VP0–VP7: checksums; preflight; real request refused on the foreign target; tamper refused;
  injected failure rolls back; install; verify-after all ok; replay refused.
- IVRB1–2: rollback removes exactly its objects, keeps the history, and refuses a replay.

**Permissions.**
- V1: a Coordinator cannot call the setter (SQL as authenticated, and PostgREST: 403
  `manager_required`).
- V2: Coordinator, Manager, Owner and `service_role` cannot write the decision columns directly,
  including verified_at or verified_by alone, and cannot insert a row as verified (PostgREST
  PATCH 403).
- V3: a Coordinator still updates the insurance information fields (SQL and PostgREST).

**Decisions.**
- V4, V5: Manager and Owner verify, then revoke, each audited with the evidence fields.
- V6: an injected audit failure refuses the decision.
- V7: a revocation racing an activation serialises; the activation sees the revocation.

**Independence.**
- I1: setting ON grants no verification right.
- I2: setting OFF means nobody activates with unverified insurance.
- I3: a Manager and an Owner each use the exception with the acknowledgement, and insurance stays
  unverified.
- I4: a Coordinator cannot activate.

**Compatibility (C1–C4):**
- **(a) S1:** with S1 installed before or after this package, S1's own `verify-after-readonly.sql`
  returns `all_gates: true`, and **S1's `rollback.sql` succeeds** after this package (C1, C2).
  S1 fingerprints `public.applications`, which this package does not change.
- **(b) M2:** the Window 1 preflight is clean with this package installed (C1, C2). Window 2
  applies and verifies before or after it (C1, C3, C4). M2's own rollbacks succeed with it
  installed (C1, C2, C3). M2 gates `public.applications` and its own objects, not
  `driver_screenings`.
- This package's rollback succeeds before the others (C2, C3) and after M2, S1 and 0031 rollbacks
  (C1).

## Production plan and ordering

- Run `preflight-readonly.sql` (all `ok`), then `request-insurance-verification-authority.sql`
  (`eb7710d7…8950`) once, then `verify-after-readonly.sql` (all `ok`).
- It is independent of S1, M2 Window 1/2, Drizzle 0023 and the activation-insurance-setting
  package; any order in C1–C4 works.
- **Recommended:** after S1, together with the activation package, before M2 Window 2.
- **Rollback:** `request-rollback-insurance-verification-authority.sql`, separate approval.

## Limitations

- Until this is installed, the database boundary is open: a Coordinator can still write
  `insurance_verified` directly through PostgREST. The app no longer does so, and the server
  function refuses Coordinators. Only this package closes the database path.
- The vault "insurance" document's own `review_status` (Verify / Needs New) is a separate document
  check. Activation does not rely on it. Today it is Manager+ in the server function
  (`setDocumentReview`). Coordinators cannot open the vault at all, because of the reviewed
  Manager position and Security 0031's containment of insurance documents.
- Coordinator **upload** of insurance documents is therefore not available today. That is an
  owner decision; see the PR report.
- The screening pipeline status `insurance_verified` (a stage label) can only be set when the flag
  is already true; `enforce_screening_pipeline` already requires it.
