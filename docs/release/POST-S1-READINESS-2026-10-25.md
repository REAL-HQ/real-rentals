# Post-S1 consolidated readiness report (2026-10-25)

Prepared for owner review. Nothing in this report was merged, pushed to a feature branch, published,
or run against the production database. No feature flag was changed. Security 0031, S1 and the frozen
Release A artifacts are unchanged.

## 1. Commits and branch status

| Item | Commit | Branch / location | Status |
|---|---|---|---|
| PR 1: decided-application lock, vault delete guard | `9c66abd8` | `feature/sec-resume-and-vault-guards` | local only |
| PR 4: resume reliability, includes PR 1 | `733804dc` (was `3cc10e14`; one fix added, §3) | `feature/resume-reliability` | local only |
| PR 3: eSign signing fixes | `1bcb437a` | `feature/esign-signing-fixes` | local only |
| **Release candidate** (14cbf81b + PR 4 + PR 3) | **`700e7bcc`**, tree **`a9362dfbc9e08c8b61abc7d4825cb1b1fb514e3e`** | detached local merge | clean working tree |
| PR 2: driver activation readiness | `4abfeb45` | `feature/driver-activation-readiness` | local only |
| Preview branch `integration/grok-baseline-2026-10-22` | `14cbf81b` | origin | unchanged |
| `release/m2-app-flags-off` (Release A) | `f8b2480f` | origin | unchanged |
| `rollback/*` (3 branches) | unchanged | origin | unchanged |

**Candidate contents.**
- The candidate changes 36 files relative to `14cbf81b`.
- Every file except `package.json` is byte-identical to its version on PR 4 or PR 3.
- `package.json` only joins the two test-script chains.
- It touches no `supabase/`, `drizzle/`, Security 0031, S1, M2 or `esign.server.ts` / `esign-pdf.server.ts` file.

## 2. Test results

**Release candidate `700e7bcc`:**

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | exit 0 |
| Production build | exit 0 |
| Full `npm test` | exit 0, 0 BLOCKER |
| `agreement-evidence` (run as `tester`, PG17) | 11 pass, 0 fail |
| eSign engine harness | 50/50 on `348ccdf2`; the later fix does not touch eSign |
| Reminder cron tests | 10/10, including the new PostgREST-behaviour check |

The full suite runs in two parts around `agreement-evidence`, because that test refuses to start its database as root.

**PR 2 `4abfeb45`:**

| Check | Result |
|---|---|
| `activation-readiness` unit tests | 77/77 |
| Database tests (private PG 17.6 + PostgREST 12.2.3) | 61/61 |
| Typecheck | exit 0 |
| Build | exit 0 |
| Full `npm test` | exit 0 |
| `agreement-evidence` | 11/0 |
| client-chunks | 32 PASS |
| dark-flag-coverage | 0 unaccounted |

**Failing before PR 2 and outside `npm test`** (reported by the PR 2 work):
- the `guard.test.mjs` `package.json` pin;
- `drivers-list-access`;
- the Stripe regressions script, which also fails on Release A;
- one `portal-document-update` check, which also fails on `cc806e90`.

## 3. Preview results (local authenticated run)

**Why the run was local.** The Lovable Preview for project `8cf1f99e` cannot host the candidate safely:
- It runs on the **production database**.
- Showing the candidate would mean pushing it to the frozen Preview branch, which is what the next Publish ships.
- `*.lovable.app` is not reachable from this environment.

**How it was run.** The checklist (`POST-S1-PREVIEW-VERIFICATION.md`) was instead run against a fully local stack:
- a throwaway PG 17.6 database built from the candidate's migrations;
- PostgREST 12.2.3;
- an emulated gateway, sign-in and storage;
- capture-only email;
- Chromium at 1280 px, iPhone (390×844) and Android (412×915) sizes.

No external host was contacted. Evidence is in `post-s1-e2e-2026-10-25/results.json`.

| Row | Result | Evidence |
|---|---|---|
| 0.1 commit marker | BLOCKED | The `data-commit-sha` marker is Lovable hosting only. The served tree was confirmed instead. |
| 0.2 pages load | PASS | Console errors are the same as Release A on the same stack. |
| 0.3 M2 flags off | PASS | |
| 1.1 editable statuses save | PASS | partial, new, complete and reviewing, at all 3 sizes. |
| 1.2 decided application locked | PASS | The exact generic message; no decision word. |
| 1.3 replayed save refused | PASS | Row md5 unchanged. |
| 1.4 no Delete on signed PDF | PASS | |
| 1.5 server refuses delete | PASS | The PDF, the row and the agreement link remain. |
| 1.6 ordinary delete works | PASS | |
| 4.1 save indicator | PASS | |
| 4.2 offline retry | PASS (behaviour) | The UI says "Couldn't Save — Retry". The checklist wording was wrong and is now corrected. |
| 4.3 recovery links | PASS | Each link is 30 minutes and works once. A 31-minute-old link is refused. |
| 4.4 reminder link type | FAIL on `348ccdf2` → **fixed in `733804dc`** | See the defect below. Under emulation of the fix, all 24 reminder links were 30-minute and single-use. |
| 4.5 reminder filters, one send | FAIL on `348ccdf2` → **fixed** | Same cause. With the fix: one email per stage, none to deleted, purged or decided rows. |
| 4.6 mobile fields | BLOCKED (markup PASS) | `type=tel`, `inputmode=tel`, `autocomplete=tel` / `email` / `name`. A real keypad and autofill need real devices. |
| 4.7 locked state stops retry | PASS | |
| 3.1 contract dates | PASS | "Oct 25, 2026", "Oct 11, 2026", "Jan 11, 2027". The execution date is the New York day. |
| 3.2 preview before midnight UTC, Send after | PASS | Release A refuses the same steps, so the test distinguishes the two. |
| 3.3 voided agreement | PASS | "Cancelled · No Action Needed"; 0 Review & Sign buttons, at all sizes. |
| 3.4 reused signing link | PASS | "This Link Is No Longer Active" plus "Sign In to Your Portal". |
| 3.5 uppercase initials | PASS stored / BLOCKED printed | The only sendable template has no initials cell. |
| 3.6 agreement metadata | PASS | Template version and fingerprint stored; PDF SHA-256 matches. `template_key` is null because only the built-in template is sendable. |

**Owner addendum:**

| Requirement | Result |
|---|---|
| Decided applications not editable by resume link | PASS |
| Signed agreement PDFs not deletable | PASS |
| Save and resume | PASS |
| 30-minute single-use recovery links | PASS |
| **Existing 14-day sessions remain valid** | **PASS** (detail below) |
| eSign dates, voided agreements, reused links, initials | PASS (printed initials BLOCKED, as 3.5) |
| Mobile layouts | PASS in emulation; real devices outstanding (§4) |

The 14-day session token:
- survives 2 and then 7 recovery requests, and the consumption of a recovery link;
- still works at 13 days 23 hours;
- is refused after 14 days.

**Defect found and fixed: the reminder cron sent nothing.**
- **Cause.** `claimRecoverySend` (`src/lib/wizard-recovery.server.ts`) sent a PATCH with an `or=` filter and `select=id`. PostgREST 12.2.3 re-applies the `or=` filter to the returned rows. Every claim therefore failed with 42703, even when no row matched.
- **Reproduced** on a local PostgREST 12.2.3 with a zero-row PATCH:
  - `select=id` returns 42703;
  - `select=id,current_step` returns `[]`.
- **Fix (`733804dc`).** The claim now selects `id,current_step`. The cron test's fake now models this PostgREST behaviour; it failed before the fix and passes after.
- **Version caveat.** Whether the hosted PostgREST behaves the same is not confirmed. Probing it would mean a production PATCH, which was not done. The fix is correct either way.
- **Same pattern in Release A.** `safe-autofill.server.ts:58-60` uses the same update + `or()` + `select("id")` pattern. It is outside this candidate's scope and listed under §9.

**Observations, unchanged since Release A:**
- The built-in template prints licence expiry as raw ISO ("2029-06-01").
- The signed-agreement vault card still offers Replace and Needs New. This was not tested.

## 4. Outstanding mobile and device checks (real iOS Safari and Android Chrome)

**Already proven by Chromium emulation:**
- no horizontal overflow at 320, 360, 390 and 412 px on the home page, /apply, the wizard, /sign, the portal and the Drivers drawer;
- correct input types, `autocomplete` and `inputMode`;
- touch drawing on the signature pad (a 31-point drawn signature was stored).

**Still to check on real devices:**
1. The numeric phone keypad and the native autofill sheet (row 4.6).
2. Safe-area insets and the dynamic toolbar on iOS; the sticky wizard footer.
3. Drawing a signature with a finger versus page scroll; rotating after drawing.
4. WebKit rendering. Emulation used Chromium only.
5. Saving when iOS backgrounds the tab (pagehide).
6. Airplane-mode offline, then recovery (row 4.2).
7. Opening resume, recovery and signing links from the Mail and Gmail apps.
8. Cursive signature fonts.

These need Lovable Preview or Publish plus real devices. On production-backed Preview, use only non-destructive checks; never submit, approve or sign customer records.

## 5. PR 2 database packages and migration dependencies

Two guarded direct-route packages, prepared and tested locally only. Each is a single DO statement using guard v3, writes no Drizzle or Supabase ledger entry, has its own preflight, verify-after and rollback, `SHA256SUMS`, and a `build.py --check` that reproduces it byte for byte.

| Package | Request SHA-256 | Rollback request | Changes |
|---|---|---|---|
| `proposed/activation-insurance-setting` | `b80babcc275bea4682bc9b69ba3ce11d5f2833ced848c9682b00979311765505` | `57498a82…3893` | Adds the `app_settings` key `rental_activation` (OFF), an Owner-only setter, write guards on that key, and the service_role-only `activate_rental_checked_tx`. The wrapper re-checks insurance, documents, agreement and actor tier under lock and writes `rental.activated` in the same transaction. |
| `proposed/insurance-verification-authority` | `eb7710d7fc3ff58adc0c1d0424245b205dda98f9f319ad29f24adf5363e68950` | `69d5dcef…d082` | Adds a Manager/Owner setter with audit in the same transaction, and the trigger `zz_insurance_decision_guard` on `driver_screenings`. The trigger refuses direct writes of `insurance_verified` / `_at` / `_by` by `authenticated`, `anon` and `service_role`. It does not touch `public.applications`. |

The earlier `5a60c6fe` hashes are superseded.

**Dependencies:**
- **S1:** both packages assume S1 is installed, which it is.
- **Drizzle 0023:** independent.
- **M2 Window 1 / Window 2:** either order. Recommended: before Window 2.

**Ordering constraint I verified against the code.**
- The live Release A screen (`DriverScreening.tsx:767-769`, unchanged in the candidate) writes `insurance_verified` directly from the browser.
- Installing **insurance-verification-authority before PR 2's app is live would break the "Insurance Verified" toggle in production.**
- So the PR 2 app must be published first, then the SQL.
- The activation-insurance-setting package has no such constraint, because Release A never calls its objects.

## 6. Compatibility with S1, Security 0031 and M2

All of this was tested on the PR 2 private PG 17.6 cluster with the real, unmodified artifacts:
- **S1:** S1's own `verify-after-readonly.sql` returns all gates true with both packages installed in either order. **S1's `rollback.sql` succeeds** after them.
- **M2:**
  - the Window 1 preflight is clean;
  - Window 2 applies and verifies before, between and after the packages;
  - M2's rollbacks succeed with the packages installed;
  - under the Window 2 lock, activation gets 40001 and writes nothing; a retry succeeds.
- **Security 0031:** install requires 0031 exactly as installed. The packages' own rollback also works after a 0031 rollback.
- **No conflict was found, and no approved security artifact needed modification.**
- **Release candidate:** contains no SQL, so it has no database interaction with S1, 0031 or M2. The application write paths in PR 1 and PR 4 use server functions (`supabaseAdmin`), so they are unaffected by S1's browser-write refusals.

**PR 2 permission matrix (server functions and database, each backed by tests):**

| Action | Coordinator | Manager | Owner |
|---|---|---|---|
| Verify or revoke insurance | Denied | Allowed, audited | Allowed, audited |
| Change "Allow Activation Without Insurance Verification" | Denied | Denied | Allowed, audited |
| Use the insurance exception (setting ON + acknowledgement) | Denied | Allowed | Allowed |
| Activate a rental | Denied | Allowed | Allowed |

The two permissions are independent:
- Turning the setting ON grants no verification rights.
- With the setting OFF, nobody can activate with unverified insurance, the Owner included.
- The exception never marks insurance as verified.

## 7. Recommended merge order

1. **PR 1** `9c66abd8` → **PR 4** `733804dc` (stacked on PR 1) → **PR 3** `1bcb437a`. The merged result is the candidate `700e7bcc`.
2. **PR 2** `4abfeb45` after the candidate. A trial merge onto `700e7bcc` is clean (merge-tree, no conflicts). Run its tests again after merging.

Pushing the four branches and opening PRs for review needs your approval. None has been pushed.

## 8. Recommended production deployment sequence

Each step needs separate explicit approval. Steps marked **app-only** have no database change.

1. **Release A.1 (app-only): the candidate `700e7bcc`.**
   1. Owner-approved update of the Preview branch.
   2. Non-destructive Preview checks plus the real-device checks (§4).
   3. Publish.
   4. Rollback is a republish of `14cbf81b` (`RELEASE-A-ROLLBACK.md`).
   5. Watch the first hourly reminder run: "claim failed" lines in the logs and the reminder-sent stamps. This confirms the PostgREST fix on hosted.
2. **Release A.2 (app-only): PR 2 app.**
   - With no SQL installed it fails closed: activation needs verified insurance, and overrides are refused.
   - Insurance decisions go through the server with audit first (`atomic:false`).
   - Rollback is a republish of A.1.
3. **SQL, each a separate approval, single submission, with preflight → request → verify-after:**
   1. `activation-insurance-setting` (setting OFF by default; no flag activation).
   2. `insurance-verification-authority` (**only after step 2 is live**).
4. **Owner setting:** turning on "Allow Activation Without Insurance Verification" is a separate business decision; it stays OFF by default.
5. **M2 Window 1, then Window 2:** unchanged plan, separately gated. S1 is already in place, as Window 2 requires.
6. **Drizzle 0023:** unchanged, separately gated.

## 9. Remaining blockers and business decisions

**Blockers:**
1. No isolated hosted Preview exists. Authenticated testing on Lovable Preview would use production data.
   - **Option A:** non-destructive Preview checks plus real devices.
   - **Option B:** an approved separate Lovable project with its own database, a much larger setup.
2. Real-device mobile checks (§4).

**Decisions:**
1. **Coordinator insurance uploads and "flag for review."** These were not built. Document upload is Manager-only by the reviewed security position, and Security 0031 hides insurance documents from Coordinators, so allowing them means revisiting 0031. Coordinators can already edit insurance information and use **Request Verification**, which is audited.
2. **Activation before the PR 2 SQL is installed.** Choose one:
   - keep the current fail-closed fallback: verified insurance is required, overrides are refused, and a failed audit write is shown to staff;
   - refuse every activation until the package is installed.
3. **Interview.** It is optional by current design and stays a soft blocker: overriding it needs a written reason and is re-checked in the transaction. Keep it soft, or make it hard?
4. **Gig profile.** It stays advisory and shows "Gig Platform: Not Verified".
5. **Other limitations:**
   - `provisionDriverAccount` runs before the activation transaction.
   - Notifications are sent after commit.
   - Record Rental (dark) calls `activate_rental_tx` directly.
   - Paper agreements record `agreement_version` as null.
6. **Pre-existing, outside scope:**
   - `safe-autofill.server.ts:58-60` uses the same `or()`-on-update pattern and may fail on the hosted PostgREST.
   - Licence expiry prints as raw ISO.
   - The signed-agreement vault card offers Replace and Needs New.

**Release A monitoring:** unchanged. The scheduled check-in at 2026-10-25T23:57Z re-checks the baseline and S1. This work ran no production queries.
