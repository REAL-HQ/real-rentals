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
