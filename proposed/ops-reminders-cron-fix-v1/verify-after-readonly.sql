SELECT jobname, schedule, active, command LIKE '%net.http_post(%' AS uses_pg_net,
       command NOT LIKE '%extensions.http_post%' AS old_call_gone
FROM cron.job WHERE jobname = 'ops-reminders-daily';
-- After the next 8:30 AM ET run:
-- SELECT status, start_time FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--  WHERE jobname='ops-reminders-daily' ORDER BY start_time DESC LIMIT 1;
-- SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
