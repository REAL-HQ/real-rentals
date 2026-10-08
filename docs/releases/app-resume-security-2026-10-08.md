# APPLICATION RESUME — SECURITY BLOCKERS ANALYZED

**Status: local targeted fixes prepared; release remains blocked and unpushed.** This report supersedes the verification conclusions in `app-resume-2026-10-08.md`. No publication, merge, Lovable switch, production database mutation, migration application or applicant-record change was performed. No dependency version was changed.

## Repository and evidence boundaries

Canonical repository: **REAL-HQ/real-rentals**, repository ID 1269530917. Work continues on local `release/app-resume`, starting at `ecd470d7c83b6d0d00f102893d3fc26b1d9735f6`, whose parent is historical baseline `5bc960c0cc314252924f3616bb8ea9a19489e84e`. Preservation remains remotely verified at `preserve/2026-10-08-all-pending` → `95503ef1badf70f733979231fdebb3f1c9abc8f4`.

The final read-only remote check found main had advanced externally to `3645ba6964a36b454c957cbbf171d248f5a97f78`, two commits ahead of the preserved source. GitHub's compare API lists only `.lovable/plan.md` changed. None of that work was incorporated; local main remains at 95503ef1. No remote release branch exists. Nothing in AI4B-Team/rent-hq was accessed or changed during this investigation.

All behavior reproductions used synthetic data in an in-memory boundary. No exploit probe, server-function POST, email delivery or database query was sent to production. Public production evidence consists of ordinary GETs of pages and static JavaScript assets only.

## Exact applicant-security failure and classification

The original failure was `scripts/applicant-security.test.mjs`, assertion **“no unreviewed interpolated filter (found 2)”**, under **“NO APPLICANT INPUT IS SPLICED INTO A POSTGREST FILTER”** (assertion around line 74). Every other assertion in that script passed. The two offenders in both baseline 5bc960c0 and candidate ecd470d7 were:

| Offender at baseline/candidate start | Cause and classification | Targeted change |
|---|---|---|
| `src/lib/fleet-inbox.functions.ts:648`, getVehicleSuggestions | Stored `target.vin` was interpolated into `.or(...)` grammar. Vehicle input accepted a max-40-character string without constraining it to a VIN alphabet. This is a genuine **baseline stored filter-injection risk** in a staff-authenticated path. The demonstrated defect is query-grammar manipulation; unrestricted database access or a cross-role privilege escalation was not established. It is not an anonymous SQL injection. | Use separate typed `.eq("vin", vin)` and `.eq("match_vehicle_id", target.id)` queries, then deduplicate and retain the newest 200, preserving the earlier OR-result cap. One additional read is the performance tradeoff. |
| `src/lib/safe-autofill.server.ts:59`, runSafeAutofillForItem | Field name was interpolated into raw null/empty syntax, but evaluateAutofill only emits the fixed AUTO_FIELDS set. No attacker-controlled field reaches this expression in the inspected path. This is a **baseline conservative test finding**, not a demonstrated injection vulnerability. | Use typed `.is(field, null)` or `.eq(field, "")` matching the exact blank state originally read. An intervening human edit cannot be overwritten. A concurrent null↔empty change now conservatively skips the fill. |

The baseline source was archived and the original test run against it: the same two failures occurred. No security allowlist was expanded, assertion removed or test suppressed. The original guard now passes.

Earlier resume-payload failures were different: the old test expected email delivery inline in the duplicate branch and its update slicing stopped at an earlier query. The backport extracted delivery into `emailLinkToAddressOnFile`/`sendRecoveryLink`. Three old source-shape expectations failed even though delivery still used the address on file. Candidate ecd470d7 already adapted these checks while retaining all sensitive-payload restrictions. The explicitly public requestApplicationLink and exchangeResumeToken authorization were also named in the endpoint guard. This investigation adds execution tests rather than replacing those restrictions.

## Release-specific findings and local fixes

| Finding | Baseline versus release | Fix/evidence |
|---|---|---|
| Recovery token bypassed single-use exchange | Baseline had ordinary 14-day tokens, not this recovery protocol. Candidate ecd470d7 let resolveResumeToken accept a short-lived emailed token directly. Wizard read/write/upload calls could use it repeatedly until expiry without consuming it. | resolveResumeToken now rejects recovery lifetimes; exchange remains the only conversion to a session token. Expiry timestamps must be finite and strictly future, including at the conditional claim. The regression assertion fails on ecd470d7 and passes locally. Real read/write/upload handlers reject the valid-shaped recovery credential with the intended generic token error. |
| Frontend fallback used raw credential after exchange transport failure | Introduced in the backport. `/apply?t=` also went directly to the wizard rather than exchange. | `/thank-you` fails closed instead of falling back to raw; `/apply?t=` forwards to the existing exchange route using replace navigation. Ordinary long-lived tokens remain accepted by exchange and getApplicationForWizard; `/apply` still refuses stashed tokens on a shared device. |
| Throttled requests erased send history | New backport rate-limit storage appended every retry and truncated to 25 entries. The 27-request offline sequence caused a second send inside the cooldown. | boundedRecoveryHistory preserves the last six successful-send entries plus bounded other history, including on phone-conflict writes. Same test now passes; original daily/cooldown calculations remain in use. Concurrent lost updates are not solved by this change. |
| Provider failure disclosed a matching email | New public link-request response returned false/30 seconds for a matched provider failure and true/120 for an unmatched address. | Matching and nonmatching link requests now return the same acceptance response even when the provider rejects delivery. UI says request received, not email delivered. Failure evidence remains server-side. The response-comparison test now passes. This does not prove timing indistinguishability or remove the baseline signup endpoint's existing-match disclosure. |
| Identity review failures appeared successful/empty | New feature: failed conflict insert was logged but reported as queued; list errors returned empty; resolution errors could look already resolved. | Insert failures except unique-conflict 23505 now throw; list and resolve errors throw; list explicitly requires staff before caller-RLS reads; the staff card shows an unknown-state error and retry. Injected DB-error and driver/signed-out denial tests pass. Separate-table durability still survives changing ai_flags. |

These are local reviewable changes, not deployed fixes.

## Unresolved security findings and concrete proposals

### 1. Recovery concurrency — FAIL, confirmed in baseline and release

`node scripts/app-resume-release.test.mjs --abuse` asserts **“concurrent link requests send at most one email.”** Ten simultaneous requests sent **10** emails in the in-memory interleaving, expected 1. The old baseline duplicate-submit handler was separately executed with a recent synthetic application: its read-count-then-send limiter also sent **10** emails. Thus the non-atomic design is inherited; the new standalone endpoint extends its public surface. The history-erasure and provider-response assertions in the same abuse run now pass.

Proposal for approval: a **durable atomic recovery reservation and outbox**, shared by every recovery-send entry point. A service-only database transaction should lock by application, check cooldown and daily attempts, reserve a unique delivery attempt, and return only an accepted/recent result. Send outside the transaction through an idempotent worker/provider key; record accepted/failed/unknown outcomes and reconcile uncertain deliveries without duplicate sends. Bound failed attempts as well as successful sends. Do not use a process-local lock: deployment has multiple isolates. Validate it against a disposable PostgreSQL instance with concurrent callers before any deployment.

This requires reviewed additive database/procedure design and a compatibility plan. No new migration was written or applied. Existing migration files must remain intact. Repeated provider failures currently issue tokens before delivery and do not count as successful-send history; together with the five-live-token cap this is a related denial-of-service risk to include in the reservation/token-lifecycle design. The ordinary signup path also retains its historical existence disclosure and should not be described as non-enumerable.

### 2. Identity audit atomicity — unresolved

Resolution updates the review and then calls the common best-effort logAudit helper, which neither throws on returned database errors nor participates in the same transaction. The row itself stores resolved_by/resolved_at/note, but a corresponding audit_log row is not guaranteed. Proposal: a separately reviewed Manager-checked database function that resolves and appends the audit record atomically, with authenticated actor binding and rollback on failure. A throw after the current update would not make it atomic, so that superficial change was not made. Current offline tests establish normal-path role enforcement/audit invocation, not atomic persistence.

### 3. Other limitations requiring acceptance testing

A token claim followed by session-token insertion is not a single DB transaction; an insertion failure can force a new-link request. Browser email scanners that execute the page can consume a recovery link. Historical mixed-case email values/phone formatting can affect deduplication. No production timing analysis, provider outage exercise, browser session-isolation run or real database RLS test was performed. These are explicit open checks, not passing results.

## Dependencies

See [the complete advisory breakdown](app-resume-dependencies-2026-10-08.md) for all **18 distinct critical/high GHSAs (23 affected-range entries)**, installed versions, affected ranges, first patched versions, dependency chains and compatibility risks. A fresh audit still reports 1 critical, 22 high, 8 moderate and 2 low entries; no dependency has been upgraded.

Minimal proposed targets are shell-quote 1.11.0; brace-expansion 1.1.21 and 5.0.12 on their respective existing major lines; browserslist 4.28.7; js-yaml 4.3.2; nanoid 3.3.18; postcss 8.5.23; source-map-js 1.2.2; Vite 7.3.5. These are proposals for approval and subsequent testing, not an assurance of a clean future audit.

The entire graph is unchanged from baseline. None of these eight packages contributes rendered modules to the instrumented client, SSR or Nitro worker build. Several appear under production-declared roots only because those packages also contain build plugins; classification is based on both dependency path and emitted modules. Build/development exposure remains, even without a demonstrated deployed request path.

## Production compatibility evidence

- GETs of `/`, `/apply`, `/thank-you`, `/login` at drivereal.com all returned HTTP 200 with expected page titles. No form or server function was invoked.
- Rebuilding 5bc960c0 yielded every static asset filename referenced by those pages (30/30, 23/23, 21/21, 7/7 respectively). Six fetched JS files—two index files, apply, thank-you, applications.functions and login—matched the baseline bytes/SHA-256 exactly. This is **frontend evidence only**. It cannot establish server, environment, database or complete deployment equivalence.
- The public applications.functions chunk exposes eight RPC IDs. All eight remain in the release chunk, which adds two new IDs. This supports endpoint-name continuity, not proof of runtime behavior. The release's server-function handlers were exercised offline with real validators and roles logic, with database/email/framework boundaries mocked.
- The baseline's full production build and the final release production build pass. A temporary inventory build also passes. Initial concurrent baseline/release builds shared Nitro scratch space through a node_modules symlink and collided; they were rerun sequentially successfully. Those temporary infrastructure failures are not reported as application regressions.
- `.env`, `.env.production`, `.env.development`, src/server.ts, auth-middleware, Supabase server client and the wizard-recovery cron are byte-identical to baseline. No environment variable was added. Client build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY; server auth needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; privileged recovery needs SUPABASE_SERVICE_ROLE_KEY; mail needs RESEND_API_KEY. Public build values were present, but local server secrets/DB connections were absent. Their live values and Cloudflare bindings could not be verified. No secret values are included in this report.
- GitHub's deployments endpoint returned an empty list, so it supplies no deployed-server commit or environment attestation. Frontend matches are not substituted for that missing evidence.
- Identity Review requires application_identity_reviews from 0019 and tightened grants from 0020: authenticated staff-only SELECT via private.is_staff(), authenticated/anon mutations revoked, service_role allowed. Recovery compatibility guards also require deleted_at/purged_at from 0016. The token table's created_at/expires_at fields predate the release; there is no token schema change.
- **All 164 files** in drizzle/migrations and supabase/migrations match preservation byte-for-byte, and the current main comparison contains no migration changes. None were executed. The repository plan's claim that 0008–0020 are already applied is still not independently verified against the production journal. Migration 0017's direct-delete revocation remains a known baseline-UI compatibility consideration.

## Verification results

| Check | Result |
|---|---|
| Final production build / instrumented build | PASS |
| Historical baseline production build, sequential rerun | PASS |
| Full TypeScript noEmit | PASS |
| 18 ordinary offline suites | PASS |
| Applicant-security original filter guard | PASS, without allowlist changes |
| New stored-query regression suite | PASS: actual query fragments use the real Supabase builder and intercepted HTTP, including hostile VINs, dedup/newest-200 cap and no-overwrite checks |
| Resume/identity handler scenarios | 9 PASS, including real handler authorization and error behavior |
| Recovery abuse suite | FAIL: concurrency; history churn and provider-response invariants PASS |
| Dependency audit | FAIL/open: versions deliberately unchanged pending review |
| Source-only ESLint (same scope for both refs) | FAIL: baseline 10,942 errors/35 warnings; release 11,098 errors/36 warnings |
| Migration integrity / excluded-feature paths / diff whitespace | PASS |
| Live RLS, DB journal, email delivery, authenticated browser E2E | NOT RUN / not established locally |

The ordinary offline suites are readiness, assessment-guard, applicant-security, resume-payload, trip-screenshots, agreement-guard, document-registration, readiness-documents, public-copy, grants (static portion only), client-chunks, duration-vocabulary, marketing-fleet, driver-access, file-upload-guard, agreement-pdf, app-resume-release and release-query-security. Tests use synthetic fixtures only. Source-only lint avoids the generated-test-file noise in the earlier whole-tree count; the remaining delta includes backport formatting/types, not 156 newly established security vulnerabilities. No bulk formatting or lint suppression was performed.

## Release isolation

Waitlist, Driver Deletion, Sticky Headers, Step C1, Global Upload, Photo Enhancer and Passwordless Sign-In runtime changes remain excluded. Seventeen key paths were checked unchanged versus 5bc960c0 or absent when not present there; package.json and bun.lock are unchanged. Baseline features already present are retained. Migration history is the explicit required exception. The only additional baseline fleet changes are the two narrow filter-safety repairs described above.

## Approval-dependent next steps

1. Review these findings and approve the exact same-major dependency targets before installation and re-verification.
2. Approve a durable recovery reservation/outbox design and transactional identity audit design, to be implemented and tested locally without applying production migrations.
3. Supply/authorize an isolated environment for real RLS, concurrency, browser and controlled-mail acceptance testing; establish live applied-migration and server/config provenance through read-only evidence.
4. Clear or explicitly disposition remaining lint/security findings. Keep this candidate unpushed until explicit approval; publication, merging and Lovable branch changes are separate actions and have not been authorized.

## Changed-file inventory for this investigation

- `docs/releases/app-resume-2026-10-08.md`
- `docs/releases/app-resume-dependencies-2026-10-08.md`
- `docs/releases/app-resume-security-2026-10-08.md`
- `docs/releases/app-resume-security-evidence-2026-10-08.json`
- `scripts/app-resume-release.test.mjs`
- `scripts/release-query-security.test.mjs`
- `src/components/admin/IdentityReviewCard.tsx`
- `src/components/site/WelcomeBack.tsx`
- `src/lib/applications.functions.ts`
- `src/lib/fleet-inbox.functions.ts`
- `src/lib/identity-review.functions.ts`
- `src/lib/resume-tokens.server.ts`
- `src/lib/safe-autofill.server.ts`
- `src/routes/apply.tsx`
- `src/routes/thank-you.tsx`

The complete prior backport inventory remains in the original report; the new report identifies only changes made during this investigation. Machine-readable advisory, asset-hash and test evidence is in `app-resume-security-evidence-2026-10-08.json`.
