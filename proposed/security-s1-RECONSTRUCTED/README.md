# Security S1 — RECONSTRUCTED (NOT the original approved artifact `bd86d450`)

**Status: BLOCKED. No install SQL has been written. Nothing installed anywhere.**

Original: `proposed/security-s1/request-s1.sql` @ `bd86d450`, sha256 `b9be95be34f2a784c7e9a124e50151a6ca7f354282e8b90cf36c638961044215` (per `docs/security/s1-install-2026-10-25/install-result.json`). Not recoverable: not on any branch, tag, PR, dangling object or file on the box; GitHub reports the commit does not exist.

## Why exact equivalence cannot be shown with the evidence we have

The S1 verify-after pins:
1. `private.application_write_guard()` **`prosrc` sha256 `34ce374b15e106597e7c6f9bd8bbb03607c3b7b68ab30e1aad75f4597fa6a292`**. Only the hash exists in the repo; the function body is in no file. A body cannot be derived from its hash, and any hand-written body would fail `function_exact`.
2. `fingerprint_matches_evidence`: sha256 over the full `public.applications` catalog snapshot (all columns, all non-internal triggers, all policies' `qual`/`with_check` text, column ACLs). Reproducing `67726740…` (pre) → `a2b05c35…` (post) needs a production-identical `applications` baseline, which is not on the box (the earlier `rr_tpl` baseline lived in a previous environment).
3. `acl_matches_evidence` / `evidence_one_well_formed`: compare against the evidence row's `post_install_acl` (154 items) and `inner_sql_sha256` `1b18be0c…`, which are not in the repo.

Per Owner instruction t24u ("if exact equivalence cannot be demonstrated, report the differences and stop"), work stopped here.

## What is known (spec, from the verify-after)
- Trigger `zz_application_write_guard` on `public.applications`: BEFORE INSERT OR UPDATE, FOR EACH ROW (`tgtype = 23`), enabled `O`, no column list, sorts last among BEFORE row triggers.
- Function `private.application_write_guard()`: plpgsql, SECURITY INVOKER, `search_path=""`, owner `postgres`, returns trigger; no EXECUTE for authenticated/anon/service_role.
- `authenticated`: UPDATE revoked on 19 `revoke_cols` and closed on 21 `closed_cols`; no table INSERT; column INSERT exactly the 24 form columns. `anon`: column INSERT = form columns + `primary_application_id`.
- 0031 policies md5 `d33877618a9f40924d14e49b6653d7fa` unchanged.
- One `audit_log` evidence row: entity `s1_application_write_guard`, action `security_migration_verified`, metadata package `security-s1 v1`.

## Smallest unblock (needs Owner approval)
One read-only production query, run once, returning catalog definitions only (no customer data or secrets): `pg_get_functiondef('private.application_write_guard'::regprocedure)`, `pg_get_triggerdef` for the `applications` triggers, the exploded `applications` ACL (role:privilege names), and the `jsonb` core/raw snapshot that the verify-after hashes, plus the S1 evidence row's non-secret metadata keys (`post_install_acl`, `inner_sql_sha256`). With those, a RECONSTRUCTED package can be built and proven locally (reproduce `34ce374b…`, `67726740…` → `a2b05c35…`, all 12 gates) before independent review.
Preferred alternative: recover `bd86d450` from whoever has the earlier environment (`/home/user/wt-s1`).
