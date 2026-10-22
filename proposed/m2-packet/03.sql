-- LOCAL REVIEW PROPOSAL ONLY. Outside migration discovery. Prerequisites documented in REVIEW.
-- Existing approval_actor/lock/validate are reused; their provider adapters remain deny-by-default.
CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
-- INSTALLER ONLY: required by PostgreSQL non-superuser ownership transfers.
-- ALTER ... OWNER TO requires the new owner to hold CREATE on the object's schema.
-- This step moves public.booking_vehicle_assignments and public.record_existing_rental_tx
-- to rr_record_executor. Later steps move more objects, so CREATE stays until
-- 21-revoke-executor-create.sql, which runs after every ownership transfer.
-- The preflight row "public CREATE holders" lists who already holds CREATE on public.
GRANT rr_record_executor TO postgres WITH SET TRUE;
GRANT CREATE ON SCHEMA private, public TO rr_record_executor;
CREATE SEQUENCE private.record_customer_number_seq AS bigint MINVALUE 1 NO CYCLE;
CREATE SEQUENCE private.record_booking_number_seq AS bigint MINVALUE 1 NO CYCLE;
CREATE TABLE private.record_customers (
 application_id uuid PRIMARY KEY REFERENCES public.applications(id) ON DELETE RESTRICT,
 customer_number bigint NOT NULL UNIQUE DEFAULT nextval('private.record_customer_number_seq'));
CREATE TABLE private.record_operations (
 operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
 request jsonb NOT NULL, rental_id uuid NOT NULL UNIQUE REFERENCES public.rentals(id) ON DELETE RESTRICT,
 customer_number bigint NOT NULL, booking_number bigint NOT NULL UNIQUE DEFAULT nextval('private.record_booking_number_seq'),
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.booking_vehicle_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE RESTRICT,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
 assignment_start timestamptz NOT NULL CHECK(isfinite(assignment_start)), pickup_mileage integer CHECK(pickup_mileage BETWEEN 0 AND 2000000),
 assignment_kind text NOT NULL CHECK(assignment_kind IN ('original','replacement')),
 actor_id uuid NOT NULL, operation_id uuid NOT NULL REFERENCES private.record_operations(operation_id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(rental_id,assignment_start));
CREATE UNIQUE INDEX record_one_original ON public.booking_vehicle_assignments(rental_id) WHERE assignment_kind='original';
-- Immutable starts; an immutable closure event supplies the end, never overwrites the start.
CREATE TABLE private.assignment_closures (
 assignment_id uuid PRIMARY KEY REFERENCES public.booking_vehicle_assignments(id) ON DELETE RESTRICT,
 assignment_end timestamptz NOT NULL CHECK(isfinite(assignment_end)), return_mileage integer CHECK(return_mileage BETWEEN 0 AND 2000000),
 actor_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE, reason text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE private.record_subscription_links (
 account_id text NOT NULL, environment text NOT NULL CHECK(environment IN ('live','sandbox')),
 subscription_id text NOT NULL, customer_id text NOT NULL,
 rental_id uuid NOT NULL UNIQUE REFERENCES public.rentals(id) ON DELETE RESTRICT,
 evidence_id uuid NOT NULL, PRIMARY KEY(account_id,environment,subscription_id));
CREATE FUNCTION private.record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'record_history_immutable' USING ERRCODE='42501'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['private.record_customers','private.record_operations','public.booking_vehicle_assignments','private.assignment_closures','private.record_subscription_links'] LOOP
 EXECUTE format('CREATE TRIGGER record_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable()',t);
 EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('ALTER TABLE %s OWNER TO rr_record_executor',t);
 END LOOP;
END $$;
ALTER SEQUENCE private.record_customer_number_seq OWNER TO rr_record_executor;
ALTER SEQUENCE private.record_booking_number_seq OWNER TO rr_record_executor;
-- New boundary adapters intentionally unavailable. NO user/browser-supplied attestation accepted.
-- agreement adapter must lock and verify exact document versions, same application/vehicle,
-- effective terms/start; and reject any unrelated unlinked agreement the legacy activator would link.
CREATE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) RETURNS uuid
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501'; END $$;
-- Optional opaque reference to server-verified existing subscription evidence. Must lock evidence,
-- bind application, account/environment, customer, weekly amount/currency and validity; no provider I/O.
CREATE FUNCTION private.record_subscription_evidence(uuid,uuid,numeric) RETURNS jsonb
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'subscription_contract_unverified' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric),private.record_subscription_evidence(uuid,uuid,numeric),private.record_immutable() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric),private.record_subscription_evidence(uuid,uuid,numeric),private.record_immutable() TO rr_record_executor;

CREATE FUNCTION public.record_existing_rental_tx(
 _operation_id uuid, _application_id uuid, _vehicle_id uuid, _started_at timestamptz,
 _weekly_rate numeric, _deposit numeric, _pickup_miles integer, _subscription_evidence_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid; actor_after uuid; req jsonb; op private.record_operations%ROWTYPE;
 app record; veh record; rid uuid; cn bigint; assignment uuid; identity_id uuid; agreement_id uuid; sub jsonb; reading_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required';END IF;
 actor:=private.approval_actor();
 IF _operation_id IS NULL OR _application_id IS NULL OR _vehicle_id IS NULL OR _started_at IS NULL
 OR NOT isfinite(_started_at) OR _started_at>statement_timestamp() OR _weekly_rate IS NULL OR _weekly_rate<=0 OR _weekly_rate>100000
 OR _weekly_rate<>round(_weekly_rate,2) OR (_deposit IS NOT NULL AND (_deposit<0 OR _deposit>100000 OR _deposit<>round(_deposit,2)))
 OR (_pickup_miles IS NOT NULL AND (_pickup_miles<0 OR _pickup_miles>2000000))
 OR length(btrim(coalesce(_reason,'')))<5 OR length(_reason)>500 THEN RAISE EXCEPTION 'invalid_record_request';END IF;
 req:=jsonb_build_object('application',_application_id,'vehicle',_vehicle_id,'start_epoch',extract(epoch FROM _started_at),'weekly_rate',_weekly_rate,'deposit',_deposit,'mileage',_pickup_miles,'subscription_evidence',_subscription_evidence_id,'reason',_reason);
 -- Existing approval serialization comes FIRST, then existing lifecycle allocation lock.
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 PERFORM 1 FROM public.applications WHERE id=_application_id FOR UPDATE NOWAIT;
 -- Hold current role membership against revocation through transaction completion.
 actor_after:=private.approval_actor();
 IF actor_after IS DISTINCT FROM actor THEN RAISE EXCEPTION 'actor_changed' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501';END IF;
 SELECT * INTO op FROM private.record_operations WHERE operation_id=_operation_id;
 IF FOUND THEN
  IF op.actor_id IS DISTINCT FROM actor OR op.application_id IS DISTINCT FROM _application_id OR op.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'operation_conflict' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('status','recorded','rentalId',op.rental_id,'customerNumber',op.customer_number,'bookingNumber',op.booking_number,'recovered',true,'billing','unchanged','paymentsImported',0);
 END IF;
 SELECT id,user_id,status,deleted_at INTO app FROM public.applications WHERE id=_application_id;
 IF NOT FOUND OR app.deleted_at IS NOT NULL OR app.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'application_unavailable';END IF;
 -- Existing activation schema requires a linked login. Do not relax NOT NULL silently.
 IF app.user_id IS NULL THEN RAISE EXCEPTION 'driver_account_contract_required';END IF;
 identity_id:=private.approval_validate(_application_id);
 IF identity_id IS NULL THEN RAISE EXCEPTION 'positive_identity_required';END IF;
 SELECT id,status,archived_at INTO veh FROM public.vehicles WHERE id=_vehicle_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR veh.archived_at IS NOT NULL OR veh.status IS DISTINCT FROM 'available' THEN RAISE EXCEPTION 'vehicle_unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.rentals WHERE status='active' AND (application_id=_application_id OR driver_id=app.user_id OR vehicle_id=_vehicle_id)) THEN RAISE EXCEPTION 'allocation_conflict';END IF;
 IF EXISTS(SELECT 1 FROM public.rentals WHERE application_id=_application_id AND vehicle_id=_vehicle_id AND start_date=(_started_at AT TIME ZONE 'America/New_York')::date) THEN RAISE EXCEPTION 'duplicate_rental';END IF;
 -- A date-only closed legacy interval is certainly disjoint only when its end
 -- precedes the requested local start date. Same-day uncertainty fails closed.
 IF EXISTS(SELECT 1 FROM public.rentals l
 WHERE (l.vehicle_id IS NULL OR l.vehicle_id=_vehicle_id OR l.application_id=_application_id OR l.driver_id=app.user_id)
 AND NOT EXISTS(SELECT 1 FROM public.booking_vehicle_assignments a WHERE a.rental_id=l.id)
 AND (l.status IS DISTINCT FROM 'closed' OR l.start_date IS NULL OR l.end_date IS NULL
 OR NOT isfinite(l.start_date) OR NOT isfinite(l.end_date) OR l.end_date<l.start_date
 OR l.end_date>=(_started_at AT TIME ZONE 'America/New_York')::date))
 THEN RAISE EXCEPTION 'legacy_occupancy_unresolved';END IF;
 agreement_id:=private.record_agreement_evidence(_application_id,_vehicle_id,_started_at,_weekly_rate);
 IF agreement_id IS NULL THEN RAISE EXCEPTION 'agreement_required';END IF;
 IF _subscription_evidence_id IS NOT NULL THEN
  sub:=private.record_subscription_evidence(_subscription_evidence_id,_application_id,_weekly_rate);
  IF sub IS NULL OR (sub ?& ARRAY['account','environment','customer','subscription','next_due']) IS NOT TRUE
  OR nullif(sub->>'account','') IS NULL OR sub->>'environment' NOT IN ('live','sandbox')
  OR coalesce(sub->>'customer','') !~ '^cus_[A-Za-z0-9]+$' OR coalesce(sub->>'subscription','') !~ '^sub_[A-Za-z0-9]+$'
  OR sub->>'environment' IS NULL THEN RAISE EXCEPTION 'subscription_evidence_invalid';END IF;
 END IF;
 -- Reuse actual activation, including lifecycle guards, readiness, mileage and derived statuses.
 IF _pickup_miles IS NOT NULL AND EXISTS(SELECT 1 FROM public.odometer_readings WHERE vehicle_id=_vehicle_id AND status='valid' AND observed_on<=(_started_at AT TIME ZONE 'America/New_York')::date AND mileage>_pickup_miles+500) THEN RAISE EXCEPTION 'pickup_below_history';END IF;
 rid:=public.activate_rental_tx(_application_id,_vehicle_id,app.user_id,_weekly_rate,_deposit,_deposit>0,(_started_at AT TIME ZONE 'America/New_York')::date,NULL,NULL,actor);
 IF _pickup_miles IS NOT NULL THEN
 INSERT INTO public.odometer_readings(vehicle_id,mileage,observed_on,observed_at,source_type,source_id,evidence_key,entered_by,rental_id,driver_id)
 VALUES(_vehicle_id,_pickup_miles,(_started_at AT TIME ZONE 'America/New_York')::date,_started_at,'rental_checkout',rid,'rental_checkout:'||rid,actor,rid,app.user_id) RETURNING id INTO reading_id;
 UPDATE public.rentals SET pickup_reading_id=reading_id WHERE id=rid;
 END IF;
 -- Preserve unknown (NULL) instead of the legacy activator's COALESCE-to-zero.
 -- Requires nullable monetary columns; no lifecycle status writes occur here.
 UPDATE public.rentals SET deposit_amount=_deposit,deposit_held=CASE WHEN _deposit IS NULL THEN NULL ELSE _deposit>0 END,
 next_payment_due=CASE WHEN sub IS NULL THEN NULL ELSE (sub->>'next_due')::date END,
 stripe_customer_id=sub->>'customer',stripe_subscription_id=sub->>'subscription'
 WHERE id=rid;
 INSERT INTO private.record_customers(application_id) VALUES(_application_id) ON CONFLICT(application_id) DO NOTHING;
 SELECT customer_number INTO cn FROM private.record_customers WHERE application_id=_application_id;
 INSERT INTO private.record_operations(operation_id,actor_id,application_id,request,rental_id,customer_number)
 VALUES(_operation_id,actor,_application_id,req,rid,cn) RETURNING * INTO op;
 INSERT INTO public.booking_vehicle_assignments(rental_id,vehicle_id,assignment_start,pickup_mileage,assignment_kind,actor_id,operation_id)
 VALUES(rid,_vehicle_id,_started_at,_pickup_miles,'original',actor,_operation_id) RETURNING id INTO assignment;
 IF sub IS NOT NULL THEN
 INSERT INTO private.record_subscription_links VALUES(sub->>'account',sub->>'environment',sub->>'subscription',sub->>'customer',rid,_subscription_evidence_id);
 END IF;
 INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
 VALUES(actor,(SELECT string_agg(role::text,',' ORDER BY role::text) FROM public.user_roles WHERE user_id=actor),'rental.recorded_existing','rental',rid::text,'Existing rental recorded; billing unchanged',jsonb_build_object('operation',_operation_id,'assignment',assignment,'identity_review',identity_id,'agreement_evidence',agreement_id,'deposit_known',_deposit IS NOT NULL,'payments_imported',0,'reason',_reason));
 RETURN jsonb_build_object('status','recorded','rentalId',rid,'customerNumber',cn,'bookingNumber',op.booking_number,'recovered',false,'billing','unchanged','paymentsImported',0);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'record_contention_retry_whole_transaction' USING ERRCODE='40001';
END $$;
ALTER FUNCTION public.record_existing_rental_tx(uuid,uuid,uuid,timestamptz,numeric,numeric,integer,uuid,text) OWNER TO rr_record_executor;
-- No application JWT client calls this signature. src records through
-- public.record_existing_rental_evidence_v1, which checks the evidence token,
-- expiry, snapshot freshness, and the authoritative document before the
-- executor-owned core runs. Leaving EXECUTE for authenticated would let a
-- manager call this function and skip those checks. anon, PUBLIC,
-- authenticated, and service_role do not have it. The definer runs as
-- rr_record_executor, and step 0 revoked PUBLIC on approval_validate, so the
-- executor needs that one validator explicitly. The private record helpers
-- stay executor-only.
REVOKE ALL ON FUNCTION public.record_existing_rental_tx(uuid,uuid,uuid,timestamptz,numeric,numeric,integer,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.approval_validate(uuid) TO rr_record_executor;
-- Privileges for existing tables/helpers MUST be mapped to effective installed RLS/ownership.
-- This proposal deliberately does not install permissive policies or modify existing owners.

-- All future assignment writers must take the SAME lifecycle allocation lock before rows.
-- Enforce interval integrity in the database, not only in a future Swap UI.
CREATE FUNCTION private.record_assignment_interval_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.booking_vehicle_assignments%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'assignment_contention' USING ERRCODE='40001';END IF;
 IF TG_TABLE_NAME='assignment_closures' THEN
  SELECT * INTO a FROM public.booking_vehicle_assignments WHERE id=NEW.assignment_id;
  IF NOT FOUND OR NEW.assignment_end<=a.assignment_start OR (NEW.return_mileage IS NOT NULL AND a.pickup_mileage IS NOT NULL AND NEW.return_mileage<a.pickup_mileage) THEN RAISE EXCEPTION 'invalid_assignment_close';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.rentals l WHERE l.id<>NEW.rental_id AND (l.vehicle_id IS NULL OR l.vehicle_id=NEW.vehicle_id)
   AND NOT EXISTS(SELECT 1 FROM public.booking_vehicle_assignments h WHERE h.rental_id=l.id)
   AND (l.status IS DISTINCT FROM 'closed' OR l.start_date IS NULL OR l.end_date IS NULL
    OR NOT isfinite(l.start_date) OR NOT isfinite(l.end_date) OR l.end_date<l.start_date
    OR l.end_date>=(NEW.assignment_start AT TIME ZONE 'America/New_York')::date))
   THEN RAISE EXCEPTION 'legacy_occupancy_unresolved';END IF;
  IF EXISTS(SELECT 1 FROM public.booking_vehicle_assignments s LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
   WHERE (s.rental_id=NEW.rental_id OR s.vehicle_id=NEW.vehicle_id)
     AND tstzrange(s.assignment_start,c.assignment_end,'[)') && tstzrange(NEW.assignment_start,NULL,'[)')) THEN RAISE EXCEPTION 'assignment_overlap';END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION private.record_assignment_interval_guard() OWNER TO rr_record_executor;
REVOKE ALL ON FUNCTION private.record_assignment_interval_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER assignment_interval BEFORE INSERT ON public.booking_vehicle_assignments FOR EACH ROW EXECUTE FUNCTION private.record_assignment_interval_guard();
CREATE TRIGGER assignment_close_interval BEFORE INSERT ON private.assignment_closures FOR EACH ROW EXECUTE FUNCTION private.record_assignment_interval_guard();
CREATE VIEW private.record_assignment_history AS
SELECT a.*,c.assignment_end,c.return_mileage,c.actor_id AS closing_actor_id,c.event_id AS closing_event_id,c.reason AS closing_reason
FROM public.booking_vehicle_assignments a LEFT JOIN private.assignment_closures c ON c.assignment_id=a.id;
REVOKE ALL ON private.record_assignment_history FROM PUBLIC,anon,authenticated,service_role;
-- Narrow record-audit retention guard. No disabling or replacement of existing audit guards.
CREATE FUNCTION private.record_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'record_audit_retained';END IF;
 IF OLD.action IN ('rental.recorded_existing','rental.closed_recorded_v2') THEN RAISE EXCEPTION 'record_audit_immutable';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.record_audit_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER record_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION private.record_audit_guard();
CREATE TRIGGER record_audit_no_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION private.record_audit_guard();

-- Narrow access for the preserved postgres-owned legacy rejection guard.
GRANT SELECT (rental_id) ON public.booking_vehicle_assignments TO postgres;
