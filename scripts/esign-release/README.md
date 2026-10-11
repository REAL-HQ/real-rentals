# eSign candidate verification

0023 packages the existing versioning/library proposals with the documented role helper, insurance evidence and immutable snapshot corrections. 0024 preserves the existing numbering SQL bytes. These files are deliberately outside automatic migration discovery. No installed migration has been overwritten.

Focused migration test: `python3 scripts/esign-release/migration.test.py`. Requires local PostgreSQL 17 at `/opt/homebrew/opt/postgresql@17/bin` and macOS sandbox-exec; creates a disposable Unix-socket-only cluster and removes it. Fifteen assertions passed, including 24 concurrent numbering allocations.

Engine test: use the existing disposable `scripts/esign-harness` tooling, apply these two packages only to its synthetic database, then run `scripts/esign-engine.test.ts` with Vitest 3.2.4. The final run passed all 38 tests with both packages and the final snapshot guard. Local macOS verification adapted the existing Linux startup paths outside the repository, used PostgreSQL 17, PostgREST and Bun 1.3.3, and aliased Vitest from disposable tooling without dependency/lockfile changes. Stop and remove the harness afterward. Storage is in-memory and communication is capture-only. Provider storage/Auth and full baseline parity remain hosted preflight gates; the existing harness skips four historical migrations.

Also passed: TypeScript, production build, existing contract minimum-term and agreement-library tests. No template approval or hosted operation occurred. See execution-plan.json and release documentation for preflight and separate approvals. Never run the destructive rollback example from the old unnumbered proposal against signed history.
