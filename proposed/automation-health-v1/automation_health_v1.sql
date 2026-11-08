-- Staged only. NOT applied to production. Needs Owner approval to install.
--
-- Read-only schedule health for Back Office → Automations: each cron job's
-- name, whether it is active, and the status/time of its latest run. No
-- command text (it can carry tokens), no return messages. Service role only;
-- the server function that calls it is Manager+.
CREATE OR REPLACE FUNCTION public.automation_cron_health()
RETURNS TABLE (jobname text, active boolean, last_status text, last_run_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cron
AS $$
  SELECT j.jobname::text, j.active,
         d.status::text, d.start_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status, start_time FROM cron.job_run_details r
    WHERE r.jobid = j.jobid ORDER BY start_time DESC LIMIT 1
  ) d ON true;
$$;
REVOKE ALL ON FUNCTION public.automation_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_cron_health() TO service_role;
