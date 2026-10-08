# Application Resume — Isolated GitHub Release Plan

Read-only plan. Nothing has been changed, branched, deployed or written to the database.

## 1. Repository facts (verified)

- **GitHub repository: none connected.** The project's code lives only in Lovable's own private storage. No GitHub repo exists yet, so step 0 below is required.
- **Current working version:** `cbba6b83` ("Added profile conflict logic", 2026-10-08 17:38 UTC). It contains every unfinished feature.
- **Production version: not verifiable from here.** Publish settings only report "published, public". The most recent history entry mentioning publishing is `9bc1c15b` ("Published 4D to Sedan fix", 2026-10-08 12:03 UTC). It is a **candidate, not proof**; step 2 proves or rejects it.
- **Sync:** once connected, Lovable and GitHub sync both ways in real time on the active branch. Pushes to the active branch change the Lovable project immediately. Other branches don't affect it until the editor switches to them.
- **Publishing:** Lovable publishes whatever branch the project is currently on. It cannot publish a different branch while staying on main.

## 2. Release strategy

```text
main (cbba6b83, all unfinished work) ──────────────── untouched
   │
   └─ tag: preserve/2026-10-08-all-pending   (safety copy)

<production commit> ── release/app-resume ── backported resume files ── publish
   └─ tag: prod/baseline-before-resume       (rollback point)
```

Steps:
0. **You** connect the project to GitHub (+ menu → GitHub → Connect). This creates the repo with full history.
1. Tag `cbba6b83` as `preserve/2026-10-08-all-pending`, in GitHub, by you or a developer. Nothing is ever force-pushed to main.
2. **Prove the production baseline:** build candidate `9bc1c15b` in a scratch folder and compare its output files against the files drivereal.com serves now. Match = baseline. No match = try the neighbouring commits. If none match, **stop**: no publish without a proven baseline.
3. Create `release/app-resume` from the proven baseline and tag it `prod/baseline-before-resume`.
4. **Controlled backport, not cherry-pick.** The resume commits are interleaved with Waitlist, Passwordless and Sticky Header commits in the same files, so cherry-picking would drag in unfinished code. Each file is rebuilt on the baseline with only the resume changes.
5. Switch the Lovable editor to `release/app-resume`, build and test in preview, publish (after your approval), verify live, then switch the editor **back to main**.

## 3. Change inventory (resume only)

| File | Treatment |
|---|---|
| src/lib/resume-tokens.server.ts | Whole file (resume-only) |
| src/lib/resume-token.ts | Whole file |
| src/components/site/WelcomeBack.tsx | Whole file |
| src/routes/thank-you.tsx | Whole file |
| src/lib/identity-review.functions.ts | New, whole file |
| src/components/admin/IdentityReviewCard.tsx | New, whole file |
| src/lib/applications.functions.ts | **Hand backport**: submit/match, requestApplicationLink, openResumeLink, recovery send/throttle, identity-review insert only |
| src/routes/apply.tsx, ApplicationWizard.tsx, CityHeroLeadForm.tsx | Hand backport of recovery-panel and resume parts only |
| src/lib/email.server.ts | Hand backport of the recovery-link email only (no passwordless emails) |
| src/routes/api/public/cron/wizard-recovery.ts | Diff check; backport if changed |
| src/components/admin/DriversPanel.tsx | **Baseline version + 2 lines** (import + card). No Waitlist/Deletion/Sticky code |
| scripts/resume-payload.test.mjs | Carried over |

Explicitly **excluded**: waitlist.*, driver-deletion.*, portal-signin.*, portal-access.*, ApplicantHome, login.tsx changes, financial-ledger.*, FileUploader/FileDropBridge, photo-enhance.*, driver-payment-status.*, admin sticky CSS/chrome.

Proof of exclusion: a diff of release against baseline must list only the files above. A text search of the release for `setWaitlistHold`, `soft_delete_application`, `portal_signin`, `fin_`, `photo-enhance`, `admin-sticky-bar` and `getDriverPayStatuses` must return nothing new.

## 4. Database compatibility

- Needed by the release: `application_resume_tokens` (already live) and 0019/0020 `application_identity_reviews` (already live). **No migration runs and nothing is re-applied.**
- 0008–0018 are already live and additive; the baseline code ignores those tables.
- **Known live effect:** 0017 revoked direct application deletion for staff roles. Any delete button in the current production code already fails today. That's unchanged by this release and gets listed in the report.
- The release's migration folder must match the database journal. All 20 migration files stay in the branch (copied as files only, never re-run) so a future merge doesn't conflict.

## 5. Verification before publish (preview on release branch)

- Typecheck/build pass; resume-payload test passes.
- New applicant starts normally; returning applicant gets a link (controlled inbox team@drivereal.com only); link opens once; expired link recovers; countdown is accurate.
- Answers and documents are preserved; no duplicate application; Waitlist status and attribution unchanged.
- Identity warning survives a re-score; Manager resolves it in the browser; Driver and signed-out users are denied.
- Temporary fixture records are removed afterwards; before/after record counts are reported.

## 6. Deployment and rollback

- **Deploy:** you approve → publish from `release/app-resume` → live checks (resume flow, identity-review permissions, one controlled email, record counts) → editor back to main.
- **Rollback:** switch to `prod/baseline-before-resume` and publish (or use the publish history). The database needs no rollback; the identity table is unused by the old code.
- **Afterwards:** merge `release/app-resume` into main so main isn't missing the fixes. This is a review step, because those files overlap with unfinished work.

## 7. Risks to existing work

- While the editor is on the release branch, the preview won't show the unfinished features. They're safe on main and tagged.
- If someone edits in Lovable while on the release branch, those edits land on the release branch. **No other development until the switch back.**
- The hand backport is new code and is tested only on the release branch.
- If the production baseline can't be proven, the plan stops at step 2.

## 8. Your approvals required

1. Connect GitHub (you perform it).
2. Approve the proven baseline commit after step 2.
3. Approve the backport diff (file list plus the exclusion search results).
4. Approve the switch of the editor to the release branch.
5. Approve publishing.
6. Approve the merge back into main.
