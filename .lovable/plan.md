# REAL RENTALS — SECURITY HOTFIX LOVABLE BRANCH ACCESS: BLOCKED

Read-only findings. Nothing was switched, published, merged or changed. Approving this plan authorizes no deployment: it only accepts the findings and the next step.

## 1. Branch visibility (checked in this project)

- Lovable's own copy of the code holds only three branches: `main` (`c6a7603e`), `_agent-publish` (`5bc960c0`), and dated backup copies of main.
- `hotfix/security-identity` is **not** there. Commit `47954e1e` is **not** present either: looking it up returns "object not found".
- This matches Codex's findings:
  - looking up the commit by its exact ID returned "not found";
  - Lovable still reports `c6a7603e` as the project's latest version.
- Reading by branch name returned *something*, but it wasn't the hotfix code. The most likely explanation is that an unknown branch name falls back to main or the latest version. Treat that as **no access**, not partial access.

## 2. GitHub sync limitations

- **Seen in this project:** GitHub changes reach Lovable only through main. Pull requests #15–#17 appeared here only after they were merged into main. No other GitHub branch has ever appeared.
- **General capability (documented, not tested here):** Lovable's docs say the editor can switch to another GitHub branch, and the sync covers the active branch. The switch is done in the editor's settings, not by me.
- **Unverified:** whether switching makes the branch's commits appear here. Also unverified: whether `hotfix/security-identity` would show up in the branch list, since it was created outside Lovable from an older commit.
- I can't see a branch-list or "refresh GitHub" action from here. I can't import a single branch without touching the current workspace: switching changes the code the editor and preview use, which is shared state.

## 3. Publishing behaviour

- **Seen here:** the internal `_agent-publish` marker equals `5bc960c0`, which is what's live. Publishing appears to record the published version separately from main.
- **General capability:** publishing releases the editor's active branch as it stands. Lovable can't publish a different branch while staying on main.
- **Unverified, needs support confirmation:**
  - **switching back to main:** whether switching back afterwards leaves the published site unchanged. Expected yes: publishing is manual, and switching shouldn't redeploy.
  - **database and secrets:** whether switching affects the database, sign-in settings or saved keys. Expected no, because they're shared and not tied to a branch.
- **Database warning:** any database change, such as 0031 or 0032, takes effect on the live site the moment it's applied, separately from publishing.

## 4. Safest supported procedure (requires approvals)

1. **Support confirmation first** — Lovable support confirms three things (escalation text below):
   - the hotfix branch can be selected;
   - publishing from it releases only `47954e1e`;
   - switching back to main doesn't redeploy anything.
2. **You switch the branch** — you select `hotfix/security-identity` in the editor's GitHub branch settings.
   - Before anything else, confirm the editor's latest version is `47954e1e`, not `c6a7603e`.
   - Make no edits in Lovable while on that branch.
3. **Read-only check (my part)** — I rebuild the code and confirm two things:
   - the 84 browser files match the live set;
   - the only changed files are the 3 server files.
4. **You publish** — with explicit approval. Then check the live site and the security fix.
5. **Switch back** — you switch the editor back to main, then confirm the live site is still serving the hotfix files.
6. **Database changes separately** — any 0031/0032 change gets its own approval. It must also work with the hotfix code and with main.

Rollback: switch back to `5bc960c0`, or ask support to redeploy deployment `f2d37db0`. That would bring the exposure back, so use it only if the hotfix breaks the site.

## 5. Is provider support required?

Yes, before any publish. Two things can't be verified without risking shared state:
- whether the hotfix branch can be selected;
- what publishing and switching actually change.

## 6. Support escalation text (draft — not sent)

> Project 8cf1f99e-71ad-4a93-a47c-bfbe833616d6 (drivereal.com). Security issue: applicant identity-data exposure; server-only fix ready.
> The fix is on GitHub REAL-HQ/real-rentals, branch `hotfix/security-identity`, commit `47954e1eb49cc306afde647d463c1f369802d35a`. It's built on our live version `5bc960c0` (your internal `_agent-publish` ref; deployment `f2d37db0-25e1-40e2-aa18-43d63c0f2f6f`).
> The branch and commit don't appear in the project's Lovable copy of the code. Only `main`, `_agent-publish` and backups exist, and the commit lookup returns not found. Main (`c6a7603e`) contains unreleased work that must not be published.
> Please:
> (1) map deployment f2d37db0 to its source commit;
> (2) make `hotfix/security-identity` selectable for this project, or explain why it isn't synced;
> (3) confirm that publishing from that branch releases only commit 47954e1e;
> (4) confirm that switching back to main afterwards doesn't redeploy or change the database, sign-in settings or saved keys;
> (5) give a supported rollback to deployment f2d37db0 if needed.

## 7. Exact next approval needed

Approve sending the support escalation above. No branch switch, publish, merge or database change happens until support answers and you approve each step separately.
