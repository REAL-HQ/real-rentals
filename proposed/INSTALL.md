# M2 rehearsal install

Local rehearsal install. The hosted procedure is [HOSTED-INSTALL.md](HOSTED-INSTALL.md). Do not paste these files into a hosted database except by that procedure.

`scripts/m2-rehearsal-proof.sh` is the executable form of this runbook. It talks only to `postgresql://postgres@127.0.0.1:55442/m2`. Build that database with `scripts/m2-baseline-builder.sh` after `supabase/migrations` are loaded.

Packet files have no `BEGIN`/`COMMIT`. Own files and rollbacks do. `psql -1` wraps the file in a transaction, so a file that already has `BEGIN` must not also be passed `-1`.

## Packet files: `psql -v ON_ERROR_STOP=1 -1 -f`

Every file in `proposed/m2-packet/`:

`01.sql`, `02.sql`, `03.sql`, `04.sql`, `05.sql`, `06.sql`, `07.sql`, `08.sql`, `09.sql`, `10.sql`, `11.sql`, `12.sql`, `13.sql`, `14.sql`, `15.sql`, `16.sql`, `17.sql`, `18.sql`, `19.sql`, `19b.sql`, `20.sql`, `extend.sql`, `return.sql`.

`17.sql` is one of those packet files. The proof applies it locally with `psql -1`. A hosted run follows [HOSTED-INSTALL.md](HOSTED-INSTALL.md).

## Own files: `psql -v ON_ERROR_STOP=1 -f` and no `-1`

Each of these contains its own `BEGIN`/`COMMIT`:

- `proposed/m2-with-approval-boundary/00-approval-boundary.sql`
- `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql`
- `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql`
- `proposed/m2-with-approval-boundary/19c-agreement-contract.sql`
- `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql`

`approval-boundary.local.sql` is the excluded script. The proof does not apply it.

## Rollbacks: `psql -v ON_ERROR_STOP=1 -f` and no `-1`

Every file in `proposed/rollback/` except `00-approval-data-export.sql` contains its own `BEGIN`/`COMMIT`.

`00-approval-data-export.sql` is read-only `COPY TO STDOUT`. It has no `BEGIN`. Run it without `-1`.

Rollback past 06b is for an unused install. `06b-approval-identity-check.sql` raises `06b_rollback_unused_install_only` when a verified `approval_identity` row exists. `00-approval-boundary.sql` raises `00_rollback_unused_install_only` when any `approval_identity` or `verified` row exists, because the check it restores rejects those rows. Export with `00-approval-data-export.sql`, migrate the rows, and remove them before that rollback. An empty install restores the original check.

## Preflight: no `-1`

`proposed/m2-preflight.sql` is one read-only `SELECT`. Run it without `-1`, after `storage.objects.user_metadata` and `storage.objects.version` exist and before step 1. `private.approval_validate` and `private.approval_snapshot` are expected absent. Step 3 creates them.

## Order

The sequence is the HOSTED-INSTALL table. Content-sha is step 2, before the approval boundary. The revoke file is step 29.

| Step | File | psql |
| --- | --- | --- |
| 1 | `proposed/m2-packet/01.sql` | `-1` |
| 2 | `proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql` | own `BEGIN`/`COMMIT`, no `-1` |
| 3 | `proposed/m2-with-approval-boundary/00-approval-boundary.sql` | own `BEGIN`/`COMMIT`, no `-1` |
| 4 | `proposed/m2-packet/02.sql` | `-1` |
| 5 | `proposed/m2-packet/03.sql` | `-1` |
| 6 | `proposed/m2-packet/04.sql` | `-1` |
| 7 | `proposed/m2-packet/05.sql` | `-1` |
| 8 | `proposed/m2-packet/06.sql` | `-1` |
| 9 | `proposed/m2-with-approval-boundary/06b-approval-identity-check.sql` | own `BEGIN`/`COMMIT`, no `-1` |
| 10 | `proposed/m2-packet/07.sql` | `-1` |
| 11 | `proposed/m2-packet/08.sql` | `-1` |
| 12 | `proposed/m2-packet/09.sql` | `-1` |
| 13 | `proposed/m2-packet/10.sql` | `-1` |
| 14 | `proposed/m2-with-approval-boundary/10b-approval-executor-writes.sql` | own `BEGIN`/`COMMIT`, no `-1` |
| 15 | `proposed/m2-packet/11.sql` | `-1` |
| 16 | `proposed/m2-packet/12.sql` | `-1` |
| 17 | `proposed/m2-packet/13.sql` | `-1` |
| 18 | `proposed/m2-packet/14.sql` | `-1` |
| 19 | `proposed/m2-packet/15.sql` | `-1` |
| 20 | `proposed/m2-packet/16.sql` | `-1` |
| 21 | `proposed/m2-packet/17.sql` | `-1` |
| 22 | `proposed/m2-packet/18.sql` | `-1` |
| 23 | `proposed/m2-packet/19.sql` | `-1` |
| 24 | `proposed/m2-packet/19b.sql` | `-1` |
| 25 | `proposed/m2-with-approval-boundary/19c-agreement-contract.sql` | own `BEGIN`/`COMMIT`, no `-1` |
| 26 | `proposed/m2-packet/20.sql` | `-1` |
| 27 | `proposed/m2-packet/extend.sql` | `-1` |
| 28 | `proposed/m2-packet/return.sql` | `-1` |
| 29 | `proposed/m2-packet/21-revoke-executor-create.sql` | `-1` |

Roll step 29 back first. Then roll back return, extend, 20, 19c, 19b, 19 through 2, 00, the content-sha file, and 01. Step 29's rollback grants `CREATE` on `public` and `private` back to `rr_record_executor`. Compare each schema dump with the snapshot taken after the previous step.
