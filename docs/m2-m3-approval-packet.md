# Owner approval: M2 and M3

Nothing on this page has been run on production. Pull request 190 is `3f5b798a`. Pull request 232 is `cb9fbbf9`. Both stay drafts. The switches that turn new screens on stay off.

## What each migration installs

M2 is 29 database steps. It records who may approve a renter, record a rental, swap a car, extend a rental, and keep a signed agreement. It stores a fingerprint of each current license photo from the file the server downloaded. It adds the return-checklist tables. It does not turn those features on.

M3 is two steps. The first adds two empty dates: when the Uber approval expires, and when the Lyft approval expires. Existing applications are not rewritten. The second stops the Coming Soon waitlist at five signups for the same email in one hour. That limit starts when the step is saved. It does not store a claim token.

## What changes for users

Nothing visible. Approve, signing, and the rest of the live app stay as they are while every switch stays off. Staff identity check, fingerprints on new uploads, vehicle swap, and rental extend wait for a later approval. The waitlist limit starts only when M3 step 2 is saved: a sixth signup from the same email in one hour is refused.

## Who runs what

You run each database file in Lovable, one file at a time, after a backup. A person with the service_role key runs the license backfill. You do not. The preflight reader does not.

1. Confirm a backup, or point-in-time recovery, covers the start.
2. Ship the application from pull request 190. Leave every switch off.
3. You run the M2 read-only preflight as a least-privilege login. Every line must say PASS.
4. You run M2 steps 1 and 2. Each check must say true.
5. Stop. The service_role holder runs a dry-run, which does not download, then `--write`. You run `proposed/backfill-document-content-sha.sql` in Lovable. Before step 3, `--write` must show `missing_file=0` and `mismatched=0`, and the report must show `missing=0` and `mismatched=0`. A dry-run `mismatched=0` is not that gate.
6. You run M2 steps 3 through 29. Do not run the agreement-evidence file again after the agreement-contract file.
7. You run the M3 preflight, then M3 step 1, then M3 step 2.

Do M2 first unless you want the waitlist limit first. File lists: `proposed/HOSTED-INSTALL.md` and, on pull request 232, `proposed/m3/HOSTED-INSTALL.md`.

## How long

On an empty local database the M2 rehearsal, including every check and a full undo, finished in about 11 seconds on `3f5b798a`. The M3 rehearsal exited 0 on `cb9fbbf9` and finished in about 2 seconds locally. Each install file is one short transaction. The backfill downloads one file per current license photo. A local scratch run of about 1,000 files finished in 0.7 seconds. That is not a production window. If a file errors, stop.

M2 succeeded when all 29 checks said true and the preflight printed `checklist stops=0` (246 checks locally). M3 succeeded when both checks said true and the preflight printed `checklist stops=0 checks=18`.

## Undo

Use an undo only when that step saved and then failed its check. A file that errors before it saves has already undone itself. If an undo cannot be applied, restore the backup. M2 undos, in order:

1 `proposed/rollback/01-auth-binding.sql`. 2 `proposed/rollback/record-uploaded-content-sha.sql`. 3 `proposed/rollback/00-approval-boundary.sql`.
4 `proposed/rollback/02-safe-release.sql`. 5 `proposed/rollback/03-record-rental.sql`. 6 `proposed/rollback/04-closeout-legacy-guard.sql`.
7 `proposed/rollback/05-evidence.sql`. 8 `proposed/rollback/06-document-identity.sql`. 9 `proposed/rollback/06b-approval-identity-check.sql`.
10 `proposed/rollback/07-evidence-consumer.sql`. 11 `proposed/rollback/08-evidence-recovery.sql`. 12 `proposed/rollback/09-issuer-permissions.sql`.
13 `proposed/rollback/10-approval-permissions.sql`. 14 `proposed/rollback/10b-approval-executor-writes.sql`. 15 `proposed/rollback/11-executor-permissions.sql`.
16 `proposed/rollback/12-deposit-nullability.sql`. 17 `proposed/rollback/13-closeout-projection.sql`. 18 `proposed/rollback/14-issuer-identity-permissions.sql`.
19 `proposed/rollback/15-consumption-scope.sql`. 20 `proposed/rollback/16-closeout-scope.sql`. 21 `proposed/rollback/17-storage-integrity.sql`.
22 `proposed/rollback/18-subscription-coordination.sql`. 23 `proposed/rollback/19-signed-archive-protection.sql`. 24 `proposed/rollback/19b-agreement-evidence.sql`.
25 `proposed/rollback/19c-agreement-contract.sql`. 26 `proposed/rollback/20-vehicle-swap.sql`. 27 `proposed/rollback/extend-rental.sql`.
28 `proposed/rollback/return-checklist.sql`. 29 `proposed/rollback/21-revoke-executor-create.sql`.

The backfill undo is not an install step. The table owner runs `proposed/rollback/backfill-content-sha.sql`. It clears the document fingerprint, deletes the binding, and removes `user_metadata.sha256`. It does not put back a client `content_sha256` key. `service_role` cannot delete the binding.

M3: `proposed/m3-rollback/01-tnc-approval-expiry.sql`, then `proposed/m3-rollback/02-waitlist-coming-soon-rate.sql`.

## Risks

Installing M2 step 3 before the application is live, or before the license fingerprints are backfilled, closes Approve for everyone.

Run the preflight as a least-privilege login. A superuser can ignore the read-only setting, and dblink or postgres_fdw can write during it. Remove those add-ons first. The script stops a superuser.

A half-finished M2 leaves Approve and signing on a partial database. Stop at the first failed check. These files do not turn on identity check, new-upload fingerprints, swap, or extend. The waitlist limit counts the email only.
