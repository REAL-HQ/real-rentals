# automation-health-v1 (staged, not applied)

Adds `public.automation_cron_health()` so Back Office → Automations can show
"Running" / "Job Failing" / "No Schedule". Read-only, service role only, no
job command text. Until it is installed the page shows "Health Unknown" and
everything else works.

It does **not** fix the failing `ops-reminders-daily` job (its command calls
`extensions.http_post`, which does not exist). That is a separate change.
