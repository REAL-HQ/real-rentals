-- lovable-cron-fallback-reviewed: wake-on-enqueue via trigger; per-minute retry timer is armed only while open jobs exist and unscheduled by the worker after drain
CREATE TABLE public.fleet_inbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.fleet_import_items(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.fleet_import_batches(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'analyze' CHECK (kind IN ('analyze')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','retry_wait','succeeded','skipped','dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  source text NOT NULL DEFAULT 'upload',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX fleet_inbox_jobs_open_uidx ON public.fleet_inbox_jobs (item_id, kind) WHERE state IN ('queued','running','retry_wait');
CREATE INDEX fleet_inbox_jobs_due_idx ON public.fleet_inbox_jobs (next_run_at) WHERE state IN ('queued','retry_wait');
CREATE INDEX fleet_inbox_jobs_batch_idx ON public.fleet_inbox_jobs (batch_id);
GRANT SELECT ON public.fleet_inbox_jobs TO authenticated;
GRANT ALL ON public.fleet_inbox_jobs TO service_role;
ALTER TABLE public.fleet_inbox_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read fleet inbox jobs" ON public.fleet_inbox_jobs FOR SELECT TO authenticated USING (private.is_manager());
CREATE TRIGGER fleet_inbox_jobs_updated_at BEFORE UPDATE ON public.fleet_inbox_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.fleet_inbox_worker_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lease_until timestamptz,
  paused_reason text,
  paused_at timestamptz,
  last_run_at timestamptz,
  last_run_summary jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.fleet_inbox_worker_state (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.fleet_inbox_worker_state TO authenticated;
GRANT ALL ON public.fleet_inbox_worker_state TO service_role;
ALTER TABLE public.fleet_inbox_worker_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read worker state" ON public.fleet_inbox_worker_state FOR SELECT TO authenticated USING (private.is_manager());

CREATE OR REPLACE FUNCTION public.fleet_inbox_acquire_lease(_seconds integer)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.fleet_inbox_worker_state
     SET lease_until = now() + make_interval(secs => _seconds), last_run_at = now(), updated_at = now()
   WHERE id = 1 AND (lease_until IS NULL OR lease_until < now())
  RETURNING true;
$$;
CREATE OR REPLACE FUNCTION public.fleet_inbox_release_lease(_summary jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.fleet_inbox_worker_state SET lease_until = NULL, last_run_summary = _summary, updated_at = now() WHERE id = 1;
$$;
CREATE OR REPLACE FUNCTION public.fleet_inbox_claim_jobs(_limit integer, _lease_seconds integer)
RETURNS SETOF public.fleet_inbox_jobs LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.fleet_inbox_jobs j
     SET state = 'running', attempts = j.attempts + 1,
         lease_expires_at = now() + make_interval(secs => _lease_seconds)
   WHERE j.id IN (
     SELECT id FROM public.fleet_inbox_jobs
      WHERE (state IN ('queued','retry_wait') AND next_run_at <= now())
         OR (state = 'running' AND lease_expires_at < now())
      ORDER BY next_run_at
      LIMIT _limit
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;

-- Wake the worker now, and keep a 1-minute retry timer armed only while open jobs exist.
CREATE OR REPLACE FUNCTION public.fleet_inbox_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE tok text;
BEGIN
  SELECT token INTO tok FROM private.cron_tokens WHERE name = 'fleet-inbox';
  IF tok IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://drivereal.com/api/public/cron/fleet-inbox',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || tok),
    body := '{}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-inbox-retry') THEN
    PERFORM cron.schedule('fleet-inbox-retry', '* * * * *', $c$
      SELECT net.http_post(
        url := 'https://drivereal.com/api/public/cron/fleet-inbox',
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'fleet-inbox')),
        body := '{}'::jsonb);
    $c$);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_inbox_disarm_if_idle()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.fleet_inbox_jobs WHERE state IN ('queued','running','retry_wait')) THEN RETURN false; END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'fleet-inbox-retry';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_inbox_jobs_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fleet_inbox_wake();
  RETURN NULL;
END $$;
CREATE TRIGGER fleet_inbox_jobs_wake AFTER INSERT ON public.fleet_inbox_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.fleet_inbox_jobs_on_insert();

REVOKE ALL ON FUNCTION public.fleet_inbox_acquire_lease(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_inbox_release_lease(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_inbox_claim_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_inbox_wake() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_inbox_disarm_if_idle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fleet_inbox_jobs_on_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_acquire_lease(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_release_lease(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_claim_jobs(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_wake() TO service_role;
GRANT EXECUTE ON FUNCTION public.fleet_inbox_disarm_if_idle() TO service_role;

INSERT INTO private.cron_tokens (name, token)
VALUES ('fleet-inbox', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;