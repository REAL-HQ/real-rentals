# Staging build (t33u) — HALTED before the first write, 2026-11-01 ~5:45 AM ET

Nothing was executed on `jcjsdribajbfracrmnkm`: no SQL, no migrations, no rows. Production, Lovable, old staging and Stripe were not touched.
`guard.sh --db-only` passed (target = approved staging).

## Why it stopped (ambiguity vs "No production access")
The local rehearsal stubbed `pg_net`/`pg_cron`. On a real Supabase project both extensions are live. The baseline then
**schedules jobs that POST to production `https://drivereal.com/api/public/cron/*`**, authorised with randomly generated
staging tokens (`private.cron_tokens`):
- `20260722235626` / `20260722235657`: wizard-recovery (hourly)
- `20260815153000`: ops-reminders
- `20260925130510`: automations
- `20260925130550`: late-fees
- `20261005060239`: esign-archive-retry
- drizzle `0000`/`0001`: fleet-inbox wake (`net.http_post` on enqueue) plus `fleet-inbox-retry` every minute

Production should reject the staging tokens, but staging would still send unsolicited traffic to production endpoints from
the moment each migration commits. The approved plan doesn't cover this, so I did not run it.

## Proposed fix (needs Owner approval)
Same plan, plus one labelled staging-only step: run each cron-scheduling migration and then, in the **same transaction**,
`SELECT cron.unschedule(jobname) FROM cron.job WHERE command LIKE '%drivereal.com%';`. Also, before drizzle 0000, create
`private.cron_tokens` without a 'fleet-inbox' row so the wake function returns early (it does `IF tok IS NULL THEN RETURN`).
Then add a post-build check that `cron.job` has 0 jobs referencing drivereal.com and `net.http_request_queue`/`net._http_response`
show 0 requests. The cron job list is not part of the 197-object comparison, so equivalence is unaffected.
