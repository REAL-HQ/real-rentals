-- REVIEW ONLY: outside migration discovery. Run atomically, never as individual statements.
-- Requires reviewed Safe Vehicle Release, its lock-compatible Stripe contract if present,
-- existing auth.uid(), user_roles, markets/vehicles/applications/rentals and lifecycle RPCs.
DO $$ BEGIN
 IF to_regprocedure('private.vehicle_release_reasons(uuid,uuid)') IS NULL
 OR to_regprocedure('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)') IS NULL
 THEN RAISE EXCEPTION 'reservation_prerequisites_missing'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE public.reservation_market_rules (
 market_id uuid PRIMARY KEY REFERENCES public.markets(id),
 timezone text NOT NULL,
 turnaround_minutes integer NOT NULL CHECK(turnaround_minutes>=0 AND turnaround_minutes<=10080)
);
-- No configuration seeded: an Owner must approve each market's timezone and turnaround.
CREATE TABLE public.reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
 vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','reserved','confirmed','cancelled','expired','converted')),
 pickup_at timestamptz NOT NULL,
 timezone text NOT NULL,
 agreed_end_at timestamptz,
 turnaround_minutes integer NOT NULL CHECK(turnaround_minutes>=0 AND turnaround_minutes<=10080),
 occupied_until timestamptz,
 hold_expires_at timestamptz,
 rental_id uuid UNIQUE REFERENCES public.rentals(id) ON DELETE RESTRICT,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text,
 CHECK(agreed_end_at IS NULL OR agreed_end_at>pickup_at),
 CHECK((agreed_end_at IS NULL)=(occupied_until IS NULL)),
 CHECK(occupied_until IS NULL OR occupied_until>=agreed_end_at),
 CHECK(state NOT IN ('reserved','confirmed','converted') OR vehicle_id IS NOT NULL),
 CHECK(state<>'reserved' OR hold_expires_at IS NOT NULL),
 CHECK(state NOT IN ('cancelled','expired') OR length(btrim(reason))>0),
 CHECK(rental_id IS NULL OR state='converted'),
 EXCLUDE USING gist(vehicle_id WITH =,tstzrange(pickup_at,occupied_until,'[)') WITH &&)
 WHERE(state IN ('reserved','confirmed'))
);
CREATE UNIQUE INDEX reservations_one_live_application ON public.reservations(application_id) WHERE state IN ('reserved','confirmed');
CREATE INDEX reservations_upcoming ON public.reservations(pickup_at,id);
CREATE TABLE public.reservation_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 action text NOT NULL, before_record jsonb, after_record jsonb NOT NULL
);
CREATE FUNCTION private.reservation_manager() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'reservation_requires_read_committed'; END IF;
 PERFORM pg_advisory_xact_lock(710026,2);
 RETURN actor;
END $$;
CREATE FUNCTION private.reservation_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='reservation_history' THEN RAISE EXCEPTION 'reservation_history_append_only'; END IF;
 -- Conversion temporarily retires its own hold, then installs the rental link atomically.
 IF NEW.state='converted' AND NEW.rental_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.reservation_history(reservation_id,actor_id,action,before_record,after_record)
 VALUES(NEW.id,auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'created' ELSE NEW.state END,CASE WHEN TG_OP='UPDATE' AND OLD.state='converted' AND OLD.rental_id IS NULL THEN (SELECT after_record FROM public.reservation_history WHERE reservation_id=NEW.id ORDER BY id DESC LIMIT 1) WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_audit AFTER INSERT OR UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION private.reservation_audit();
CREATE TRIGGER reservation_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.reservation_history FOR EACH STATEMENT EXECUTE FUNCTION private.reservation_audit();
CREATE FUNCTION private.reservation_conversion_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.reservations WHERE id=NEW.id AND state='converted' AND rental_id IS NULL) THEN RAISE EXCEPTION 'reservation_conversion_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reservation_conversion_complete AFTER INSERT OR UPDATE ON public.reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.reservation_conversion_complete();

CREATE FUNCTION public.reservation_configure(_market uuid,_timezone text,_turnaround integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM private.reservation_manager();
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=_timezone) THEN RAISE EXCEPTION 'invalid_timezone'; END IF;
 -- Existing holds keep their reviewed allowance; changes apply at the next staff edit.
 INSERT INTO public.reservation_market_rules VALUES(_market,_timezone,_turnaround)
 ON CONFLICT(market_id) DO UPDATE SET timezone=EXCLUDED.timezone,turnaround_minutes=EXCLUDED.turnaround_minutes;
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(auth.uid(),'admin','reservation.rules_changed','market',_market::text,'Reservation market rules changed',jsonb_build_object('timezone',_timezone,'turnaround_minutes',_turnaround));
END $$;
CREATE FUNCTION private.reservation_schedule(_application uuid,_vehicle uuid,_pickup timestamptz,_end timestamptz)
 RETURNS public.reservation_market_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rules public.reservation_market_rules; market uuid; local_pickup timestamp; local_end timestamp;
BEGIN
 IF _vehicle IS NULL THEN SELECT market_id INTO market FROM public.applications WHERE id=_application;
 ELSE SELECT market_id INTO market FROM public.vehicles WHERE id=_vehicle; END IF;
 SELECT * INTO rules FROM public.reservation_market_rules WHERE market_id=market;
 IF NOT FOUND THEN RAISE EXCEPTION 'market_scheduling_configuration_missing'; END IF;
 local_pickup:=_pickup AT TIME ZONE rules.timezone;local_end:=_end AT TIME ZONE rules.timezone;
 IF _pickup IS NULL OR _pickup<=clock_timestamp() OR NOT isfinite(_pickup) OR (_end IS NOT NULL AND NOT isfinite(_end))
 OR extract(second FROM local_pickup)<>0 OR extract(minute FROM local_pickup)::int%15<>0
 OR (_end IS NOT NULL AND (extract(second FROM local_end)<>0 OR extract(minute FROM local_end)::int%15<>0 OR local_end::date<=local_pickup::date OR _end<=_pickup))
 THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 RETURN rules;
END $$;
CREATE FUNCTION private.reservation_eligible(_application uuid,_vehicle uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.vehicles;
BEGIN
 PERFORM 1 FROM public.applications WHERE id=_application AND status='approved' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'applicant_not_approved'; END IF;
 SELECT * INTO v FROM public.vehicles WHERE id=_vehicle FOR UPDATE;
 IF NOT FOUND OR v.status NOT IN ('available','reserved') OR cardinality(private.vehicle_release_reasons(_vehicle))<>0 THEN RAISE EXCEPTION 'vehicle_not_ready'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inspections i WHERE i.vehicle_id=_vehicle AND i.inspection_type='pre_delivery' AND i.status='passed' AND i.completed_at<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM public.inspection_items x WHERE x.inspection_id=i.id)
 AND NOT EXISTS(SELECT 1 FROM public.inspection_items x WHERE x.inspection_id=i.id AND (x.result IS NULL OR x.result NOT IN ('pass','fail','na') OR (x.is_critical AND x.result='fail'))))
 THEN RAISE EXCEPTION 'pre_delivery_evidence_missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.rentals WHERE vehicle_id=_vehicle AND status='active') THEN RAISE EXCEPTION 'active_rental_conflict'; END IF;
END $$;
CREATE FUNCTION public.reservation_create(_application uuid,_vehicle uuid,_pickup timestamptz,_end timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; rules public.reservation_market_rules; rid uuid;
BEGIN
 actor:=private.reservation_manager();rules:=private.reservation_schedule(_application,_vehicle,_pickup,_end);
 INSERT INTO public.reservations(application_id,vehicle_id,pickup_at,timezone,agreed_end_at,turnaround_minutes,occupied_until,created_by,updated_by)
 VALUES(_application,_vehicle,_pickup,rules.timezone,_end,rules.turnaround_minutes,_end+make_interval(mins=>rules.turnaround_minutes),actor,actor) RETURNING id INTO rid;
 RETURN rid;
END $$;
CREATE FUNCTION public.reservation_change(_id uuid,_version bigint,_action text,_vehicle uuid DEFAULT NULL,_pickup timestamptz DEFAULT NULL,_end timestamptz DEFAULT NULL,_reason text DEFAULT NULL) RETURNS public.reservations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; r public.reservations; rules public.reservation_market_rules;
BEGIN
 actor:=private.reservation_manager();SELECT * INTO r FROM public.reservations WHERE id=_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 IF _version IS NULL OR r.version<>_version THEN RAISE EXCEPTION 'stale_version'; END IF;
 IF r.state IN ('cancelled','expired','converted') THEN RAISE EXCEPTION 'terminal_reservation'; END IF;
 IF _action='expire' THEN
  IF r.state<>'reserved' OR r.hold_expires_at>clock_timestamp() THEN RAISE EXCEPTION 'not_expirable'; END IF;
  r.state:='expired';r.reason:='Temporary hold expired';
 ELSIF _action='cancel' THEN
  IF length(btrim(coalesce(_reason,'')))<1 THEN RAISE EXCEPTION 'reason_required'; END IF;
  r.state:='cancelled';r.reason:=_reason;
 ELSE
  IF r.state='reserved' AND r.hold_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'hold_expired'; END IF;
  IF _action='edit' THEN
   -- Full replacement schedule, never coalesce omitted end into an invented end.
   IF _pickup IS NULL THEN RAISE EXCEPTION 'schedule_required'; END IF;
   rules:=private.reservation_schedule(r.application_id,_vehicle,_pickup,_end);
   r.vehicle_id:=_vehicle;r.pickup_at:=_pickup;r.agreed_end_at:=_end;r.timezone:=rules.timezone;
   r.turnaround_minutes:=rules.turnaround_minutes;r.occupied_until:=_end+make_interval(mins=>rules.turnaround_minutes);
   IF r.state='confirmed' THEN r.state:='reserved';r.hold_expires_at:=clock_timestamp()+interval '24 hours'; END IF;
  ELSIF _action='reserve' AND r.state='draft' THEN
   rules:=private.reservation_schedule(r.application_id,r.vehicle_id,r.pickup_at,r.agreed_end_at);
   r.timezone:=rules.timezone;r.turnaround_minutes:=rules.turnaround_minutes;r.occupied_until:=r.agreed_end_at+make_interval(mins=>rules.turnaround_minutes);
   IF r.pickup_at<=clock_timestamp() THEN RAISE EXCEPTION 'pickup_not_future'; END IF;
   r.state:='reserved';r.hold_expires_at:=clock_timestamp()+interval '24 hours';
  ELSIF _action='confirm' AND r.state='reserved' THEN r.state:='confirmed';r.hold_expires_at:=NULL;
  ELSE RAISE EXCEPTION 'invalid_transition'; END IF;
  IF r.state IN ('reserved','confirmed') THEN PERFORM private.reservation_eligible(r.application_id,r.vehicle_id); END IF;
 END IF;
 UPDATE public.reservations SET vehicle_id=r.vehicle_id,state=r.state,pickup_at=r.pickup_at,timezone=r.timezone,agreed_end_at=r.agreed_end_at,turnaround_minutes=r.turnaround_minutes,occupied_until=r.occupied_until,hold_expires_at=r.hold_expires_at,reason=r.reason,version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=_id RETURNING * INTO r;
 RETURN r;
END $$;

-- A currently active rental blocks new reservations regardless of planned return.
-- At activation, finite date-based terms conservatively block through the final day.
-- Conversion retires only its own hold before invoking the existing transaction.
CREATE FUNCTION private.reservation_activation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rules public.reservation_market_rules; occupied tstzrange;
BEGIN
 IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id OR OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.end_date IS DISTINCT FROM NEW.end_date) THEN
  IF EXISTS(SELECT 1 FROM public.reservations WHERE vehicle_id=NEW.vehicle_id AND state IN ('reserved','confirmed')) THEN
   SELECT m.* INTO rules FROM public.reservation_market_rules m JOIN public.vehicles v ON v.market_id=m.market_id WHERE v.id=NEW.vehicle_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'market_scheduling_configuration_missing'; END IF;
   -- Existing rentals have date precision: block through the whole final day plus turnaround.
   occupied:=tstzrange(NEW.start_date::timestamp AT TIME ZONE rules.timezone,
    ((NEW.end_date+1)::timestamp AT TIME ZONE rules.timezone)+make_interval(mins=>rules.turnaround_minutes),'[)');
   IF EXISTS(SELECT 1 FROM public.reservations WHERE vehicle_id=NEW.vehicle_id AND state IN ('reserved','confirmed')
    AND tstzrange(pickup_at,occupied_until,'[)') && occupied) THEN RAISE EXCEPTION 'reservation_allocation_conflict'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_activation_guard BEFORE INSERT OR UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION private.reservation_activation_guard();
CREATE FUNCTION public.reservation_convert(_id uuid,_version bigint,_weekly_rate numeric,_deposit numeric,_deposit_held boolean,_pickup_miles integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; r public.reservations; driver uuid; rental uuid;
BEGIN
 actor:=private.reservation_manager();SELECT * INTO r FROM public.reservations WHERE id=_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 -- Idempotent only for the current recorded version; stale requests never mutate.
 IF _version IS NULL OR r.version<>_version THEN RAISE EXCEPTION 'stale_version'; END IF;
 IF r.state='converted' THEN RETURN r.rental_id; END IF;
 IF r.state<>'confirmed' OR r.pickup_at>clock_timestamp() THEN RAISE EXCEPTION 'not_ready_for_conversion'; END IF;
 PERFORM private.reservation_eligible(r.application_id,r.vehicle_id);
 SELECT user_id INTO driver FROM public.applications WHERE id=r.application_id FOR UPDATE;
 IF driver IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=driver AND role='driver')
 OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=driver AND role IN ('admin','team','coordinator'))
 THEN RAISE EXCEPTION 'verified_driver_identity_required'; END IF;
 UPDATE public.reservations SET state='converted' WHERE id=_id;
 rental:=public.activate_rental_tx(r.application_id,r.vehicle_id,driver,_weekly_rate,_deposit,_deposit_held,
 (r.pickup_at AT TIME ZONE r.timezone)::date,(r.agreed_end_at AT TIME ZONE r.timezone)::date,_pickup_miles,actor);
 UPDATE public.reservations SET rental_id=rental,version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=_id;
 RETURN rental;
END $$;
-- Explicit operational projection; no joined identity, financial, payment or document data.
CREATE FUNCTION public.reservation_list(_after timestamptz DEFAULT '-infinity',_after_id uuid DEFAULT '00000000-0000-0000-0000-000000000000',_limit integer DEFAULT 50) RETURNS TABLE(id uuid,application_id uuid,vehicle_id uuid,state text,pickup_at timestamptz,timezone text,agreed_end_at timestamptz,hold_expires_at timestamptz,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('admin','team','coordinator')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN QUERY SELECT r.id,r.application_id,r.vehicle_id,r.state,r.pickup_at,r.timezone,r.agreed_end_at,r.hold_expires_at,r.version FROM public.reservations r WHERE (r.pickup_at,r.id)>(_after,_after_id) ORDER BY r.pickup_at,r.id LIMIT greatest(1,least(coalesce(_limit,50),100));
END $$;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_market_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservations,public.reservation_history,public.reservation_market_rules FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.reservation_history_id_seq FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.reservation_manager(),private.reservation_audit(),private.reservation_conversion_complete(),private.reservation_schedule(uuid,uuid,timestamptz,timestamptz),private.reservation_eligible(uuid,uuid),private.reservation_activation_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reservation_configure(uuid,text,integer),public.reservation_create(uuid,uuid,timestamptz,timestamptz),public.reservation_change(uuid,bigint,text,uuid,timestamptz,timestamptz,text),public.reservation_convert(uuid,bigint,numeric,numeric,boolean,integer),public.reservation_list(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reservation_configure(uuid,text,integer),public.reservation_create(uuid,uuid,timestamptz,timestamptz),public.reservation_change(uuid,bigint,text,uuid,timestamptz,timestamptz,text),public.reservation_convert(uuid,bigint,numeric,numeric,boolean,integer),public.reservation_list(timestamptz,uuid,integer) TO authenticated;
