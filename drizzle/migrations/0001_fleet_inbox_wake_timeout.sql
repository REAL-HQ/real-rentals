-- lovable-cron-fallback-reviewed: same armed-only-while-open-jobs retry timer; only raises the HTTP timeout so the worker is not cut off mid-analysis
CREATE OR REPLACE FUNCTION public.fleet_inbox_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE tok text;
BEGIN
  SELECT token INTO tok FROM private.cron_tokens WHERE name = 'fleet-inbox';
  IF tok IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://drivereal.com/api/public/cron/fleet-inbox',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || tok),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-inbox-retry') THEN
    PERFORM cron.schedule('fleet-inbox-retry', '* * * * *', $c$
      SELECT net.http_post(
        url := 'https://drivereal.com/api/public/cron/fleet-inbox',
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'fleet-inbox')),
        body := '{}'::jsonb,
        timeout_milliseconds := 150000);
    $c$);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fleet_inbox_wake() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_wake() TO service_role;