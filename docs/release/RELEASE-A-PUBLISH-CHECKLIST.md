# Release A: publication and rollback checklist (2026-10-24)

Release A is the Preview branch `integration/grok-baseline-2026-10-22` at
`14cbf81b906cd7c65a587a1dba53c0b8e87d1b1f`:
- tree `df4427c7ea7138e397991afc21200999693a51f7`;
- parents `7c7d7b6b` (#266 plus the 2 Lovable type commits) and `f8b2480f` (Release A).

Both M2 flags are `false`. Background and the after-M2-step-3 rules are in `RELEASE-A-ROLLBACK.md`.

## A. Before publishing (every box, in order; any "no" = STOP)

1. ☐ The owner accepted the read-only Preview checks (`m2-release-a-preview.md` §A):
   - the Verify Identity control is absent;
   - the Applications list, applicant detail and document vault load;
   - existing documents display;
   - no new console or server errors.
2. ☐ `git ls-remote origin refs/heads/integration/grok-baseline-2026-10-22` = `14cbf81b…`. A different
   head (for example a new Lovable commit) means STOP: re-review before publishing.
3. ☐ Lovable `get_project` `latest_commit_sha` = `14cbf81b…`, and the agent is idle (`agentFinished: true`).
4. ☐ No M2 SQL is installed: the Window 1 post-check's `step2_recorder_present` is false, or nothing
   has run since the 2026-10-24 baseline.
5. ☐ The owner has written approval to publish.

## B. Publish

6. The owner clicks **Publish** in the Lovable editor, or Claude calls `deploy_project` only under that
   written approval. One publish, no retry. If the publish is ambiguous, check the published state
   read-only before doing anything else.

## C. After publishing (read-only; no test records)

**No artificial customer activity.** Nobody creates test approvals, uploads, applications or
documents in production to exercise the release. Every check below either only reads, or observes
activity that happens naturally.

**Smoke tests, immediately (read-only):**
7. ☐ Repeat the four §A checks on the live site.
8. ☐ Public pages load: `/` and `/apply` (load only; no submission).
9. ☐ Sign in to `/admin` and `/portal` with existing accounts. The Applications list, an applicant's
   detail and the document vault open, and existing documents display.
10. ☐ `proposed/m2-window1/release-a-watch-readonly.sql` at publish time records the baseline counts.

**Behaviour, observed during the 24-hour watch (only if it happens naturally):**
11. ☐ The next legitimate approval:
    - the status becomes approved;
    - exactly one `application.approved` audit row is written for that application;
    - the watch query's `apps_with_multiple_approvals_24h` stays 0.
12. ☐ The next legitimate upload: its document row exists and displays.
13. ☐ No new server errors in the Lovable logs for 24 hours.

Items 11 and 12 are marked **PENDING**, not failed, if no approval or upload occurs in the 24 hours.
Release A is then "live and healthy" for Window 1 stage 1 on items 7–10 and 13. The pending items
are re-observed later and reported, and nobody manufactures activity to clear them.

## D. Rollback (valid only until M2 step 3)

**Triggers:**
- approving, uploading or viewing documents fails where #266 worked;
- the admin or portal will not load;
- a new error class appears in the logs.

**Steps:**
1. `git revert -m 1 14cbf81b` on `integration/grok-baseline-2026-10-22`, then push. Never reset,
   rebase or force-push.
   - The resulting tree must equal `103eb6b7ed0393b08ed841038754aac905ee9d4b` (= `7c7d7b6b`'s tree;
     pre-computed).
   - Fallback reference: `rollback/pre-release-a-7c7d7b6b`.
2. Confirm Lovable `latest_commit_sha` is the revert commit, then publish (owner approval).
3. Repeat the §C checks against #266 behaviour.

No database change is involved. Data written by Release A is ordinary #266-shaped data. **After M2
step 3, never roll back to #266** (`RELEASE-A-ROLLBACK.md` §2).
