# M2 Window 1: operational runbook (2026-10-24)

**Status: NOT APPROVED. Nothing here has run in production.** Each stage needs the owner's approval,
which can be given once for stages 2–7 together.

**Rules for every stage:**
- Every SQL item is submitted exactly as the named file, verified against its SHA-256, once, through
  `query_database`. No retries.
- An ambiguous result means: inspect read-only and STOP.

**Data baseline (2026-10-24, after the four-record correction):**
- 20 current licence documents, 20 Storage files, 0 missing, 0 hashed;
- every undo-exactness count 0;
- Security 0031: 5 policies, `d33877618a9f40924d14e49b6653d7fa`;
- 170 policies in total; Drizzle 23; Supabase 105.

## Stage 1: Release A live and healthy

**Do:** `RELEASE-A-PUBLISH-CHECKLIST.md` §C is complete, including 24 hours without new errors.

**Stop if:** any §C item fails. **Recovery:** checklist §D (revert and publish). Window 1 does not start.

## Stage 2: scope still valid (read-only)

**Do:**
1. `proposed/m2-window1/backfill-scope-count-readonly.sql` (`7c88f5cd…1e14`). Expect:
   - `docs_without_object` 0;
   - `objects_in_scope` = `docs_in_scope` (20, or more if new licences were uploaded);
   - `docs_hash_already_set`, `objects_with_content_sha256_key`, `objects_with_sha256_key`,
     `objects_user_metadata_null` and `_not_object` all 0;
   - `storage_objects_has_version` true.
2. RUN-ORDER #1, `proposed/m2-preflight.sql` (`29f77bfc…407f`). Expect zero failing checks.
3. The owner takes **Export Project Data** in Lovable and keeps the file privately (never in GitHub,
   chat or Claude).

**Stop if:**
- any missing object;
- any non-zero undo-exactness count;
- a preflight failure.

**Recovery:** none needed, since nothing has been written. A missing object goes back to the
read-only investigation and its own owner decision.

## Stage 3: M2 steps 1–2 (guarded, RUN-ORDER #2–#5)

**Do:**

| # | Submit | SHA-256 | Then |
|---|---|---|---|
| 2 | `proposed/m2-guarded/01-step-1.sql` | `2b6312cf…23b5` | #3 `rehearsal/verify/step-01.sql` (`07b1eb8c…520de`) must return `t` |
| 4 | `proposed/m2-guarded/02-step-2.sql` | `4671f4de…6315` | #5 `rehearsal/verify/step-02.sql` (`639327d7…8ff9310`) must return `t` |

`node scripts/m2-guarded-requests.mjs --check` must pass before submitting.

**Expected effect:**
- adds 4 functions, the table `private.uploaded_content_sha` and the role `rr_approval_executor`;
- policies, Security 0031 and both journals unchanged.
- Approvals stay on Release A's legacy path: no `approve_application_checked`, no version column.

**Stop if:**
- `RRGUARD_*` (the guard refused; nothing ran);
- any other error (the file is one transaction, so it rolled back);
- a verify not `t`.

**Recovery:** read-only `scripts/m2-hosted-preflight.ts` logic to find the last committed step.
Nothing is half-applied. To abandon, with owner approval:
- `proposed/rollback/record-uploaded-content-sha.sql` (step 2);
- then the hosted variant `proposed/m2-hosted-amendments/rollback/01-auth-binding.sql` (step 1);
- each followed by the previous step's verify.

These were rehearsed on the harness, including after a used and undone backfill.

## Stage 4: publish the hash-only build (after the step 2 verify, before the backfill)

**Do:**
1. Merge `release/m2-app-hash-only` (`7220bf34`) into `integration/grok-baseline-2026-10-22` with
   `--no-ff`, then push.
   - The merge must be clean.
   - If the head is still `14cbf81b`, the tree must be `4fdaadc0bc7754b478cd40a4570019044f881ea8`.
   - The patch must equal the hash-only diff from Release A: one source line plus tests.
   - Pre-verified in a scratch merge: typecheck, build, full `npm test`, agreement-evidence 11/11,
     `test:m2` with the live backfill rehearsal.
   - If Release A's publish added commits, re-run those checks.
2. Confirm Lovable `latest_commit_sha` = the merge commit. Quick Preview check: the Verify Identity
   control is still absent.
3. Publish (owner approval). Wait at least 10 minutes for the old workers to drain before Stage 5.
4. No test upload. The next legitimate upload, whenever it occurs, must get a `content_sha256`.
   Stage 7's `licence_docs_unhashed` covers licences. If no upload occurs during the window, mark
   it PENDING.

**Stop if:**
- the merge is not clean;
- the tree differs;
- an upload fails.

**Recovery:**
- Revert the hash-only merge (`git revert -m 1 <merge>`; the tree returns to the pre-merge head),
  then publish. Approvals were never affected.
- Hashes already written are additive and valid.
- Uploads made under Release A are covered by Stage 5.

## Stage 5: backfill (operator, owner's shell)

**Do:**
1. Credential handling:
   - Set it in the owner's own shell only: `export SUPABASE_SERVICE_ROLE_KEY=…`. Never in a file, the
     repo, chat or Claude.
   - The script refuses unless `SUPABASE_URL` comes from `--url` (or a shell value that differs from
     the committed `.env`). It prints the target host, and the key's JWT role must be `service_role`.
2. Dry run: `bun scripts/backfill-document-content-sha.ts --url https://yuyzdsnrbfhkmfzpvhwx.supabase.co`.
   Expect `missing=0 mismatched=0 storage_errors=0`, with `pending` = the number still to hash.
3. Write: the same command with `--write`. It must end `missing=0 mismatched=0 storage_errors=0` (it
   exits non-zero otherwise).
4. `unset SUPABASE_SERVICE_ROLE_KEY` and close the shell.

**Stop if:** any non-zero count or exit code. Do not re-run blindly.

**Recovery:**
- Read-only stage 2 counts and the gate report show what was written.
- A transient `storage_errors` may be re-run once with owner approval (the write fills only NULL
  hashes and is idempotent).
- To undo the whole backfill, with owner approval: `proposed/rollback/backfill-content-sha.sql` (the
  owner undo). It was rehearsed exact on production's profile, apart from `updated_at`.

## Stage 6: gate report (read-only, RUN-ORDER #7–#8)

**Do:**
1. `proposed/backfill-document-content-sha.sql` (`5bd9185c…cd00`). It must report
   `missing=0 mismatched=0 skipped=0` (it writes only a temp table).
2. `proposed/m2-verify/no-executor-create.sql` (`17a9ec0c…341b`) must return `t`.

**Stop if:** any non-zero count, or `f`.

**Recovery:**
- Missing > 0 after a clean write means a licence was uploaded or replaced during the window: re-run
  Stage 5 `--write` once, with approval.
- Mismatched > 0 means STOP and report. That is a byte or binding disagreement; never overwrite it.

## Stage 7: Security 0031 and existing behaviour (read-only, then a business check)

**Do:**
1. `proposed/m2-window1/window1-postcheck-readonly.sql`. Expect:
   - `policies_0031` = `[5, "d33877618a9f40924d14e49b6653d7fa"]`;
   - `policies_total` 170, `drizzle_receipts` 23, `supabase_receipts` 105;
   - `step2_recorder_present`, `approval_rpc_absent`, `approval_version_column_absent`,
     `approval_boundary_trigger_absent` and `executor_role_present` all true;
   - `licence_docs_unhashed` 0, `licence_docs_hash_without_binding` 0;
   - `bindings` ≥ `licence_docs_in_scope`.
   - `recent_uploads_24h_unhashed` is informational: uploads from before the hash-only publish
     count there.
2. Behaviour, observed only (no test records). The next legitimate approval works as on Release
   A, with one `application.approved` row, and the next legitimate upload is hashed. If either does
   not occur, mark it PENDING; never manufacture it.

**Stop if:** any expected value differs.

**Recovery:**
- Security 0031 or journal drift: STOP and report. Nothing in Window 1 touches them.
- An approval regression: revert the hash-only publish (Stage 4 recovery). If it persists,
  roll back steps 2 then 1 (Stage 3 recovery), with owner approval.

**Window 1 complete** = all seven stages green. Window 2 stays separately gated: see
`M2-WINDOW2-CUTOVER.md` and `M2-WINDOW2-FREEZE-AND-FORWARD-FIX.md`.
