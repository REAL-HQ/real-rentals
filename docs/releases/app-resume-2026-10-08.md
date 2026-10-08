> Superseded security analysis: see [APPLICATION RESUME — SECURITY BLOCKERS ANALYZED](app-resume-security-2026-10-08.md). The original report below is retained as the initial verification record.

# REAL RENTALS — RELEASE VERIFICATION BLOCKED

The isolated candidate is available locally for review, but is **not ready to push or deploy**. Preservation succeeded. Required security verification failed; no release push was made.

## Repository and branches

- Canonical repository: https://github.com/REAL-HQ/real-rentals (GitHub repository ID 1269530917). Both GitHub connector and authenticated CLI reported push and admin permission.
- GitHub main, verified before and after work: `95503ef1badf70f733979231fdebb3f1c9abc8f4`.
- Preservation branch: `preserve/2026-10-08-all-pending`, pushed and independently verified at exactly `95503ef1badf70f733979231fdebb3f1c9abc8f4`. Creation used an absent-ref lease, which refuses any existing remote branch.
- Local candidate: `release/app-resume`, based on `5bc960c0cc314252924f3616bb8ea9a19489e84e`. No remote release branch exists. The candidate commit is the commit containing this report.
- Workspace: `/private/tmp/real-rentals-release-20261008` (temporary storage; retain the commit elsewhere before system cleanup).
- Initial checkout identity was AI4B-Team/rent-hq, main at `c47a6e4927f9826773a75240f6c7f7bdf703864c`. Only read-only identity inspection was performed there during this request. Neither main branch was modified.

## Backport audit

No commits were blindly cherry-picked. Selected resume-only source files were reviewed against the requested baseline. `applications.functions.ts` changes are limited to returning-applicant matching, recovery delivery/throttling, durable phone/email conflict insertion, and link exchange. `email.server.ts` carries only the recovery email function change; global email formatting and passwordless emails are excluded. DriversPanel differs by only the identity-card import and rendering. Generated database types add only the identity-review table. The recovery cron is unchanged.

Preserved behavior: tokens are not returned on anonymous duplicate matches; links go to the address on file; phone-only/email-different matches record a separate review; application identity, consent, status, documents and answers remain unchanged on matches. Recovery links are exchanged once for a session token. Manager/Owner resolution is server-checked and audited. AI scoring does not write the review table.

## Verification

- Frozen-lockfile Bun installation: PASS. Baseline package.json and bun.lock unchanged.
- Production Vite build: PASS (deprecation and bundle-size warnings remain).
- TypeScript `tsc --noEmit`: PASS, no diagnostics.
- `git diff --check`: PASS.
- Offline suites: 16 PASS, 1 FAIL (table below).
- Applicant-security failure: two pre-existing interpolated filters in fleet-inbox.functions.ts and safe-autofill.server.ts. Reproduced by running the original test against source archived from `5bc960c0`. No allowlist relaxation was retained. In particular the baseline fleet VIN query uses a stored value without a whitelist; reachability and mitigation require review.
- Dependency audit: FAIL. 11 package names flagged; 33 advisory entries: 1 critical, 22 high, 8 moderate, 2 low. These are audit entries, not independently established exploitable paths. Critical package: shell-quote. The dependency graph is unchanged from the baseline; remediation was not mixed into this narrowly scoped backport.
- Full-repository ESLint: FAIL, 21,121 errors and 36 warnings across the scanned tree (includes local generated test/build files). This is not a count of defects introduced by the candidate. No bulk formatting or unrelated repairs performed.
- Existing test source guards were adapted to recognize the extracted recovery helper and token-exchange endpoint. All payload restrictions remain; the new public link-request endpoint is explicitly named, and offline tests exercise its behavior.
- Six new offline behavior scenarios execute the real handlers using an in-memory database/email boundary: concurrent recovery opens, expired/unknown links, preservation of existing application data, durable conflict deduplication, resend throttling/provider failures, and role-gated audited resolution. These do not establish real database RLS correctness or live email delivery.
- The shell test harness uses GNU-specific sed; on macOS its transpilation/import rewrite and document bundle setup were performed equivalently, and individual suites were executed explicitly.
- No browser acceptance tests, live DB grant tests, migration executions, real email sends, or applicant mutations performed.

| Offline suite | Result |
|---|---|
| readiness | PASS |
| assessment-guard | PASS |
| applicant-security | FAIL |
| resume-payload | PASS |
| trip-screenshots | PASS |
| agreement-guard | PASS |
| document-registration | PASS |
| readiness-documents | PASS |
| public-copy | PASS |
| grants | PASS |
| client-chunks | PASS |
| duration-vocabulary | PASS |
| marketing-fleet | PASS |
| driver-access | PASS |
| file-upload-guard | PASS |
| agreement-pdf | PASS |
| app-resume-release | PASS |

## Database compatibility

All 164 files under drizzle/migrations and supabase/migrations match the preservation commit byte-for-byte. Additions relative to the baseline are Drizzle 0008–0020 and their journal/snapshots (27 files including the journal). They are source history only; no migration command was run. SQL for excluded features remains solely to preserve the existing migration history, as required.

The repo's isolation plan says the resume-token table and migrations 0019/0020 are already live, and 0008–0018 have also been applied. This was not independently checked against production. Candidate recovery queries depend on deleted_at/purged_at as compatibility guards, without importing the Driver Deletion feature. The identity table requires 0019/0020; its SELECT is staff-RLS-only and authenticated mutations are revoked. Before deployment, confirm actual applied journal/schema/grants through an authorized read-only check. Do not run migrations automatically. Migration 0017 revokes direct application deletion; the baseline Delete action may consequently fail, as the repository plan already notes.

## Exclusions

Baseline application code and dependencies retained for Waitlist, Driver Deletion, Sticky Headers, Step C1, Global File Upload, Photo Enhancer and Passwordless Sign-In. Their post-baseline UI, server actions, routes, dependencies and CSS changes were not imported. Existing baseline functionality is retained. Migration history is the deliberate exception. The changed-path allowlist passed for all 43 candidate files before this report was added.

## Deployment and rollback plan — not executed

1. Resolve required security/lint gates in a separately reviewed scope and rerun verification; review the exact candidate diff and exclusions.
2. Prove the historical baseline corresponds to the currently deployed production artifact. The requested `5bc960c0` is a confirmed historical commit, not a proven production rollback image.
3. Verify the live schema/journal read-only; test browser recovery, delivery and RLS in an isolated environment with synthetic applicants and controlled email. Do not use real applicant records.
4. Once verified, push the isolated release branch without overwriting any existing ref. Obtain explicit authorization for any Lovable branch switch or publication, then deploy the reviewed commit and verify behavior.
5. Roll back by republishing the independently verified pre-release production artifact/commit. Keep additive schema and migration history; no data or schema rollback is part of this application-only release.

## Remaining risks

- Security audit and source-guard failures currently block release push; lint is also not clean.
- Recovery throttling uses read/send/write JSON history, so concurrent requests can exceed limits and concurrent history updates can be lost. This existing candidate behavior needs assessment before deployment.
- Recovery exchange consumes a token before issuing the replacement; insertion failure can require requesting a new link. Email scanners that execute the page can consume a single-use link.
- Provider failure responses differ for matching addresses; timing/outcome enumeration remains possible. Phone matching depends on stored formatting; email matching does not normalize every historical mixed-case value.
- Identity review insert/update failures are not consistently surfaced; review-resolution auditing is not transactional with its row update. Review these failure modes before deployment.
- The thank-you page falls back to the raw token when exchange transport fails; single-use enforcement across all token-authorized endpoints needs additional review.
- Production baseline, production schema, browser UX, actual RLS and email delivery remain unverified.
- Nothing was published, merged, switched in Lovable, or changed in production. Only the preservation branch was pushed.

## Changed-file inventory against historical baseline

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
- `drizzle/migrations/meta/_journal.json`
- `scripts/app-resume-release.test.mjs`
- `scripts/applicant-security.test.mjs`
- `scripts/resume-payload.test.mjs`
- `src/components/admin/DriversPanel.tsx`
- `src/components/admin/IdentityReviewCard.tsx`
- `src/components/site/ApplicationWizard.tsx`
- `src/components/site/CityHeroLeadForm.tsx`
- `src/components/site/WelcomeBack.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/applications.functions.ts`
- `src/lib/email.server.ts`
- `src/lib/identity-review.functions.ts`
- `src/lib/resume-token.ts`
- `src/lib/resume-tokens.server.ts`
- `src/routes/apply.tsx`
- `src/routes/thank-you.tsx`
- `docs/releases/app-resume-2026-10-08.md` (this report)

## Dependency advisory details

- `@babel/core` — low: [@babel/core: Arbitrary File Read via sourceMappingURL Comment](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)
- `baseline-browser-mapping` — moderate: [baseline-browser-mapping process termination on invalid input causes denial of service](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv)
- `brace-expansion` — moderate: [brace-expansion: Large numeric range defeats documented `max` DoS protection](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2)
- `brace-expansion` — high: [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- `brace-expansion` — high: [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
- `brace-expansion` — high: [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895)
- `brace-expansion` — high: [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895)
- `brace-expansion` — high: [brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp)
- `brace-expansion` — high: [brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp)
- `brace-expansion` — high: [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
- `brace-expansion` — high: [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
- `brace-expansion` — high: [brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
- `brace-expansion` — moderate: [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- `brace-expansion` — moderate: [brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
- `brace-expansion` — high: [brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
- `browserslist` — high: [Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)
- `browserslist` — high: [Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats)](https://github.com/advisories/GHSA-73wf-gq98-2v4g)
- `esbuild` — moderate: [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- `esbuild` — low: [esbuild allows arbitrary file read when running the development server on Windows](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)
- `js-yaml` — moderate: [JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases](https://github.com/advisories/GHSA-h67p-54hq-rp68)
- `js-yaml` — high: [js-yaml: YAML merge-key chains can force quadratic CPU consumption](https://github.com/advisories/GHSA-52cp-r559-cp3m)
- `js-yaml` — high: [JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)
- `js-yaml` — high: [js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
- `nanoid` — high: [nanoid: non-secure generators can loop indefinitely with negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)
- `nanoid` — high: [nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
- `nanoid` — high: [nanoid: Integer Overflow or Wraparound](https://github.com/advisories/GHSA-xwg4-73v4-xw9w)
- `postcss` — moderate: [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
- `postcss` — high: [PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments](https://github.com/advisories/GHSA-6g55-p6wh-862q)
- `postcss` — high: [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849)
- `shell-quote` — critical: [shell-quote: `quote()` command injection via a line terminator in a token after a `{ comment }` token](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)
- `source-map-js` — high: [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- `vite` — moderate: [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)
- `vite` — high: [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
