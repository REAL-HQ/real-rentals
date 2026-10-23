# M2 checksum-gated rehearsal — design for approval

2026-10-23. **Design only.** No database object from this design exists yet.
Supersedes `M2-REHEARSAL-BULK-PROPOSAL.md` (which used an `anon` uploader; the
owner ruled that out).

## 0. A finding that changes the baseline: production ≠ the repo directory

Read-only comparison of production's two ledgers against the repo, by SHA-256 of
the stored statement text:

| Ledger | Receipts | Byte-identical to a repo file | Other |
|---|---|---|---|
| `supabase_migrations.schema_migrations` | 105 | **100** | 3 empty (applied out-of-band: repo 73–75); 2 with **no** identical repo file — `20260628200526` (**not in the repo at all**) and `20261011180000` (differs from repo `contact_status`) |
| `drizzle.__drizzle_migrations` | 23 | **23** (repo 0000–0022) | applied 2026-10-08 … 10-19, after Supabase `20261007120336`; 22 of them before `20261011180000` |

And the other direction:

- **18 repo migration files production never ran** (seq 60–65, 77–88). Their
  tables were created by Lovable's own copies, which *are* receipted
  (`20260925130309`, `…130344`, `…130550`). Replaying both is what caused the
  earlier rehearsal's duplicate `CREATE POLICY`/`TRIGGER` failures.
- **4 tables exist in production with no ledger record at all**:
  `applicant_upload_grants`, `application_resume_tokens`, `vehicle_finance`,
  `vehicle_media`.

So **no replay of the repo directory reproduces production**, and the hand-relayed
project (which replayed repo seq 1–60, including unreceipted seq 60) is
unrepresentative. The `sms_consent` ordering defect is probably an artefact of the
same thing: the missing receipt `20260628200526` sits between repo seq 30 and 31.

### Baseline, revised

1. Supabase receipts in **production order**: the 100 byte-identical repo files;
   the 3 out-of-band ones from their repo files (flagged); the 2 receipt-only
   statement texts **fetched read-only from production**, scanned for secrets,
   committed as checksummed files.
2. Drizzle 0000–0022 interleaved at their production timestamps. This replaces
   the 3-object `drizzle-prerequisites.sql` extract.
3. The 18 never-run repo files are **excluded**.
4. A **parity file** for the 4 ledger-less tables, generated read-only from
   production's catalog (`pg_get_*` definitions only, no rows).
5. **Acceptance gate, fail closed:** a catalog fingerprint of the rebuilt baseline
   must **equal** production's over the packet's dependency surface — tables,
   columns, constraints, indexes, policies, function definitions and ACLs,
   triggers, schema and table grants, roles — across `public`, `private`,
   `storage` policies and `drizzle`. A mismatch stops the rehearsal and prints the
   diff. This proves representativeness however the baseline was built.

## 1. Uploader authorization — no `anon` access anywhere

- **Stage table** `public.zz_rehearsal_stage(filename, body)` (PostgREST exposes
  only `public`). RLS on. **One** policy: `INSERT TO authenticated WITH CHECK
  (auth.uid() = '<one pinned uuid>')`. Column-level `INSERT` grant only. No
  `SELECT`/`UPDATE`/`DELETE` for any API role. `REVOKE ALL FROM anon`.
- **Pinned uploader**: one synthetic auth user created through the privileged
  channel, email pre-confirmed so **no email is ever sent**, **no `user_roles`
  row**, so no application privilege. Its password is generated locally into the
  session scratchpad (mode 0600). **Only the bcrypt hash crosses the tool
  channel** (local `$2b$` hashing confirmed). The JWT is obtained over HTTPS by
  `curl` from this session.
- **Content gate**: a `BEFORE INSERT` trigger rejects any row whose filename is
  not on the allowlist, whose SHA-256 is not the approved hash, or which was
  already staged. Its function lives in non-exposed schema `rehearsal` and returns
  `trigger`, so it is not an RPC.
- **Window**: upload only. Then **seal**: copy rows into `rehearsal.sealed`,
  assert set equality with the allowlist (count and every hash), **drop the public
  stage table** (policy and trigger go with it), **delete the uploader user**
  (sessions and refresh tokens cascade), and assert all absent — **before anything
  executes**.

## 2. Execution — no stored executor, no RPC

- Only through the privileged `query_database` channel, as an **anonymous `DO`
  block**. Nothing persistent can execute SQL, before or after.
- Per file, inside its own transaction:
  1. ordering — ledger's last sequence must be this sequence − 1;
  2. re-hash the sealed bytes against the allowlist;
  3. apply the manifest's transform (`none` / `strip_txn` / `cron_block`);
  4. hash the result against the manifest's `executed_sha256`, which the local
     generator computed independently — two implementations must agree;
  5. `EXECUTE`;
  6. post-conditions (below);
  7. ledger row with **both** hashes, the transform and timings.

  Any failure raises: that file's transaction rolls back and the run stops.
- **Per-file transactions**: if `query_database` permits a top-level `DO` with
  `COMMIT` between files (to be probed first), several files run per call, each
  committed separately; otherwise one file per call. Either way it is one file =
  one transaction, matching `psql -1` and the runbook's own-transaction files.
- **Verify files** (`proposed/rehearsal/verify/step-NN.sql`, extracted verbatim
  from `HOSTED-INSTALL.md` by the generator): `EXECUTE … INTO ok`, must be `t`.
  **Preflight**: the runbook's own wrapper — zero rows `WHERE ok IS NOT TRUE`.
- **Fail-closed post-conditions after every file**: `cron.job` = 0; blocked-cron
  count equals the number expected so far; stage table and uploader absent; no
  `rr_%` role before packet step 1; `anon`/`authenticated` without `USAGE` on
  `private` once the baseline establishes it; each packet step's verify = `t`.
- **Rollback**: catalog fingerprint before step 1; run the reverse rollbacks; the
  fingerprint must be equal again. The reduced 1–25 + 29 path gets the same
  treatment, plus the interrupted-install drills (stop after 7 → early revoke →
  `no-executor-create.sql` = `t` → resume).

## 3. Cron transformation — deterministic, separately checksummed

- **One rule**, on exactly the eight files (seq 46, 47, 58, 60, 62, 68, 69, 92 —
  found by scan, one call each): replace the single `cron.schedule(` with
  `rehearsal.cron_schedule_blocked(`. The generator asserts exactly one
  replacement, that the job body names `drivereal.com`, and that no
  `cron.schedule(` survives.
- The stub records `(file, jobname, schedule, command)` in
  `rehearsal.blocked_cron`, returns −1, and **schedules nothing**.
- The transformed bytes get their own hash in the manifest, and the SQL side must
  reproduce it.
- **Backstop**: `cron.job` must be 0 before every commit, so even a defect in the
  transform cannot let a job targeting drivereal.com commit.
- Under the production-order baseline, seq 60 and 62 are among the never-run
  files and drop out. The rule still covers whichever of the eight are replayed.

The only other transform, `strip_txn`, removes exactly one top-level `BEGIN;`
line and one `COMMIT;` line, both asserted. It applies to the packet's five
boundary files, the rollbacks and one baseline file.

## 4. Cleanup guarantees

1. Before execution: the uploader path is gone (section 1, seal).
2. After the run: the ledger, blocked-cron records, verify results and
   fingerprints are **exported into the repo** as the rehearsal record.
3. Synthetic test users (uploader, manager, coordinator, driver) are deleted,
   and Storage test objects are deleted through the Storage API.
4. `DROP SCHEMA rehearsal CASCADE`. A closing query must return `t`: no
   `rehearsal` schema, no `zz_` objects, no synthetic users, `cron.job` = 0, and
   after a full rollback no `rr_%` role.
5. Both disposable Lovable projects — the hand-relayed one and the new one — are
   for you to delete in Lovable. Remove both allowlist entries afterwards.

## 5. Prepared, not run against any database

`scripts/m2-rehearsal-manifest.mjs`: 215 entries, 1.15 MB, with
`strip_txn` = 36 and `cron_block` = 8; every transform's assertions pass. It
cross-checks 6 of the approved packet hashes (all match) and confirms the
original packet, rollbacks, `HOSTED-INSTALL.md` and migrations are unchanged
against `29d47ee3`. It also generates the 29 verify files verbatim from the
runbook. This is **v1, in repo order**. It is regenerated in production order
once section 0 is approved.

## Owner decisions

1. Approve this design, **including** the read-only fetch from production of:
   the 2 receipt-only statement texts, the catalog definitions of the 4
   ledger-less tables, and the dependency-surface fingerprint. These are schema
   only, never rows, and are scanned for secrets before they enter the repo.
2. After I create the fresh project, allowlist its host (HTTPS 443 only).
