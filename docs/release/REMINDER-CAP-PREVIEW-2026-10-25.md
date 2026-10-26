# Reminder safety cap: Preview update record (2026-10-25)

Owner-authorized Preview update only. **Nothing was published.** The scheduler SQL was not run, and no
cron job, reminder or production record was changed.

## Pre-checks (all passed)

| Check | Result |
|---|---|
| Preview HEAD before | `4a0eed9c65d44f7c3d09c4e2c245ab2bfc92d7fd` |
| Candidate | `release/reminder-cap` @ `a3df8545ea411d1322e27fbddf558fc4073ba4e7` (draft PR #282) |
| Fast-forward | `4a0eed9c` is an ancestor of `a3df8545` |
| Files changed | 2: `src/lib/wizard-recovery.server.ts`, `scripts/wizard-recovery-cron.test.mjs` |
| M2 flags | Both `false` |
| SQL, migrations, Stripe, payments, other files | None |
| Rollback refs | Unchanged: `rollback/live-rc266-67b62664`, `rollback/pre-rc266-7e3e6eb6`, `rollback/pre-release-a-7c7d7b6b`, `release/m2-app-flags-off` `f8b2480f`, `release/post-s1-rc2` `4a0eed9c` |

## Concurrency verification (disposable database)

**Test:** `scripts/reminder-cap-concurrency.db.test.mjs` on `fix/wizard-recovery-cron-schedule` @ `bb8eed6e`
(run it with `npm run test:reminder-cap-concurrency`).

**Setup:**
- The runner (byte-identical in the candidate and the development branch) runs through `@supabase/postgrest-js`.
- The disposable PostgreSQL 17 database has this tree's migrations, served by **PostgREST 14.5**, production's version.
- Every claim, count and release is a real HTTP request and a committed transaction.
- Applicants are synthetic and the senders are fakes, so no email was sent.

**Results: 6/6.**
- One invocation sends 10 of 30 eligible and stamps 10.
- A second invocation within the hour sends 0.
- Ten trials of 2–12 simultaneous invocations sent 10, 10, 10, 10, 10, 10, 10, 10, 10 and 9. That is never more than 10, nobody was emailed twice, and stamps always equalled sends, so over-budget claims were released unsent.
- Once the stamps are older than an hour, the next hour has a fresh budget of 10, and nobody is emailed twice across the two hours.

**Why it holds under true concurrency:**
- Each claim commits before its own count is read.
- So the last sent claim to commit sees every other sent claim, and it sends only if the count is 10 or fewer.
- An unreadable count fails closed.

## Preview update

`git push origin a3df8545:refs/heads/integration/grok-baseline-2026-10-22` gave `4a0eed9c..a3df8545`, a
fast-forward with no `+`.

**Lovable:** project `8cf1f99e` `latest_commit_sha` now reads `a3df8545ea411d1322e27fbddf558fc4073ba4e7`.
`read_file` at that commit returns the reviewed runner.

## Read-only production watch: before (21:31:15Z) and after the sync (21:31:47Z)

| Item | Value |
|---|---|
| Security 0031 | 5 policies, `d33877618a9f40924d14e49b6653d7fa` (unchanged) |
| Policies / Drizzle / Supabase receipts | 170 / 23 / 105 |
| S1 guard | Present |
| `wizard-recovery-hourly` | Still the July command, `1c830e74…` (not fixed; no reminders possible) |
| `ops-reminders-daily` | `7a659464…` (untouched) |
| Reminder stamps / `application_recovery` emails / cron-fix evidence rows | 0 / 0 / 0 |

## Not checkable from here

The Preview and live hosts are not reachable from the agent environment. The cap has no visible UI. It
takes effect only when the hourly job calls the app, which it cannot do until the scheduler SQL is
approved and installed.

## Publication (2026-10-25, Owner-approved)

**Prerequisite:** the Owner verified the live source of https://drivereal.com, which showed
`data-commit-sha="4a0eed9c65d44f7c3d09c4e2c245ab2bfc92d7fd"` (screenshot, 6:16 PM local). A.1 is live.

**Pre-checks (all passed):**

| Check | Result |
|---|---|
| Preview branch | `a3df8545…` |
| Lovable `latest_commit_sha` | `a3df8545…`; no edits since the sync; agent idle |
| Diff against `4a0eed9c` | The two reviewed files only |
| M2 flags | Both `false` |

**Publish:** `deploy_project` called once at about 22:18Z, with no retry.
- Response: `status: pending`, deployment **`92c2db50-6825-4118-81e2-e725f7610dc2`**.
- Rollback target: `4a0eed9c`.

**Production (read-only):**

| Item | Before (22:17:49Z) | After (23:23:22Z) |
|---|---|---|
| applications / documents / storage objects | 155 / 93 / 130 | 155 / 93 / 130 |
| audit_log | 931 | 931 (0 since publish) |
| Security 0031 | 5, `d33877618a9f40924d14e49b6653d7fa` | unchanged |
| policies / journals | 170 / 23 / 105 | unchanged |
| S1 guard | present | present |
| `wizard-recovery-hourly` / `ops-reminders-daily` md5 | `1c830e74…` / `7a659464…` | unchanged |
| reminder stamps / `application_recovery` emails | 0 / 0 | 0 / 0 |
| drivereal.com responses to scheduled calls since publish | n/a | 14 × 200 |

**Live commit:** the Owner confirms `data-commit-sha="a3df8545ea411d1322e27fbddf558fc4073ba4e7"` in the
page source of drivereal.com. The agent cannot reach the live host.

## Scheduler repair: installation (2026-10-25, Owner-approved)

**Prerequisite:** the Owner verified the live source of drivereal.com, which showed
`data-commit-sha="a3df8545ea411d1322e27fbddf558fc4073ba4e7"` (screenshot, 7:27 PM local).

**Preflight (read-only, 23:28:19Z):**
- every gate true;
- job 2 is the July definition (`1c830e74…`);
- ops-reminders is untouched;
- pg_net, the route token and `get_cron_token` are present;
- no earlier evidence row;
- first-run eligible: h24 0, h72 0, abandoned 1 (cap 10);
- Security 0031, 170 policies, journals 23/105 and the S1 guard all as before.

**Submission:** `request-fix-wizard-recovery-cron.sql` (sha256 `668be34a…0d50`, 10,516 bytes) was submitted
**once** at about 23:29Z, inside the :20–:55 window, with no retry. The result was success, with no error.

**Verify-after (read-only, 23:29:28Z):**

| Check | Result |
|---|---|
| `job_fixed` | true (md5 `478d975e…`, `15 * * * *`, active, owner `postgres`) |
| `ops_reminders_untouched` | true |
| Evidence | 1 row at 23:29:12.374Z, txid 104332, recorded first-run eligibility {h24 0, h72 0, abandoned 1} |
| Other jobs (3, 4, 5, 6) | byte-identical |
| Security 0031 | `d33877618a9f40924d14e49b6653d7fa` |
| Policies / journals | 170 / 23 / 105 |
| S1 | guard present; `authenticated` status UPDATE still revoked |
| audit_log | 931 → 932 (the evidence row) |
| applications | 155 |
| reminder stamps | 0 |

**Next:** the first scheduled run is at 00:15Z. The existing scheduled check-in was moved from 23:57Z to
00:25Z, with its prompt extended to verify that run's five outcomes separately. No new routine was created.

## Scheduler first run (00:15Z, 2026-10-26), verified read-only at 00:26Z

| # | Outcome | Result |
|---|---|---|
| 1 | Cron executed | jobid 2 at 00:15:00.106Z: `succeeded` |
| 2 | HTTP | 200 at 00:15:00.124Z. Route report: considered 24h 0 / 72h 0 / abandoned 1; sent 0 / 0 / 1; failed 0; skipped 0; capped 0; `max_claims_per_run` 10 |
| 3 | Claimed | 1 abandoned stamp; 24h 0, 72h 0; **stamped on closed, declined or deleted applications: 0** |
| 4 | Provider accepted | 1 attempt (`application_recovery`), 1 accepted, 0 failed, 0 still sending |
| 5 | Delivered | 1 delivered (signed Resend webhook), 0 bounced, 0 complained |

**Recovery tokens since the fix:** 1, of the 30-minute kind; 0 longer tokens.

**Live-build evidence:** the report contains `max_claims_per_run`, which only exists in the reminder-cap code.
The live app therefore runs `a3df8545`, consistent with the Owner's page-source check.

**Unchanged:**

| Item | Result |
|---|---|
| Job 2 | Fixed md5, active |
| Jobs 3–6 | Identical (ops-reminders `7a659464…` untouched) |
| Security 0031 | `d33877618a9f40924d14e49b6653d7fa` |
| Policies / journals | 170 / 23 / 105 |
| S1 | Guard present; `authenticated` status UPDATE revoked |
| M2 step 2 function | Absent |
| Audit since the fix | Only `scheduler_fix_verified` (1); total 932 |

**Release A watch items:**

| Item | Result |
|---|---|
| 11 (approvals) | **PENDING**: approvals_24h 0, so nothing to check (apps with multiple approvals 0) |
| 12 (uploads) | **PASS**: uploads_24h 2, uploads_24h_without_object 0 |

Counts: applications 155, approved 2, documents 93, storage objects 130.
