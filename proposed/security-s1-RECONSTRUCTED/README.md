# RECONSTRUCTED S1 — NOT the original approved artifact `bd86d450`

**Status: PREPARED FOR INDEPENDENT REVIEW. Not installed anywhere. Not exactly equivalent (see differences).**

Original (unrecoverable): `proposed/security-s1/request-s1.sql` @ `bd86d450`, sha256 `b9be95be…4215`, inner sha256 `1b18be0c…8fac`.
Source of this reconstruction: one Owner-approved read-only production catalog query (t27u, 2026-10-31 ~11:45 PM ET), saved as `production-evidence-readonly-2026-10-31.json` (catalog definitions, ACLs, evidence hashes; no customer data).

## Files
- `src/inner-s1-RECONSTRUCTED.sql` (sha256 `59cde2a8a91479a0a5c7c9a3efb4ade30121fadbf2780f33ec40e2bd935d1821`): production's exact `pg_get_functiondef` of `private.application_write_guard()`; REVOKE EXECUTE from PUBLIC/anon/authenticated/service_role; trigger `zz_application_write_guard` (production's exact `pg_get_triggerdef`); ACL convergence (REVOKE ALL table+column from PUBLIC/anon/authenticated/service_role/sandbox_exec, then GRANTs generated from production evidence `post_install_acl`, in production relacl order).
- `src/build-request.sh <system_id>`: wraps it in one transaction pinned to a system id (refuses production), refuses replay, verifies prosrc sha256 `34ce374b…` and that no policy changed, writes one evidence row `s1_application_write_guard_reconstructed` labelled `security-s1 RECONSTRUCTED`.
- `test/baseline-local.sql`: disposable local baseline: production-structure-equivalent `public.applications` (125 columns, exact types/not-null, 7 policies incl. 2 RESTRICTIVE, `applications_active_guard` + `set_updated_at` with production's exact definitions, roles incl. `sandbox_exec`). Stub `is_staff`/`is_manager`/`auth.uid`. Column defaults for NOT NULL columns are test values (production defaults not retrieved).
- `test/run-local.sh`: rehearsal on local Postgres 17.11 (unix socket, refuses prod/staging ids). Results: `test/results-2026-10-31.txt`: **29 pass, 0 fail**; 5 original verify-after gates false (explained below).

## Matches production (demonstrated)
- Function: `pg_get_functiondef` md5 identical; prosrc sha256 = `34ce374b…a292`; owner postgres; proacl `{postgres=X/postgres}`; no EXECUTE for anon/authenticated/service_role; SECURITY INVOKER; `search_path=''`.
- Triggers: all three `pg_get_triggerdef` identical; enabled `O`, tgtype 23/19/23, name order identical; S1 sorts last.
- Privileges: exploded ACL (154 items) **identical** to production evidence `post_install_acl`; relacl and every column attacl text identical to production.
- Snapshot parts identical: owner, rls, force_rls, columns, triggers, guard_functions, acl.
- Original verify-after gates true: function_exact, trigger_exact, trigger_sorts_last, protected_columns_closed, authenticated_insert_form_only, anon_insert_unchanged, not_rolled_back.
- Behaviour: status change by staff/manager refused (column privilege, and the S1 trigger raises `application_status_server_only` even if a column grant is added); protected-column writes refused; anon/authenticated inserts limited to form columns, status defaults to `new`; manager can still edit allowed columns; server (service_role, postgres) can approve, set payment columns and activate with a running rental; `applications_active_guard` still enforced; `updated_at` still fires; sandbox_exec keeps SELECT+INSERT only; anon cannot delete.

## Material differences (exact equivalence NOT claimed)
1. **Not byte-identical**: inner sha256 `59cde2a8…` ≠ original `1b18be0c…`. The original's ACL statements are unknown; this one converges by REVOKE ALL + regrant (same end state, different statements).
2. **Evidence row differs by design** (`…_reconstructed`, package `security-s1 RECONSTRUCTED`), so the original verify-after's `evidence_one_well_formed`, `acl_matches_evidence` and `fingerprint_matches_evidence` are false. They would need an adapted verify-after (not written; needs review). The ACL itself was proven equal independently.
3. **Pre-install fingerprint `67726740…` not reproduced**: the pre-install ACL was not retrieved (evidence has `pre_install_acl`, outside the approved fields).
4. **Post-install fingerprint `a2b05c35…` not reproduced on a fresh database**: policy `polqual`/`polwithcheck` node trees embed OIDs, column numbers and the original expression grouping (e.g. nested AND in "Anyone can submit applications"). Everything else in the snapshot matches. The production snapshot itself rehashes to `a2b05c35…` (method confirmed).
5. **0031 and insurance protections not rehearsed locally**: only `coordinator_application_containment` (0031, on applications) is in the baseline; the other four 0031 policies and AIS/IVA objects are on other tables whose definitions were not retrieved. The package checks that no policy changes. In production, S1 coexists with 0031, AIS and IVA (S1 verify-after all gates true on 2026-10-31).
6. `journal_exact_23` / `policies_0031_exact` false locally only because the local baseline has no journal or full 0031.
