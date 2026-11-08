# ops-reminders-cron-fix-v1 (staged, NOT applied)

Fixes `ops-reminders-daily`, which fails every run because its command calls
`extensions.http_post(...)` (does not exist). Rewrites only that job's command
to `net.http_post(...)`, the same call the four working jobs use. Schedule and
token lookup unchanged; no secret in the file.

Checked read-only in production: `net.http_post(text,jsonb,jsonb,jsonb,integer)`
and `cron.alter_job` exist.

Validated on local Postgres with stand-ins carrying the real signatures
(`local-harness.sql`): applies, re-applies (idempotent), changes only this job,
the new command executes and posts to `/api/public/cron/ops-reminders` with the
Bearer lookup, and it refuses (nothing changed) if `net.http_post` is missing.

**Applying it starts real sends at the next 8:30 AM ET run** (subject to the
Automations switches): due-tomorrow / past-due emails, team payment alerts,
collections plan, license-expiring emails, service digest, agreement
reminders. Review switches first. Files: `ops_reminders_cron_fix_v1.sql`,
`verify-after-readonly.sql`, `rollback.sql`.
