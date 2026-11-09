-- Restores the previous (failing) command. Only useful to undo exactly.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'ops-reminders-daily'),
  command := $cmd$
  SELECT extensions.http_post(
    url := 'https://drivereal.com/api/public/cron/ops-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'ops-reminders')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$);
