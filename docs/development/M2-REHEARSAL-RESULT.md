# M2 hosted rehearsal — result and GO/NO-GO

2026-10-23. Disposable project `nhcgrevnanuzroudxpux` only. Production was read
with `SELECT` only. Evidence: `docs/development/m2-rehearsal-evidence/`.

## Verdict

| Decision | Verdict |
|---|---|
| Install the M2 packet **as approved** on production | **NO-GO.** Step 3 fails on hosted PostgreSQL 17. |
| Install M2 **with the two hosted amendments** | **GO once you approve the amendments.** Rehearsed end to end, twice. |
| Activate Record Rental | **NO-GO.** The app has no runtime wiring or issuer login. See §5. |

## 1. Production-schema fingerprint

The rebuilt baseline equals production on all 18 groups (1,027 objects:
relations, columns, constraints, indexes, triggers, policies, functions,
ownership, ACLs, buckets, extensions, schemas). The only excluded object is
`public.fleet_inbox_wake()`, which is blocked from calling out on purpose. A
second rebuild from scratch reproduced it exactly.

Getting there showed that production differs from the repo's migration
ledgers. The baseline therefore has:

- Repo seq 61, `rental_activation_guards`. It has no receipt, but production
  holds its two `rentals_one_active_*` indexes and the packet needs them.
- The drizzle-kit runner ledger: 23 rows, read from production.
- A parity file covering:
  - three function bodies applied out of band with comments stripped;
  - no `anon` grant on `vehicle_media`;
  - ten private buckets.

## 2. M2 install and rollback

**Install.** Preflight passed with 0 rows not ok. Steps 1–29 all verified
`t`, and `no-executor-create` returned `t`.

**Defect in step 3, hosted only.** Approved step 3 fails with `42501 must be
able to SET ROLE "rr_approval_executor"`, then `permission denied for schema
public`. The local rehearsal ran as superuser and never hit this. Step 5
already grants the same pair for `rr_record_executor`; step 3 does not.

The fix is two separate files. The approved packet is unchanged.

- `proposed/m2-hosted-amendments/03-pre-approval-executor-owner.sql` runs
  before step 3. It grants `postgres` SET on `rr_approval_executor` and grants
  `CREATE` to that role.
- `proposed/m2-hosted-amendments/03-post-approval-executor-create.sql` runs
  after step 3. It revokes that `CREATE`.

**Defect in rollbacks 1, 5 and 7, hosted only.** Each fails on two statements:

- the `REVOKE` on `vault` functions;
- `DROP OWNED BY`.

The hosted variants are in `proposed/m2-hosted-amendments/rollback/`. Each
differs from the approved file by exactly one line removed and one line added,
and `scripts/m2-hosted-rollbacks.test.mjs` enforces that.

**Rollback results:**

- Rollback of a used install: each of steps 29 → 10 committed, and the
  previous step's verify returned `t` after each.
- Step 9's rollback refused, and so did step 3's
  (`*_rollback_unused_install_only`). Resolved identity reviews are immutable.
  **After the first real approval, steps 3 and 9 cannot be undone except by
  PITR.**
- Full rollback of an unused install back to baseline: 16 of 18 groups are
  byte-equal. The other 2 differ only in how 6 private objects store their ACL
  (NULL versus the identical explicit default). `acl = acldefault` holds for
  all 6.
- Interrupted install, stopped after step 7: `no-executor-create` returned
  `f`. After running step 29 early it returned `t`, and the install resumed
  through steps 8–25.
- Reduced path 1–25 + 29: the composed verify returned `t`. Step 29's own
  query returned `f`, as documented.

## 3. Real Storage, JWT and schema cache

All calls used real GoTrue JWTs, PostgREST and the Storage API.

**Storage and hashing:**

- Owner upload and download of synthetic licenses: the bytes matched.
- Manager, Coordinator and Driver are refused reads and writes on
  `driver-docs`.
- A Manager JWT is refused `record_uploaded_content_sha` (`42501`).
- Binding from the downloaded bytes left the backfill report at missing=0 and
  mismatched=0. Rebinding with a different hash is refused.

**Schema cache.** Before step 3, PostgREST returns `42703` for the column and
`PGRST202` for the function, so Release A stays on the legacy path, and a
legacy write succeeds. Right after step 3, PostgREST reloaded on its own: the
column read `0`, the RPC resolved, and the legacy write is refused
(`approval_rpc_required`). The stale-cache window could not be observed; that
branch is covered by unit tests only.

**Approval:**

- Coordinator, Driver and anon are refused (`manager_required` / 401).
- Manager: preview → identity decision → readiness → approve succeeds.
- These are all refused:
  - a stale version;
  - altered evidence;
  - a blank note;
  - a second approve;
  - a direct status write.
- Recovery returns the committed operation.
- There is exactly one audit row, attributed to the Manager.

**Re-approval:**

- A replacement photo blocks approval until it is reviewed.
- The old identity decision does not carry over to the new photo.
- A fresh decision approves.
- Silently overwriting a bound object blocks approval
  (`approval_storage_version_unverified`).

**Not verified on hosted:**

- the real `scripts/backfill-document-content-sha.ts --write`, because there
  is no service_role key for the disposable project; its SQL path was
  exercised instead;
- the record-rental evidence issuer;
- subscription and agreement evidence beyond the per-step catalog verifies.

## 4. Temporary privileges and cleanup

- The `CREATE` grants for `rr_record_executor` and `rr_approval_executor` are
  revoked, and `no-executor-create` returned `t`.
- The upload path was opened three times, and closed each time with the stage
  table dropped and the uploader deleted.
- Final read-only check:
  - no `rehearsal` schema and no `zz_` objects;
  - 0 auth users, sessions and tokens;
  - 0 storage objects, 0 `rr_` roles, 0 cron jobs, 0 queued HTTP requests;
  - no API role holds `CREATE` anywhere.
- Six cron schedules per build were blocked, all targeting drivereal.com.
  None was ever committed.

The project is kept for your review. Delete it, and its allowlist entry, in
Lovable when you are done.

## 5. Blockers to activating Record Rental

1. You approve the two step-3 amendments and the three hosted rollback
   variants. Without them, production step 3 fails.
2. The app has no Record Rental runtime:
   - `configureRecordRentalV2` is never called;
   - `RECORD_RENTAL_CONTRACT_ENABLED` is false on every branch;
   - nothing provides:
     - the issuer SQL transport;
     - the Stripe subscription gateway;
     - linkage;
     - the document download reader.
3. The server-only `rr_evidence_transport` login is not provisioned. Lovable
   Cloud may not offer the direct Postgres connection it needs.
4. The production byte backfill needs a service_role run of the script. The
   SQL report must then show 0/0 before step 3.
5. Security 0031 is still gated separately.

## 6. Smallest production approval sequence

1. **Approve the hosted amendments.** These are the files in
   `proposed/m2-hosted-amendments/`, to be added to `HOSTED-INSTALL.md`'s order
   table as 3-pre and 3-post.
2. **Publish Release A** (flags off). It is inert: the gate keeps the legacy
   approval path. Do read-only Preview checks.
3. **Window 1:**
   - preflight;
   - steps 1–2 with verifies;
   - backfill script `--write`;
   - SQL report = 0/0.
4. **Publish Release B** (flags on).
5. **Window 2:**
   - 3-pre → step 3 → 3-post;
   - steps 4–29 with verifies;
   - `no-executor-create` = `t`.
6. **Record Rental**, a separate later approval, once §5 items 2–3 are built
   and rehearsed.
