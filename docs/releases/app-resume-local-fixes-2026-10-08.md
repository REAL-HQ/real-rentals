# APPLICATION RESUME — LOCAL SECURITY FIXES VERIFIED / REPAIRS REQUIRED

Local fixes are verified within the tested scope. Release approval remains blocked by the findings and production-evidence gaps below. This report supersedes the pending-fix sections of the earlier security report; it does not claim production equivalence.

Repository: `REAL-HQ/real-rentals`. Branch: `release/app-resume`. Parent: `0a0bea5425fd0b90644b2755b8b41c4a9c11eb0d`. Baseline: `5bc960c0cc314252924f3616bb8ea9a19489e84e`.
No push, merge, deployment, Lovable change, production migration, or production record mutation occurred. Local main and preservation refs remain `95503ef1badf70f733979231fdebb3f1c9abc8f4`. Remote main was not re-fetched in this local-only pass; the previously observed remote main was `3645ba6964a36b454c957cbbf171d248f5a97f78`.

## Repairs

- Recovery delivery reserves quota and creates the hashed 30-minute recovery credential in one PostgreSQL transaction under an application-row lock. Limits are one attempt per 120 seconds and six per rolling 24 hours, across server instances. Failed and uncertain attempts consume quota. The destination is read from the locked application, never the submitted email. Invalid/deleted/purged records and database errors cannot trigger an unreserved send.
- Provider requests carry an idempotency key tied to the reservation. Explicit rejection revokes only that reservation's token; uncertain delivery preserves it. Existing session tokens are not evicted. Completion is idempotent and never refunds quota. Raw tokens are not stored in the ledger. Existing successful-send history seeds the new ledger at migration time, retaining the active cooldown without modifying application rows.
- Identity resolution uses the authenticated user's database RPC, with a database Manager/Owner check. Resolution and the canonical audit insert are one transaction. Audit actors come from authenticated database context, not caller payloads. A failed audit aborts the identity update; concurrent/repeated resolution creates one audit entry.
- Existing security assertions remain. Two source-shape expectations were updated to follow the new address-on-file lookup inside SQL; their confidentiality requirements were preserved. Original concurrency/history/provider-response invariants remain unchanged for the release. Added tests exercise actual SQL as well as real TypeScript handlers with only external boundaries intercepted.

## Verification

| Check | Result |
|---|---|
| Full production Vite 7.3.5 build | PASS |
| Full `tsc --noEmit` | PASS |
| 18 existing offline suites | PASS |
| Resume/identity handler suite | 9 ordinary scenarios + 3 abuse invariants PASS |
| PostgreSQL 18.4 synthetic integration | 10 scenarios PASS |
| Actual email helper with intercepted fetch | 4 scenarios PASS |
| Dependency security audit | 0 critical, 0 high; 2 moderate, 2 low remain; full audit exits 1 |
| Source ESLint | FAIL: 11,100 errors / 36 warnings; previous release 11,098/36, baseline 10,942/35 |
| Migration integrity and release isolation | PASS |
| Live Supabase grants/RLS, applied journal, environment secrets, authenticated browser E2E, actual email delivery | NOT VERIFIED |

The 18 existing suites: readiness, assessment-guard, applicant-security, resume-payload, trip-screenshots, agreement-guard, document-registration, readiness-documents, public-copy, grants (static only), client-chunks, duration-vocabulary, marketing-fleet, driver-access, file-upload-guard, agreement-pdf, app-resume-release, release-query-security. The macOS-incompatible GNU `sed -i` readiness wrapper was executed via the equivalent TypeScript compilation, import rewrite, bundle, and individual test commands. No assertion was disabled.

PostgreSQL coverage: historical cooldown import; 40 concurrent reservations; 40 concurrent calls through the actual recovery helper producing exactly one mocked provider send; missing-RPC fail-closed behavior; cooldown and six/day rollover; failed/uncertain delivery; preservation of session tokens; idempotent finalization; forced reservation-insert rollback; forced audit-insert rollback; 20 concurrent resolutions producing one change and audit; denied anonymous/authenticated ledger writes and denied driver/coordinator resolution. Tests use a disposable Unix-socket cluster, synthetic schemas/data, and the actual 0019, 0020, 0021 migration SQL. The fixture uses minimal prerequisite schemas and auth helpers; it is not a full Supabase stack or proof of production migration compatibility.

The email suite verifies the reserved token/address and stable idempotency header, 400/429 versus 409/5xx classification, network uncertainty, and missing-secret failure. No real email was sent. The source lint backlog remains, without suppression or bulk formatting. The new recovery server module has zero lint errors. No new vulnerability was demonstrated in the repaired paths; this is not an exhaustive security certification.

## Baseline comparison

Against `5bc960c0`, the real baseline returning-applicant handler sends 10 emails for 10 concurrent submissions and 27 for 27 sequential submissions. A recent synthetic application is used because baseline deduplication ignores old applications. The baseline has no `requestApplicationLink` endpoint, so the comparison invokes its `savePartialApplication` recovery path. The release passes its public recovery invariants and database concurrency checks.

The baseline contains the previously identified stored-VIN filter risk and lacks the durable identity-review repair. The release-specific recovery-token bypass, cooldown-history loss, provider-response disclosure, and identity error handling fixes from `0a0bea5` remain in place and pass regressions. Dependencies were identical to baseline before this turn. Existing baseline behavior, UI, configuration, and migration history were compared by source, not inferred solely from frontend assets.

## Targeted dependency versions

| Package | Before | Installed |
|---|---|---|
| shell-quote | 1.9.0 | 1.11.0 |
| brace-expansion | 1.1.14 / 5.0.5 | 1.1.21 / 5.0.12 |
| browserslist | 4.28.2 | 4.28.7 |
| js-yaml | 4.1.1 | 4.3.2 |
| nanoid | 3.3.11 | 3.3.18 |
| postcss | 8.5.10 | 8.5.23 |
| source-map-js | 1.2.1 | 1.2.2 |
| vite | 7.3.2 | 7.3.5 |

Browserslist 4.28.7 requires four accompanying browser-data updates: baseline-browser-mapping 2.10.21→2.10.44, caniuse-lite 1.0.30001790→1.0.30001806, electron-to-chromium 1.5.344→1.5.393, and node-releases 2.0.38→2.0.51. Exactly 13 lockfile entries changed; none was added or deleted. Vite is pinned to 7.3.5. The remaining transitive versions are fixed by the lockfile and verified with `bun install --frozen-lockfile`; deployment must honor this lockfile. The lock format remains compatible with the existing format.

Remaining advisories, all pre-existing:

- Moderate: baseline-browser-mapping 2.10.44, invalid-input process termination (`GHSA-w5vr-8v7q-w6rv`); a 2.11.0 update is outside the approved targets.
- Moderate: esbuild 0.18.20 under @esbuild-kit/core-utils, development-server cross-origin disclosure (`GHSA-67mh-4wv8-2f99`).
- Low: esbuild 0.27.7 under tsx/Vite, Windows development-server arbitrary file read (`GHSA-g7r4-m6w7-qqqr`).
- Low: root @babel/core 7.29.0, sourceMappingURL local arbitrary file read (`GHSA-4x5r-pxfx-6jf8`).

These findings concern build/development tools. The earlier rendered-module inventory found no deployed modules from the targeted packages; the current client-chunk guard also passes. Dependency category alone is not a reachability proof. Browser-data updates can alter target selection; real-browser acceptance and provider behavior remain unverified. No broad update was performed to hide remaining findings.

## Database and production compatibility

**One new migration is required:** `drizzle/migrations/0021_application_resume_atomic_security.sql`, with its appended journal entry and snapshot. It creates the quota ledger and three restricted RPCs, and imports only recent successful-send history into the new ledger. It does not alter existing application data, identity rows, audit entries, or tokens. Requires the existing applications/resume-token schema, deleted_at/purged_at, resubmission_history, identity reviews (0019/0020), canonical audit_log, auth.users, user_roles, auth.uid/auth.role, and private.is_manager().

All 164 existing migration-history files remain, with all existing SQL/snapshots byte-identical to preservation. Only `_journal.json` changes among existing files, by appending one entry; every old entry remains identical. Migration 0021 was applied ONLY in the disposable synthetic local database. The production migration journal is still not independently verified.

Public `/`, `/apply`, `/thank-you`, `/login` route compatibility and prior frontend asset matches remain supporting historical evidence, not current server/database equivalence. Server entry, Supabase client/auth middleware, recovery cron and environment files remain baseline-compatible by source. No new environment variable is needed. Actual server Supabase service-role and Resend bindings remain unverified. Client build passes without exposing server credentials. The new database RPCs must exist before this application can deliver recovery email or resolve identity reviews; absence fails closed.

Unfinished Waitlist, Driver Deletion, Sticky Headers, Step C1, Global Upload, Photo Enhancer and Passwordless Sign-In runtime changes remain excluded. Twenty protected paths were checked unchanged/absent versus baseline. Previously preserved migrations for these features remain solely as required migration history. The complete baseline inventory below makes that exception explicit.

## Remaining findings and rollout constraints

- Global source lint and the four moderate/low dependency advisories remain unresolved. None of the targeted critical/high advisories remains in the audit.
- Per-application throttling limits spam but does not add per-IP/global abuse controls. Anonymous requests can consume an applicant's quota. Existing signup match disclosure and timing distinguishability remain unproven/unresolved; equal response bodies do not prove constant-time behavior.
- This is a durable reservation with a request-bound provider send, not an autonomous outbox worker. A process crash after reservation may lose that delivery and consume quota until a later permitted retry. Unknown acceptance never triggers an automatic resend. Provider-level exactly-once delivery and live idempotency behavior are not established.
- Existing token exchange claims a recovery token before inserting its session token in a separate operation; an insertion failure can require a new link. Executing mail scanners can consume a single-use recovery link. These release reliability concerns were not expanded into unrelated work.
- Legacy resubmission history remains display metadata and concurrent writes may lose display entries; it no longer controls quota. Historic case/phone normalization and live email acceptance still need browser/provider acceptance tests.
- Ledger retention/operational monitoring needs a separately approved policy. No automated cleanup or production job was added.
- Before any deployment: verify the actual applied migration journal and permissions, test against a representative isolated Supabase environment, approve migration 0021 separately, and coordinate traffic so old code cannot continue making unreserved sends during cutover. Apply the additive migration before the new application. No such action is authorized or performed here.
- Rollback application code only after explicitly accepting the return of old recovery/audit weaknesses; keep the additive ledger/audit history rather than deleting data. A rollback must not be described as retaining these security repairs.

## Exact files changed in this local repair

- `bun.lock`
- `docs/releases/app-resume-local-fixes-2026-10-08.md`
- `docs/releases/app-resume-local-fixes-evidence-2026-10-08.json`
- `drizzle/migrations/0021_application_resume_atomic_security.sql`
- `drizzle/migrations/meta/0021_snapshot.json`
- `drizzle/migrations/meta/_journal.json`
- `package.json`
- `scripts/app-resume-release.test.mjs`
- `scripts/application-security-postgres.test.mjs`
- `scripts/recovery-email.test.mjs`
- `scripts/resume-payload.test.mjs`
- `src/integrations/supabase/types.ts`
- `src/lib/application-recovery.server.ts`
- `src/lib/applications.functions.ts`
- `src/lib/email.server.ts`
- `src/lib/identity-review.functions.ts`
- `src/lib/resume-tokens.server.ts`

## Complete candidate inventory versus baseline

- `bun.lock`
- `docs/releases/app-resume-2026-10-08.md`
- `docs/releases/app-resume-dependencies-2026-10-08.md`
- `docs/releases/app-resume-local-fixes-2026-10-08.md`
- `docs/releases/app-resume-local-fixes-evidence-2026-10-08.json`
- `docs/releases/app-resume-security-2026-10-08.md`
- `docs/releases/app-resume-security-evidence-2026-10-08.json`
- `drizzle/migrations/0008_fin_core_c1.sql`
- `drizzle/migrations/0009_fin_core_c1_tables.sql`
- `drizzle/migrations/0010_fin_c1_deposit_correction.sql`
- `drizzle/migrations/0011_fin_c1_deposit_reverse_guard.sql`
- `drizzle/migrations/0012_photo_enhancer.sql`
- `drizzle/migrations/0013_vehicle_docs_finance_owner_only_writes.sql`
- `drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql`
- `drizzle/migrations/0015_waitlist_promotion_identity_review.sql`
- `drizzle/migrations/0016_0016_driver_deletion_stage1.sql`
- `drizzle/migrations/0017_0017_driver_deletion_security_repair.sql`
- `drizzle/migrations/0018_portal_signin_challenges.sql`
- `drizzle/migrations/0019_application_identity_reviews.sql`
- `drizzle/migrations/0020_identity_reviews_tighten_grants.sql`
- `drizzle/migrations/0021_application_resume_atomic_security.sql`
- `drizzle/migrations/meta/0008_snapshot.json`
- `drizzle/migrations/meta/0009_snapshot.json`
- `drizzle/migrations/meta/0010_snapshot.json`
- `drizzle/migrations/meta/0011_snapshot.json`
- `drizzle/migrations/meta/0012_snapshot.json`
- `drizzle/migrations/meta/0013_snapshot.json`
- `drizzle/migrations/meta/0014_snapshot.json`
- `drizzle/migrations/meta/0015_snapshot.json`
- `drizzle/migrations/meta/0016_snapshot.json`
- `drizzle/migrations/meta/0017_snapshot.json`
- `drizzle/migrations/meta/0018_snapshot.json`
- `drizzle/migrations/meta/0019_snapshot.json`
- `drizzle/migrations/meta/0020_snapshot.json`
- `drizzle/migrations/meta/0021_snapshot.json`
- `drizzle/migrations/meta/_journal.json`
- `package.json`
- `scripts/app-resume-release.test.mjs`
- `scripts/applicant-security.test.mjs`
- `scripts/application-security-postgres.test.mjs`
- `scripts/recovery-email.test.mjs`
- `scripts/release-query-security.test.mjs`
- `scripts/resume-payload.test.mjs`
- `src/components/admin/DriversPanel.tsx`
- `src/components/admin/IdentityReviewCard.tsx`
- `src/components/site/ApplicationWizard.tsx`
- `src/components/site/CityHeroLeadForm.tsx`
- `src/components/site/WelcomeBack.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/application-recovery.server.ts`
- `src/lib/applications.functions.ts`
- `src/lib/email.server.ts`
- `src/lib/fleet-inbox.functions.ts`
- `src/lib/identity-review.functions.ts`
- `src/lib/resume-token.ts`
- `src/lib/resume-tokens.server.ts`
- `src/lib/safe-autofill.server.ts`
- `src/routes/apply.tsx`
- `src/routes/thank-you.tsx`
