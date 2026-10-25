# Release A.1: Preview update record (2026-10-25)

This was a single update of the production-connected Preview branch, authorized by the Owner.
**Nothing was published.** The live site stays on Release A (`14cbf81b`, deployment `8818c842`) until a
separate Publish approval.

## Pre-checks (all passed)

| Check | Result |
|---|---|
| `integration/grok-baseline-2026-10-22` HEAD before | `14cbf81b906cd7c65a587a1dba53c0b8e87d1b1f` (expected) |
| Candidate | `release/post-s1-rc2` @ `4a0eed9c65d44f7c3d09c4e2c245ab2bfc92d7fd`, tree `0c00c2e52704650cc61c731c582fd346ffc37b2e` (review PR #281) |
| Integration type | Fast-forward. `14cbf81b` is an ancestor of `4a0eed9c`, which adds 11 commits. No force; history preserved. |
| Contents | 38 files, exactly the union of reviewed PRs #272, #273, #274 and #278 |
| M2 flags | `DOCUMENT_CONTENT_SHA256_ENABLED = false`, `IDENTITY_VERIFICATION_ENABLED = false` (unchanged) |
| SQL / migration / Stripe / payments / eSign engine / flag files | None changed |
| Rollback refs | `release/m2-app-flags-off` `f8b2480f`, `rollback/live-rc266-67b62664`, `rollback/pre-rc266-7e3e6eb6`, `rollback/pre-release-a-7c7d7b6b`: all unchanged |

## Update

`git push origin 4a0eed9c:refs/heads/integration/grok-baseline-2026-10-22` gave `14cbf81b..4a0eed9c`, a
fast-forward with no `+`.

**Lovable sync:** the project `8cf1f99e` `latest_commit_sha` now reads
`4a0eed9c65d44f7c3d09c4e2c245ab2bfc92d7fd`. The A.1 commits appear in the edit history as
`developer_update`.

## Production watch (read-only, `SET TRANSACTION READ ONLY`): before vs after

| Metric | Before (12:34:30Z) | After sync (12:35:15Z) |
|---|---|---|
| applications / approved | 149 / 2 | 149 / 2 |
| approval audit rows | 4 | 4 |
| documents / storage objects | 93 / 130 | 93 / 130 |
| uploads (24h) without object | 0 | 0 |
| Security 0031 policies | 5, `d33877618a9f40924d14e49b6653d7fa` | same |
| policies total | 170 | 170 |
| Drizzle / Supabase receipts | 23 / 105 | 23 / 105 |
| S1 guard `zz_application_write_guard` | present | present |
| M2 step 2 function | absent | absent |
| audit_log total | 892 | 892 (0 rows since the update) |

The sync made no database change.

## Read-only Preview checks

`*.lovable.app` is not reachable from the agent environment (egress proxy). The Owner runs P1–P8
and P4b from `POST-S1-READONLY-PREVIEW-AND-DEVICE-CHECKS.md`:
- P1: the Preview `data-commit-sha` should read `4a0eed9c…`.
- The live site (charming-maker-space.lovable.app) should still read `14cbf81b…`.

**Do not press Publish.** If Preview must be reverted, move the branch back to `14cbf81b`. That needs
approval. Reverting is a fast-forward-safe revert commit, or a reset with Owner approval; either way,
no publish is involved.
