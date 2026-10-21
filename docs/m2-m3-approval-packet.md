# Owner approval: M2 and M3 database changes

Nothing on this page has been run on the production database. Pull requests 190 and 232 stay drafts. The switches that turn new screens on stay off.

## What each change does

M2 (pull request 190, `2889d76d`) is 29 database steps. It records who may approve a renter, record a rental, swap a car, extend a rental, and keep a signed agreement. It stores a fingerprint of each license photo from the file the server downloaded, so a browser cannot supply that fingerprint. It adds the return-checklist tables. It does not switch those product features on.

M3 (pull request 232, `ea6c1978`) is two steps. The first adds two empty dates on an application: when the Uber approval expires, and when the Lyft approval expires. Existing applications are not rewritten. The second stops the Coming Soon waitlist at five signups for the same email in one hour. That limit starts as soon as the second step is saved. It does not store a claim token.

## What each one allows

After the M2 application is already live, Approve uses the checked path. Approving someone who is already approved does not write a second audit note. Staff identity check, fingerprints on new uploads, vehicle swap, and rental extend stay off until you approve each switch on its own. The database has to be ready before those switches can be turned on.

M3 lets a later application change save the Uber and Lyft dates. The waitlist limit needs no switch.

## Order

1. Confirm a backup, or point-in-time recovery, covers the start.
2. Ship the application from pull request 190. Leave every switch off.
3. Run the M2 read-only preflight. Every line must say PASS.
4. Run M2 steps 1 and 2. Each check must say true before the next step.
5. Stop before M2 step 3 until the builds with the two approval switches are deployed (a separate approval; both stay off here), the license-byte backfill has run, and its report shows zero missing and zero mismatched.
6. Run M2 steps 3 through 29, one file at a time. Do not run the agreement-evidence step again after the agreement-contract step.
7. Run the M3 preflight, then M3 step 1, then M3 step 2.

Finish one packet before you start the other. M3 was rehearsed on a database that did not have M2. Do M2 first unless you want the waitlist limit first. The file lists are `proposed/HOSTED-INSTALL.md` and, on pull request 232, `proposed/m3/HOSTED-INSTALL.md`.

## The preflight login

Run the preflight as a least-privilege read-only role. That login is not a superuser, and it cannot create databases or roles. On the rehearsal it could read tables and nothing else (`pg_read_all_data`). The script stops a superuser with: run as least-privilege read-only role. It does not create the login. The database must not have the dblink or postgres_fdw add-ons, because those can write during a read-only session. `standard_conforming_strings` must be on. Do not set it in the connection address. A production address also needs the hosted switch named in the procedure. This rehearsal did not use it.

## How long, and how to tell it worked

On an empty local database the M2 rehearsal, including every check and a full undo, finished in about 15 seconds. The M3 rehearsal finished in about 2 seconds. On production each file is one short transaction. The long wait is the pause before M2 step 3. If a file errors, stop. Do not start the next file.

M2 succeeded when all 29 checks say true and the preflight, before any write, prints `checklist stops=0`. Locally that was 246 checks. M3 succeeded when both checks say true and the preflight prints `checklist stops=0 checks=18`.

## Undo, and the rehearsal

Each step has a matching undo. Use it only when that step saved and then failed its check. A file that errors before it saves has already undone itself. If an undo cannot be applied, restore the backup.

The M2 rehearsal (`scripts/m2-rehearsal-proof.sh`) exited 0 on `2889d76d`. All 29 checks returned true. Every undo matched the snapshot from before that step. After the full undo the private installer roles, applications, and approval functions were all 0.

The M3 rehearsal (`scripts/m3-rehearsal-proof.sh`) exited 0 on `ea6c1978`. Both checks returned true, both undos matched the earlier snapshot, and the scratch database and the read-only login were removed. The shared local database still had no Uber or Lyft dates and no waitlist limit.

## Risks

Installing M2 step 3 before the new application is live, or before the license fingerprints are backfilled, closes Approve for everyone. Ship the application first, and keep the pause before step 3.

A superuser can ignore the read-only setting, and dblink or postgres_fdw can write during it. Use the least-privilege login, and remove those add-ons before the preflight.

A half-finished M2 leaves Approve and signing on a partial database. Stop at the first failed check.

Installing these files does not turn on identity check, new-upload fingerprints, swap, or extend. Each of those is a later decision.

The waitlist limit counts the email only. A limit by network address would be a separate decision.
