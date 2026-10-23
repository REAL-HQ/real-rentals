# M2 hosted installation package

**Proposed, not authorized.** This is the install sequence rehearsed on hosted
Supabase (PostgreSQL 17, `postgres` not a superuser) on 2026-10-23. Each window
needs its own owner approval. Nothing here runs by itself.

## What is in the package

| | Files | Status |
|---|---|---|
| Approved packet | `proposed/m2-packet/*`, `proposed/m2-with-approval-boundary/*` | **Unchanged.** Byte-identical to `29d47ee3`. |
| Approved rollbacks | `proposed/rollback/*` | **Unchanged.** Byte-identical to `29d47ee3`. |
| Hosted amendments | `proposed/m2-hosted-amendments/03-pre-approval-executor-owner.sql`, `03-post-approval-executor-create.sql` | **New.** They run immediately before and after step 3. |
| Hosted rollback variants | `proposed/m2-hosted-amendments/rollback/{01-auth-binding,03-record-rental,05-evidence}.sql` | **New.** Each is one line removed and one added; see `ROLLBACK-VARIANTS.diff`. |
| Verifies | `proposed/rehearsal/verify/step-NN.sql` | Generated verbatim from `HOSTED-INSTALL.md`. |
| Assertions | `proposed/m2-verify/no-executor-create.sql`, `step29-after-step25.sql` | Read-only. |
| Checksums | `SHA256SUMS`, `MANIFEST.md` | From `scripts/m2-hosted-install-package.mjs`, which fails if any approved file differs from `29d47ee3`. |

Check the bytes before each window:

```
node scripts/m2-hosted-install-package.mjs --check
sha256sum -c proposed/m2-hosted-install/SHA256SUMS
```

## Why the amendments exist

On hosted Supabase the installer is not a superuser. Two things fail as a result.

**Step 3 fails.** It runs `ALTER FUNCTION ... OWNER TO rr_approval_executor`,
which fails with `42501 must be able to SET ROLE`. Once that passes, it fails
again with `permission denied for schema public`. Step 5 already grants the same
two privileges for `rr_record_executor`; step 3 never did.

- `03-pre` grants `postgres` SET on the role, and grants the role `CREATE` on
  `public` and `private`.
- `03-post` revokes that `CREATE`.

**Rollbacks 1, 5 and 7 fail.** Two statements in each fail:

- a `REVOKE` on Supabase-owned `vault` functions;
- `DROP OWNED BY`, without inherited privileges.

The hosted variants drop that `REVOKE` and grant `INHERIT` just before
`DROP OWNED BY`. `DROP ROLE` removes that membership a few lines later.

## Before either window

1. **Backups and point-in-time recovery are confirmed available** for the
   production project. Have the restore point and how to request it ready.
   After the first real approval, steps 3 and 9 **cannot be rolled back**:
   resolved identity reviews are immutable, and their rollbacks refuse. A
   restore is then the only way back.
2. `node scripts/m2-hosted-install-package.mjs --check` passes.
3. Nobody approves applicants or signs agreements during the window.

## Window 1

1. **Release A is live** (flags off). Its gate keeps today's approval path while
   the packet is absent.
2. **Preflight.** Run `proposed/m2-preflight.sql` wrapped as
   `SELECT ... FROM (<file>) q WHERE ok IS NOT TRUE`. It must return **zero
   rows**.
3. **Step 1**, then its verify. The verify must return `t`.
4. **Step 2**, then its verify. The verify must return `t`.
5. **Backfill the license hashes.** Run, with the production service_role key in
   the operator's shell only:

   ```
   bun scripts/backfill-document-content-sha.ts --url <project>
   bun scripts/backfill-document-content-sha.ts --url <project> --write
   ```

   The write must end with `missing=0 mismatched=0 storage_errors=0`.
6. **The gate.** Run `proposed/backfill-document-content-sha.sql`. It must
   report `missing=0` and `mismatched=0`.
7. **Stand down.** `no-executor-create.sql` must return `t`.

Window 1 adds no approval behaviour. Release A keeps approving the old way.

## Window 2

1. **Release B is live** (flags on).
2. **3-pre**, then **step 3**, then **3-post**, each in its own run. Then step
   3's verify, which must return `t`.
3. **PostgREST cache.** In the rehearsal, hosted PostgREST reloaded by itself
   right away. If an approval returns *"reload the PostgREST schema cache"*,
   run `NOTIFY pgrst, 'reload schema';`. In that window the gate refuses; it
   never falls back to a legacy write.
4. **Steps 4–29**, each followed by its verify (`t`). Use the order table in
   `HOSTED-INSTALL.md`.
5. **Close out.** `no-executor-create.sql` must return `t`. The `CREATE` grants
   given to `rr_record_executor` (step 5) and `rr_approval_executor` (3-pre) are
   now revoked.

**Approve is unavailable** from step 3 until step 13 (`10.sql`). That step
grants the approval executor what it needs. Do not pause Window 2 between those
steps.

## If a window stops part-way

Every install file and every rollback is one transaction. A failed file leaves
nothing behind. Find the last committed step with
`scripts/m2-hosted-preflight.ts`, run `no-executor-create.sql`, then take the
matching row:

| Stopped | Temporary privilege still held | Action |
|---|---|---|
| Before step 5, not inside 3-pre…3-post | none | Run the assertion; it returns `t`. Stand down. |
| **After 3-pre, before 3-post** | `CREATE` on `rr_approval_executor` | Resuming: run step 3, then 3-post. Abandoning: run 3-post now. Then the assertion. |
| After step 5, before step 8, abandoning | `CREATE` on `rr_record_executor` | Run the rollbacks in strict reverse order. Use the **hosted variants** for steps 7, 5 and 1. |
| At or after step 8, before 29, resuming later | `CREATE` on `rr_record_executor` | Run step 29's file now, then the assertion. Resume later (rehearsed: drill after step 7). Not if you will resume into step 26: re-grant with step 29's rollback first. |
| Any stop, with a verified approval-identity row | — | Steps 9 and 3 refuse to roll back. **Restore from backup/PITR.** Do not force the rollback. |
| Through step 29 | none | Step 29's verify. For a 1–25 install, use `step29-after-step25.sql`. |

Rollback order is strict reverse. After each rollback, the previous step's
verify must return `t`. The rehearsal did exactly this, from 29 down to 1.

## Rehearsal evidence

- **Hosted:** `docs/development/M2-REHEARSAL-RESULT.md`.
- **Local stack** (production-order baseline, real PostgREST):
  - `scripts/m2-window1-drill.test.ts` — the actual backfill script, the gate
    report, and the stale PostgREST cache.
  - `scripts/record-rental-e2e.test.ts` — Record Rental end to end.

  Both are on branch `feature/record-rental-runtime`.
