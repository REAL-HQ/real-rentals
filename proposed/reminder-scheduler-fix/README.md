# Reminder scheduler fix v1: `wizard-recovery-hourly`

**Status: PREPARED, NOT APPROVED.** Nothing here has run in production. Only read-only queries were used
to prepare it, and the preflight ran once read-only on 2026-10-25 at 14:53Z.

## Root cause

- **Failing jobs:** production's `cron.job` has two jobs, `wizard-recovery-hourly` (jobid 2, `15 * * * *`)
  and `ops-reminders-daily` (jobid 3, `30 13 * * *`), that call `extensions.http_post(...)`.
- **The function doesn't exist.** Only pg_net's `net.http_post(text, jsonb, jsonb, jsonb, integer)` is
  installed (pg_net 0.20.3).
- **Since when:** every run has failed since at least 2026-07-23. There are 2,271 failed runs for jobid 2,
  and none has ever succeeded:
  `ERROR: function extensions.http_post(url => unknown, headers => jsonb, body => jsonb) does not exist`.
- **Origin:** Lovable migration `20260722235657`. It re-created the job "because it referenced
  net.http_post in public" and switched to `extensions.http_post`. `20260815153000` copied the pattern into
  ops-reminders.
- **The working jobs** (automations, late-fees, esign-archive-retry) use the identical command with
  `net.http_post`. With the fix applied, the wizard command is that same text with only its route name
  and token name differing.
- **Effect:** no hourly application reminder has ever been sent. The `application_resume` emails in
  `email_deliveries` are resume links that applicants or staff requested.

## Scope

The fix covers **only jobid 2**. Its command text becomes the same bytes with `extensions.http_post(`
replaced by `net.http_post(`, applied through `cron.alter_job`. Unchanged:
- the URL, the headers, the token lookup (`private.cron_tokens`, name `wizard-recovery`) and the body;
- the schedule, the active flag and the owner;
- every other job;
- every application row;
- policies and both ledgers.

One `audit_log` evidence row is written.

`ops-reminders-daily` is **deliberately not included**. Its route sends driver emails for past-due
balances, expiring licences and unsigned agreements, plus two team digests. It sends first and logs
after, with a 6-day spacing and no claim-before-send. It would email no one today (all counts are 0), but
it needs its own review and approval. The package refuses if that job's bytes have changed.

## Eligibility at preflight (14:53Z, read-only, A.1 filters)

| Window (released app `src/lib/wizard-recovery.server.ts`) | Eligible |
|---|---|
| 24h nudge: open draft created 24–26h ago, not yet nudged | 0 |
| 72h nudge: created 72–96h ago, after a 24h nudge | 0 (no 24h nudge has ever been sent) |
| Abandoned: `partial` created 3–48h ago, not yet emailed | **1** |
| Open drafts outside every window (never emailed by design) | 63 |

**No backlog is possible.** Every window is bounded in time. Rows older than 96h (24h/72h) or 48h
(abandoned) are never selected. The 72h nudge needs a 24h nudge first, and none exist.

**Steady state:** about 37 applications per week. Each open draft can get at most one abandoned
email (only if `partial`), one 24h nudge and one 72h nudge, each at most once.

## First-run safeguards

1. **Released code only.** Install only after A.1 (`4a0eed9c`) is verified live.
   - A.1 brings claim-before-send, the real closed-status list (Release A's filter named a phantom
     `rejected` status), 30-minute single-use links, and an `or=` claim that works on 14.5.
   - Release A's code would mint 14-day links and could email declined or closed applicants.
2. **Volume cap in the package:** it refuses (`FIRST_RUN_VOLUME_EXCEEDS_CAP`) if the first run would
   send more than **10** emails.
   - The cap counts emails, not people: a `partial` draft 24–26h old that hasn't had an abandoned email
     counts twice.
   - The count is computed in the same transaction, with the app's filters. A test checks it against the
     app's own `isRecoveryCandidate` and windows.
3. **Drift gates:**
   - The job must be byte-identical to the July definition (md5 `1c830e74…`), with schedule
     `15 * * * *`, active, owner `postgres`.
   - ops-reminders must be unchanged (md5 `7a659464…`).
   - pg_net, the route token and `get_cron_token` must be present.
   - No earlier evidence row, so a replay is refused.
4. **Timing (operational):** submit between :20 and :55 past the hour, so the first run (:15) is at least
   20 minutes later. Run `verify-after-readonly.sql` immediately, then again after :15. Take the emergency
   stop below if anything looks wrong.
5. **At-most-once delivery** is the app's own behaviour:
   - the conditional stamp claim happens before each send;
   - a claim is released only if the send definitely didn't happen;
   - links are 30-minute, single-use recovery links;
   - deleted, purged and decided applications are excluded.

## Files

| File | SHA-256 |
|---|---|
| `fix_wizard_recovery_cron.sql` (package) | `4ff26045c5acc84976ef4c47eecb80e53b147962a106072fdb67f78d85375990` |
| `request-fix-wizard-recovery-cron.sql` (guard v3 + package; **the only thing to submit**) | `668be34a08aa23122dbfcbd5aca78b6a9526ab561393ed3706b9f54060b60d50` |
| `rollback.sql` | `698b62657ddb3c358fb26709f62ad602434003d5e03496e7276098171c90761e` |
| `request-rollback-wizard-recovery-cron.sql` (separate approval) | `31116862c415ae0516ec09ed8447f1d7a30f7300ad9ab39301a0ffb2fa233a31` |
| `preflight-readonly.sql` | `070444d569864f81a670ac2f79becc75e162e365cd7998262d20f9e4f9ad93af` |
| `verify-after-readonly.sql` | `6db1b4a6cf81faf7d2d5df2f441a2be947b513f3b98ae1e11c219cf9f713c2e3` |
| `scripts/sql-guard/gen-guard3.py` (the reviewed guard generator) | `2c8c8967…66f7` |

## Production sequence (each step needs approval; single submission; no automatic retry)

1. **Prerequisite:** A.1 is verified live (`data-commit-sha` `4a0eed9c` on drivereal.com).
2. **Preflight:** `preflight-readonly.sql` with `SET TRANSACTION READ ONLY`.
   - Every gate must be true.
   - `first_run_eligible` (h24 + h72 + abandoned) must be at most 10.
   - Submit only when the current time is between :20 and :55 past the hour.
3. Submit `request-fix-wizard-recovery-cron.sql` **once**. If the result is ambiguous, inspect read-only
   and stop.
4. `verify-after-readonly.sql`, read-only:
   - `job_fixed` true;
   - `ops_reminders_untouched` true;
   - `evidence_rows` 1.
5. After the next :15 run, `verify-after-readonly.sql` again:
   - the latest run `succeeded`;
   - an HTTP 200 response with the route's JSON report;
   - sends equal to stamps and at most 10;
   - `stamped_on_closed_or_deleted` = 0;
   - reminder links of the 30-minute kind.
6. Watch the next two hourly runs the same way.

## Rollback and emergency stop

| Action | What it does |
|---|---|
| **Emergency stop** (fastest, no reminders sent) | `SELECT cron.alter_job(2, active := false);` Owner approval; one statement. |
| **Rollback** | `request-rollback-wizard-recovery-cron.sql` restores the July command byte for byte (`1c830e74…`), so the job fails again and sends nothing. Other jobs are untouched; one rollback audit row is written; a second rollback is refused. |

Reinstalling after a rollback needs a new package version, because the evidence row refuses a replay.

## Tests

`npm run test:reminder-scheduler-fix` runs `scripts/reminder-scheduler-fix.db.test.mjs`: a disposable PG 17 on
port 55552, with this tree's migrations replayed and stateful `cron` and `net` stand-ins. The `cron.job`
rows are the production commands byte for byte, md5-checked. **28/28 pass.** They cover:
- the root cause reproduced;
- the working mechanism;
- preflight gates and counts;
- parity with the released app's filters;
- the both-windows case;
- refusals: tamper, wrong target, the cap, job drift, ops-reminders drift, missing token, each leaving
  no change;
- install, with exact bytes and other jobs untouched;
- the fixed job posting to the same URL with the same token;
- verify-after;
- replay refused;
- rollback with byte-for-byte restore;
- second rollback refused.

**Not reproducible locally:** hosted privileges (the local `postgres` is a superuser) and pg_cron's
C-level `alter_job`. Production facts checked read-only:
- `postgres` may execute `cron.alter_job` and owns job 2 (`username` = `postgres`);
- `cron.job` is owned by `supabase_admin`, and `postgres` has SELECT only;
- for that reason the package takes an advisory lock and does not lock `cron.job`.
