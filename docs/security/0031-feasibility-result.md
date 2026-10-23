# Security 0031 — single-atomic installation feasibility

Prepared 2026-10-23 by Claude Code. Reproduced in a **throwaway PostgreSQL 16
cluster**. No hosted SQL, no production executor probe, no ownership or
privilege change anywhere near production. Harness:
`scripts/0031-feasibility/` (`roles.sql`, `schema.sql`, `package.sql`, `run.sh`).

## The question

Can the authorized Supabase migration route install **all five restrictive
policies atomically** while satisfying the package's role, catalog and journal
checks?

## The answer: yes — atomicity is proven, and exactly one variable decides it

The five policies install in a **single transaction**, and a failure on the one
privileged policy rolls back **all five**. So no split is needed or justified.
The only open variable is whether the executing role holds storage-owner
authority.

| # | Executor | Package's role pin | Result | Policies left |
|---|---|---|---|---|
| S1 | `postgres`-like, **no** storage-owner membership — *production today* | matches | `must be owner of table objects` | **0 — all five rolled back together** |
| S2 | `postgres`-like, **with** storage-owner membership | matches | **INSTALL_OK, one transaction** | 5, storage restrictive **0 → 1** |
| S3 | superuser, pin still says `postgres` | mismatch | `TARGET_MISMATCH` **before any DDL** | 0 |
| S4 | superuser, pin matches (control) | matches | INSTALL_OK | 5 |

**16/16 checks pass.** Also established:

- **Journal pin holds.** The Supabase route does not write
  `drizzle.__drizzle_migrations`, so it stays at 23 rows and a pin at 23 passes
  (S5). Letting `0023` land first moves it to 24 and correctly raises
  `JOURNAL_DRIFT_OR_REPLAY`, installing nothing.
- **Rollback is clean.** Dropping the five policies leaves 0 behind, the drizzle
  ledger still at 23, and RLS still enabled on all five relations (S6).
- **Atomicity is the package's own property**, not something the route grants:
  S1 proves a mid-transaction privilege failure discards the four policies that
  had already been created.

### The model

Local stand-ins for the production shape read from the catalog on 2026-10-23:
`app_exec` ← `postgres` (owns `public.*`, BYPASSRLS, **not** superuser),
`storage_owner` ← `supabase_storage_admin` (owns `storage.objects`, **zero
members**), `super_exec` ← `supabase_admin` (the one superuser). The five
`CREATE POLICY` statements are **verbatim** from the approved inner SQL
(`cf8d5572670cb3f865fc0911d623ff070e6a9be1ca8d254c87db8f2a5c3cd723`). The gates
reproduce the real role pin, partial-install refusal and journal pin.

What the model does **not** reproduce: the production `catalog_sha256` seal,
which can only be computed against the real catalog. Everything else about the
gating is faithful.

### Three harness bugs found and fixed, because each produced a false result

1. **Roles are cluster-global.** Creating them inside the per-database schema
   made every reset after the first abort on *"role already exists"*, so later
   scenarios asserted against an empty database and **passed vacuously**. Roles
   now load once; the fixture is asserted before every scenario.
2. **psql variables do not substitute inside a dollar-quoted body.** The role
   pin was never being set; it now comes from a GUC set in the same session.
3. **Role memberships survive dropping the database.** A grant made by S2 leaked
   into the next run and made **S1 install successfully when it must fail** — a
   false "feasible". `reset()` now revokes it and asserts the storage owner has
   zero members, the production shape.

Had any of these gone unnoticed, this document would have reported the wrong
answer. The harness aborts with exit 2 rather than reporting results it cannot
trust.

## What this changes about the plan

- **One atomic migration is the route.** Confirmed feasible. The Part A / Part B
  split stays withdrawn, and no split plan is being prepared.
- **The 23-receipt artifact is the correct package**, not a compromise: this
  route leaves the drizzle ledger at 23.
- **`0023` must not land first.** It is pending today, so the window is open.
- **The single remaining technical unknown** is whether the migration executor
  holds storage-owner authority — S1 versus S2. Nothing in this harness can
  settle that; only the executor can, and no read-only operation reports it.
