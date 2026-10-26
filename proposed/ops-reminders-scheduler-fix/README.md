# Ops reminders scheduler fix v1: `ops-reminders-daily`

**Status: PREPARED, NOT APPROVED.** Nothing here has run in production. It was prepared and tested only on a
disposable local PostgreSQL 17 (+ PostgREST 14.5); no query of any kind was sent to the hosted database. The
read-only preflight below has **not** been run in production yet.

**The app release must be live first.** This package only repairs the scheduler. The route it starts calling
must already be the version with claim-before-send and the 10-email cap (branch `fix/ops-reminders-safety`),
verified live on drivereal.com by its served `data-commit-sha`. The released route at `a3df8545` sends first
and logs after, with no cap: overlapping calls double-send and the first run would email the whole backlog.

## Root cause

- Production's `cron.job` jobid 3, `ops-reminders-daily`, schedule `30 13 * * *`, owner `postgres`, calls
  `extensions.http_post(...)`. That function does not exist (only pg_net 0.20.3's
  `net.http_post(text, jsonb, jsonb, jsonb, integer)` is installed), so **the job has never run**.
- Origin: Lovable migration `20260815153000` copied the broken pattern from the wizard-recovery job
  (`20260722235657`). The wizard job (jobid 2) was repaired on 2026-10-25 by `proposed/reminder-scheduler-fix`
  and now holds the fixed command (md5 `478d975efc9c11c5ad5e6c1fe7769ece`).
- The working jobs (automations, late-fees, esign-archive-retry) use the identical command with `net.http_post`.

| Command | md5 |
|---|---|
| jobid 3 today (`extensions.http_post`, production text, verified locally from the exact template) | `7a6594649bd441f8ecb8baf8fc529368` |
| jobid 3 after the fix (`net.http_post`) | `9d4bc178b65e26da0d7899c96809fc44` |
| jobid 2 (installed wizard fix; must be unchanged) | `478d975efc9c11c5ad5e6c1fe7769ece` |

## Scope

Only jobid 3. Its command becomes the same bytes with `extensions.http_post(` replaced by `net.http_post(`,
applied through `cron.alter_job`. Unchanged: URL, headers, token lookup (`private.cron_tokens`, name
`ops-reminders`), body, schedule, active flag, owner, every other job (job 2 is checked to be the installed
wizard fix, and all others are snapshotted and compared after), and every application, payment, agreement and
message row. One `audit_log` evidence row (`entity_type` `database_migration`, `entity_id`
`ops_reminders_cron_fix`) is written. An advisory lock (7310201, shared with the wizard package) is taken
instead of locking `cron.job`, which `postgres` may only SELECT.

## What the route sends (eligibility unchanged by the app release)

| Category | Rule | Bounded in time? |
|---|---|---|
| Past-due driver email (`payment_past_due`) | a payment with `due_date` before today (UTC), status pending/failed/overdue/past_due/unpaid/late, `balance_due` (else `amount`) > 0; one email per driver | **No lower bound**: a balance due a year ago still qualifies |
| Licence driver email (`license_expiring`) | application approved/active, `license_expiration` on or before today + 30 | **No lower bound**: long-expired licences qualify |
| Unsigned agreement nudge (`esign_signing_reminder`) | agreement sent/viewed more than 3 days ago, token unexpired; one per driver | Yes (token expiry) |
| Service-due digest (`service_digest`) | to team@drivereal.com | one per UTC day |
| Expiring-documents digest (`service_digest`) | to team@drivereal.com | one per UTC day |

Every driver email keeps the 6-day spacing per driver per kind (`outbound_messages`). Because two categories have
no lower bound, the first run could otherwise reach the whole backlog; the app cap and the package's volume gate
bound it. The preflight reports the backlog (`past_due_by_oldest_due`, `licence.already_expired`).

## App safeguards (branch `fix/ops-reminders-safety`; must be live before the SQL)

`src/lib/ops-reminders.server.ts` (the route only checks the bearer token and calls it):

1. **Claim before send.** The `outbound_messages` row that dedupes the next run is inserted *before* the email
   (status `queued`); the runner then reads back any other row for the same driver and kind in the 6-day window
   (for a digest: the same digest today). If there is one it deletes its own row and does not send. Each
   PostgREST request is its own committed transaction, so of two claimers the one that reads second always sees
   the other's row: both cannot see none, so both cannot send. Both may back off; a random pause and retry
   (3 attempts) then lets one win. No schema change was needed.
2. **At most once.** A claim is released (its own row deleted, by id, only while still `queued`) when the send
   definitely did not happen: the sender threw, or Resend refused (4xx other than 409). Uncertain outcomes
   (timeout, 5xx, 409) keep the row (`queued`, `error` = `uncertain: ...`), so the 6-day spacing holds. A sent
   email marks the row `sent` with the Resend id.
3. **Cap.** At most **10 driver emails per run**, across the three kinds, counted at the claim. And **10 per
   rolling 24 hours across all runs**: after each claim the runner counts this route's driver claim rows from
   the last 24h (any run's, committed); above 10 it releases its own claim unsent and stops. Unreadable counts,
   spacing reads or read-backs fail closed (no email). Candidates past the cap stay unclaimed and are reported
   as `capped`.
4. **Digests** at most once per UTC day each, claimed the same way.
5. **Report.** The JSON starts `{"ok":true,"past_due":...` and gives, per category, `considered`, `sent`,
   `failed`, `capped`, `skipped_recent`, `skipped_claimed`, `skipped_no_email`; per digest `items`, `sent`,
   `failed`, `skipped_today`; plus `driver_claims`, `budget_reached`, `max_driver_emails_per_run`,
   `budget_window_hours` and the old fields.
6. **Tracking.** The past-due, licence and digest senders now return the send result (they used to return
   nothing). The agreement nudge, which was untracked, now records `email_deliveries` rows under workflow
   `esign_signing_reminder`.

## First-run safeguards in the package

1. **App release live** (above). Not checkable from SQL; operational gate.
2. **Volume gate:** refuses (`FIRST_RUN_VOLUME_EXCEEDS_CAP`) when the route's own rules give more than **10**
   driver emails (past due + licence + agreements, each per driver, minus anyone reminded in the last 6 days).
   The route's read limits (200/200/100) are not applied, so the count can only be higher than what the route
   would see. It is computed at submission; the run is later the same day, and the app cap bounds it either way.
3. **Drift and scope gates:** job 3 byte-identical to the August definition (md5 `7a659464...`), schedule
   `30 13 * * *`, active, owner and database `postgres`; job 2 is the installed wizard fix (`478d975e...`,
   `15 * * * *`, active); pg_net, the `ops-reminders` token and `get_cron_token` present; no earlier evidence row.
4. **Timing (operational):** submit between 12:00 and 13:10 UTC, so the first run (13:30) is 20-90 minutes later
   and the volume count is fresh. Run `verify-after-readonly.sql` at once, then again after 13:30.

## Files

| File | SHA-256 |
|---|---|
| `fix_ops_reminders_cron.sql` (package) | `07dc5299a223cce9a1c710c7b85292878ea3fdd1b5d24b7e1b8ed6695b909c34` |
| `request-fix-ops-reminders-cron.sql` (guard v3 + package; **the only thing to submit**) | `8a6a21666e6cdcb48f583addd8e7890e294fac87f78613dd483a2225006f1add` |
| `rollback.sql` | `19e285a0482d816ff0902d91fad46d370552c096f7965e7539db3b4701026408` |
| `request-rollback-ops-reminders-cron.sql` (separate approval) | `054863b91c9f1814b90fac6091a506d8e212ce03fa2cd98884b7b1c4233736e9` |
| `preflight-readonly.sql` | `147ccedcd29097d8fa79f2b90185d49aa199810eea5b626f71937743c94c4e37` |
| `verify-after-readonly.sql` | `c3bc2389cd4378b2b1c7cf8f7e8a9138580d5a9e8b0921d822a8564863f3bbcb` |
| `scripts/sql-guard/gen-guard3.py` (the reviewed guard generator, byte-identical to the wizard package's) | `2c8c8967cee235af6a2475044b8ad5638b7361b985f8a74c699b9655cba966f7` |

The request files are `gen-guard3.py <package>` followed by the package bytes; the DB test regenerates them and
checks they match, and checks `SHA256SUMS`.

## Production sequence (each step needs approval; single submission; no automatic retry)

1. **Prerequisite:** the app release with the claim and cap is verified live (`data-commit-sha` on
   drivereal.com equals the approved commit).
2. **Preflight:** `preflight-readonly.sql` with `SET TRANSACTION READ ONLY`. Every gate must be true
   (`first_run_within_cap` included). Review `backlog` and `team_digests`. If the volume gate is false, stop: the
   owner decides on the backlog first (see below).
3. Submit `request-fix-ops-reminders-cron.sql` **once**, between 12:00 and 13:10 UTC. If the result is
   ambiguous, inspect read-only and stop.
4. `verify-after-readonly.sql`, read-only: `job_fixed` true, `wizard_recovery_untouched` true, `evidence_rows` 1.
5. After 13:30 UTC, `verify-after-readonly.sql` again. It reports each outcome separately, and **an HTTP 200 is
   not proof of delivery**:
   1. **Cron executed:** `cron.job_run_details` for jobid 3 shows `succeeded` (the request was queued).
   2. **HTTP:** `net._http_response` status 200 and the route's report (per-category considered / sent / failed /
      capped, digests, `budget_reached`).
   3. **Claimed:** `outbound_messages` rows since the fix per kind and status (`queued` = claimed, outcome not
      confirmed; `uncertain` counted), driver claims per UTC day (must be at most 10), drivers reminded twice
      within 6 days (must be 0), digests more than once a day (must be 0).
   4. **Provider accepted:** `email_deliveries` per workflow (`payment_past_due`, `license_expiring`,
      `esign_signing_reminder`, `service_digest`): accepted, failed, still sending.
   5. **Delivered:** rows the signed Resend webhook marked delivered; bounced and complained shown. These lag the
      run, so check again later.
6. Watch the next two daily runs the same way.

## Rollback and emergency stop

| Action | What it does |
|---|---|
| **Emergency stop** (fastest, nothing sent) | `SELECT cron.alter_job(3, active := false);` Owner approval; one statement. |
| **Rollback** | `request-rollback-ops-reminders-cron.sql` restores the August command byte for byte (`7a659464...`), so the job fails again and sends nothing. Other jobs untouched; one rollback audit row (`ops_reminders_cron_fix_rollback`); a second rollback is refused. |

Reinstalling after a rollback needs a new package version, because the evidence row refuses a replay.

## Tests

- `npm run test:ops-reminders` (also in `npm test`): the route against an in-memory PostgREST fake with fake
  senders. Eligibility parity with the released route (frozen byte for byte in
  `scripts/fixtures/ops-reminders.route.before.ts.txt`), claim-before-send, overlapping runs, release rules, the
  per-run and 24h caps, digests once a day, fail-closed reads, the report and tracking. `OPS_ROUTE=before` runs
  the same checks on the released route: the protection checks fail there.
- `npm run test:ops-reminders-concurrency`: the runner, many invocations at once, on PostgreSQL 17 + PostgREST
  14.5 (ports 55572/55573), fake senders. `OPS_ROUTE=before` shows the released route sending 200+ emails to
  50 people from 5 overlapping runs.
- `npm run test:ops-reminders-scheduler-fix`: this package on PostgreSQL 17 (port 55576) with stateful `cron`/`net`
  stand-ins and production job text byte for byte (md5-checked), plus PostgREST 14.5 (port 55577) so the real
  runner's sends can be compared with the package's count on the same rows.

**Not reproducible locally:** hosted privileges (the local `postgres` is a superuser) and pg_cron's C-level
`alter_job`. The wizard package established read-only that `postgres` may execute `cron.alter_job` and owns the
jobs, and that `cron.job` is owned by `supabase_admin` with SELECT only for `postgres`.

## Owner decisions

1. **Backlog:** past-due and licence reminders have no lower bound. If the preflight volume gate is false, either
   accept a capped drain (10 a day, 6-day spacing) under a new package version with a higher submission gate, or
   change eligibility (for example a lower bound) in a separate, reviewed app change.
2. **Rolling 24h with a daily job:** a run at 13:30 sees the previous day's claims made after 13:30 minus a few
   seconds of drift, so under a sustained backlog a day can send fewer than 10. It never sends more. A 23-hour
   window would remove that effect at the cost of the strict 24h bound.
3. **New workflow name** `esign_signing_reminder` for the agreement nudge (no schema change; the footer line now
   reads "a REAL RENTALS rental agreement was prepared for you").
