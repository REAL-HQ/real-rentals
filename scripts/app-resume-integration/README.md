# Local candidate verification

Run from the repository root with the unchanged repository dependencies installed:

- `node scripts/app-resume-integration/handlers.test.mjs`
- `node scripts/app-resume-release.test.mjs`
- `node scripts/waitlist-security.test.mjs`
- `python3 scripts/app-resume-integration/security.test.py`
- `npx tsc --noEmit`
- `npm run build`

The Python runner creates and removes synthetic PostgreSQL and PostgREST instances, runs the browser suite, and records sanitized assertion results. Its current local prerequisites are PostgreSQL 17 at `/opt/homebrew/opt/postgresql@17/bin`, PostgREST at `/private/tmp/rr-coordinator-postgrest/postgrest`, macOS sandbox-exec, the cached Codex Playwright runtime and local Chrome referenced in browser.test.mjs. These are test tooling paths, not application dependencies. No hosted credentials are required. Auth in the browser is a synthetic adapter; provider login remains a hosted check.

Results: 37 database/API/orchestration checks, 16 browser assertions, 11 bundled-handler checks, 9 recovery scenarios and 20 Waitlist regression checks passed. These focused synthetic schemas do not establish complete production schema parity. Existing backup/security evidence remains valid within its original scope.

execution-plan.json is a proposed ordering/preflight specification, not an executable hosted installer or authorization to run SQL. Match receipts and all current schema consumers before preparing a target-bound staging installation. Never install vulnerable 0030 alone in a fresh target: pair it atomically with 0032.
