-- REVIEW ONLY. Outside migration discovery; runner must apply atomically.
-- No migration number or journal entry allocated. Requires the current mileage-aware lifecycle.
DO $$ BEGIN
 IF to_regprocedure('public.end_rental_tx(uuid,date,text,integer,uuid)') IS NULL
 OR to_regprocedure('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)') IS NULL
 OR to_regprocedure('public.vehicle_rental_ready_missing(uuid)') IS NULL
 THEN RAISE EXCEPTION 'safe_release_prerequisites_missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('stripe_link','stripe_claim_creation','stripe_finish_creation','stripe_cancel_state','stripe_ingest')
 AND position('pg_advisory_xact_lock(710026,2)' IN pg_get_functiondef(p.oid))=0)
 THEN RAISE EXCEPTION 'safe_release_stripe_lock_upgrade_required'; END IF;
END $$;

-- One lock order before row locks, including evidence writes and assignments.
-- Deliberately fleet-wide for a small fleet; no network I/O occurs under this lock.
CREATE FUNCTION private.lock_vehicle_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'safe_release_requires_read_committed'; END IF;
 PERFORM pg_advisory_xact_lock(710026,2);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.lock_vehicle_release() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.vehicles FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.rentals FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.inspections FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.inspection_items FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.incidents FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();
CREATE TRIGGER safe_release_lock BEFORE INSERT OR UPDATE OR DELETE ON public.maintenance_records FOR EACH STATEMENT EXECUTE FUNCTION private.lock_vehicle_release();

CREATE FUNCTION private.vehicle_release_reasons(_vehicle uuid,_rental uuid DEFAULT NULL) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reasons text[]:='{}'; v public.vehicles; i public.inspections; rid uuid;
BEGIN
 SELECT * INTO v FROM public.vehicles WHERE id=_vehicle;
 IF NOT FOUND THEN RETURN ARRAY['Vehicle unavailable']; END IF;
 IF v.archived_at IS NOT NULL OR v.status IN ('archived','sold','retired') THEN reasons:=array_append(reasons,'Vehicle archived or retired'); END IF;
 IF coalesce(cardinality(public.vehicle_rental_ready_missing(_vehicle)),1)>0 THEN reasons:=array_append(reasons,'Rental Ready profile incomplete'); END IF;
 rid:=_rental;
 IF rid IS NULL THEN
  SELECT id INTO rid FROM public.rentals WHERE vehicle_id=_vehicle AND status='closed' ORDER BY created_at DESC,id DESC LIMIT 1;
 END IF;
 IF rid IS NOT NULL THEN
  SELECT * INTO i FROM public.inspections WHERE rental_id=rid AND vehicle_id=_vehicle AND inspection_type='return' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR i.status IS DISTINCT FROM 'passed' OR i.completed_at IS NULL OR i.completed_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM public.inspection_items WHERE inspection_id=i.id)
   OR EXISTS(SELECT 1 FROM public.inspection_items WHERE inspection_id=i.id AND (result IS NULL OR result NOT IN ('pass','fail','na') OR (is_critical AND result='fail')))
  THEN reasons:=array_append(reasons,'Return inspection missing, incomplete or failed'); END IF;
 END IF;
 -- No existing repair record identifies and verifies resolution of a specific finding.
 -- Neither a new draft nor a later passed inspection is proof of that resolution.
 IF EXISTS(SELECT 1 FROM public.inspections h WHERE h.vehicle_id=_vehicle AND
  (h.status='failed' OR EXISTS(SELECT 1 FROM public.inspection_items x WHERE x.inspection_id=h.id AND x.is_critical AND x.result='fail')))
 THEN reasons:=array_append(reasons,'Historical inspection failure requires verified resolution; clearance workflow unavailable'); END IF;
 IF EXISTS(SELECT 1 FROM public.incidents WHERE vehicle_id=_vehicle AND status IS DISTINCT FROM 'closed') THEN reasons:=array_append(reasons,'Unresolved incident or damage'); END IF;
 IF EXISTS(SELECT 1 FROM public.maintenance_records WHERE vehicle_id=_vehicle AND status IS DISTINCT FROM 'completed'
  AND (status='upcoming' AND due_date>CURRENT_DATE AND (due_mileage IS NULL OR due_mileage>coalesce(v.current_odometer,0))) IS NOT TRUE)
 THEN reasons:=array_append(reasons,'Unresolved or due maintenance'); END IF;
 RETURN reasons;
END $$;
REVOKE ALL ON FUNCTION private.vehicle_release_reasons(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Covers manual status writes, direct activation RPCs and attempts to override a hold.
CREATE FUNCTION private.guard_safe_vehicle_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reasons text[]; vs text;
BEGIN
 IF TG_TABLE_NAME='rentals' THEN
  IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id) THEN
   SELECT status INTO vs FROM public.vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
   IF vs IS NULL OR vs NOT IN ('available','reserved') THEN RAISE EXCEPTION 'vehicle_safety_hold'; END IF;
   reasons:=private.vehicle_release_reasons(NEW.vehicle_id);
  END IF;
 ELSE
  IF NEW.status IN ('available','reserved') AND TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN reasons:=private.vehicle_release_reasons(NEW.id); END IF;
 END IF;
 IF cardinality(reasons)>0 THEN RAISE EXCEPTION 'vehicle_safety_hold:%',array_to_string(reasons,'; '); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_safe_vehicle_release() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER safe_release_guard BEFORE INSERT OR UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION private.guard_safe_vehicle_release();
CREATE TRIGGER safe_release_guard BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.guard_safe_vehicle_release();

-- Preserve completed safety evidence while allowing non-safety notes/signatures.
CREATE FUNCTION private.preserve_inspection_safety() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE locked boolean;
BEGIN
 IF TG_TABLE_NAME='inspections' THEN
  locked:=OLD.completed_at IS NOT NULL OR OLD.status IN ('passed','failed');
  IF locked AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['updated_at','notes','exterior_notes','interior_notes','driver_signature_name','driver_signed_at','driver_notes','driver_user_id','driver_signature_ip','driver_signature_user_agent','signature_requested_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['updated_at','notes','exterior_notes','interior_notes','driver_signature_name','driver_signed_at','driver_notes','driver_user_id','driver_signature_ip','driver_signature_user_agent','signature_requested_at']))
  THEN RAISE EXCEPTION 'completed_inspection_safety_immutable'; END IF;
 ELSE
  SELECT completed_at IS NOT NULL OR status IN ('passed','failed') INTO locked FROM public.inspections WHERE id=OLD.inspection_id;
  IF locked AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['updated_at','notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','notes']))
  THEN RAISE EXCEPTION 'completed_inspection_safety_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.preserve_inspection_safety() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER safe_release_history BEFORE UPDATE OR DELETE ON public.inspections FOR EACH ROW EXECUTE FUNCTION private.preserve_inspection_safety();
CREATE TRIGGER safe_release_history BEFORE UPDATE OR DELETE ON public.inspection_items FOR EACH ROW EXECUTE FUNCTION private.preserve_inspection_safety();

-- Existing five-argument identity retained; replaced compatibly below, never dropped.
CREATE FUNCTION public.end_rental_safe_v1(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL, _release_contract text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_pick integer; v_hist integer; v_read uuid; reasons text[]; destination text; role_name text;
BEGIN
  IF _release_contract IS DISTINCT FROM 'safe-release-v1' THEN RAISE EXCEPTION 'safe_release_client_required'; END IF;
  SELECT role::text INTO role_name FROM public.user_roles WHERE user_id=_actor AND role IN ('admin','team') ORDER BY role LIMIT 1;
  IF role_name IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'safe_release_requires_read_committed'; END IF;
  PERFORM pg_advisory_xact_lock(710026,2);
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _vehicle_status IS NULL OR _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN PERFORM set_config('app.rental_tx', 'off', true); RETURN jsonb_build_object('contract','safe-release-v1','alreadyClosed',true); END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  reasons:=private.vehicle_release_reasons(r.vehicle_id,_rental_id);
  IF _vehicle_status='maintenance' THEN reasons:=array_append(reasons,'Staff requested maintenance'); END IF;
  destination:=CASE WHEN cardinality(reasons)=0 THEN 'available' ELSE 'maintenance' END;
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
  END IF;
  UPDATE public.rentals SET status = 'closed', end_date = _end,
    return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
  UPDATE public.vehicles SET status = destination WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.applications SET status = 'closed' WHERE id = r.application_id;
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  INSERT INTO public.audit_log(actor_user_id,actor_role,action,entity_type,entity_id,summary,metadata)
   VALUES(_actor,role_name,'rental.ended','rental',_rental_id::text,'Rental closed with verified vehicle disposition',jsonb_build_object('vehicle_id',r.vehicle_id,'driver_id',r.driver_id,'vehicle_status',destination,'release_reasons',reasons,'billing','unchanged_unverified'));
  RETURN jsonb_build_object('contract','safe-release-v1','alreadyClosed',false,'vehicleStatus',destination,'releaseReasons',reasons,'billing','unchanged_unverified');
END $function$;
REVOKE ALL ON FUNCTION public.end_rental_safe_v1(uuid, date, text, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_rental_safe_v1(uuid, date, text, integer, uuid, text) TO service_role;


-- New adverse evidence also withdraws an idle vehicle from rentable inventory.
-- Clearing evidence never automatically makes a held vehicle Available.
CREATE FUNCTION private.hold_vehicle_on_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[]; vid uuid; before_row jsonb; after_row jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='inspection_items' THEN
  SELECT array_agg(DISTINCT vehicle_id) INTO ids FROM public.inspections WHERE id IN ((before_row->>'inspection_id')::uuid,(after_row->>'inspection_id')::uuid);
 ELSE ids:=ARRAY[(before_row->>'vehicle_id')::uuid,(after_row->>'vehicle_id')::uuid]; END IF;
 FOREACH vid IN ARRAY coalesce(ids,'{}'::uuid[]) LOOP
  IF vid IS NOT NULL AND cardinality(private.vehicle_release_reasons(vid))>0 THEN
   UPDATE public.vehicles SET status='maintenance' WHERE id=vid AND status IN ('available','reserved');
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.hold_vehicle_on_evidence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER safe_release_evidence AFTER INSERT OR UPDATE OR DELETE ON public.inspections FOR EACH ROW EXECUTE FUNCTION private.hold_vehicle_on_evidence();
CREATE TRIGGER safe_release_evidence AFTER INSERT OR UPDATE OR DELETE ON public.inspection_items FOR EACH ROW EXECUTE FUNCTION private.hold_vehicle_on_evidence();
CREATE TRIGGER safe_release_evidence AFTER INSERT OR UPDATE OR DELETE ON public.incidents FOR EACH ROW EXECUTE FUNCTION private.hold_vehicle_on_evidence();
CREATE TRIGGER safe_release_evidence AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_records FOR EACH ROW EXECUTE FUNCTION private.hold_vehicle_on_evidence();

-- Same activation transaction, with the shared lock acquired before application/vehicle row locks.
CREATE OR REPLACE FUNCTION public.activate_rental_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid, _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date, _pickup_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_app record; v_veh record; v_rental uuid; v_missing text[]; v_hist integer; v_read uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'safe_release_requires_read_committed'; END IF;
  PERFORM pg_advisory_xact_lock(710026,2);
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _end IS NOT NULL AND _end <= _start THEN RAISE EXCEPTION 'invalid_dates'; END IF;
  IF _weekly_rate IS NULL OR _weekly_rate <= 0 THEN RAISE EXCEPTION 'no_weekly_rate'; END IF;
  IF _pickup_miles IS NOT NULL AND (_pickup_miles < 0 OR _pickup_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, status, user_id INTO v_app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.status NOT IN ('approved','active') THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF v_app.user_id IS DISTINCT FROM _driver_id THEN RAISE EXCEPTION 'account_conflict'; END IF;
  SELECT id, status, archived_at INTO v_veh FROM public.vehicles WHERE id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  IF v_veh.archived_at IS NOT NULL OR v_veh.status IN ('archived','sold','retired') THEN RAISE EXCEPTION 'vehicle_unavailable'; END IF;
  v_missing := public.vehicle_rental_ready_missing(_vehicle_id);
  IF array_length(v_missing,1) > 0 THEN RAISE EXCEPTION 'vehicle_not_rental_ready:%', array_to_string(v_missing, ','); END IF;
  IF EXISTS (SELECT 1 FROM public.rentals WHERE vehicle_id = _vehicle_id AND status = 'active') THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF EXISTS (SELECT 1 FROM public.rentals WHERE driver_id = _driver_id AND status = 'active') THEN RAISE EXCEPTION 'already_active'; END IF;
  IF _pickup_miles IS NOT NULL THEN
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = _vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _pickup_miles + 500 < v_hist THEN RAISE EXCEPTION 'pickup_below_history:%', v_hist; END IF;
  END IF;
  INSERT INTO public.rentals (driver_id, vehicle_id, application_id, start_date, end_date, status,
    weekly_rate, deposit_amount, deposit_held, next_payment_due)
  VALUES (_driver_id, _vehicle_id, _application_id, _start, _end, 'active',
    _weekly_rate, COALESCE(_deposit, 0), COALESCE(_deposit_held, false), _start)
  RETURNING id INTO v_rental;
  IF _pickup_miles IS NOT NULL THEN
    v_read := private.rental_mileage_reading(_vehicle_id, v_rental, _driver_id, _pickup_miles, 'rental_checkout', 'pre_delivery', _actor);
    UPDATE public.rentals SET pickup_reading_id = v_read WHERE id = v_rental;
  END IF;
  UPDATE public.vehicles SET status = 'rented' WHERE id = _vehicle_id;
  UPDATE public.applications SET status = 'active', vehicle_id = _vehicle_id WHERE id = _application_id;
  UPDATE public.agreements SET rental_id = v_rental WHERE application_id = _application_id AND rental_id IS NULL;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN v_rental;
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM LIKE '%rentals_one_active_per_vehicle_idx%' THEN RAISE EXCEPTION 'vehicle_busy'; END IF;
  IF SQLERRM LIKE '%rentals_one_active_per_driver_idx%' THEN RAISE EXCEPTION 'already_active'; END IF;
  RAISE;
END $function$;
REVOKE ALL ON FUNCTION public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rental_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid) TO service_role;

-- Keep exact deployed identity, return type, argument names/defaults and existing ACL.
-- No retry, no inferred operation UUID or assignment timestamp.
CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text,
 _return_miles integer DEFAULT NULL, _actor uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE outcome jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'safe_release_requires_read_committed'; END IF;
 PERFORM pg_advisory_xact_lock(710026,2);
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('admin','team')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 -- Table is installed in this same atomic manifest before any caller can observe it.
 IF EXISTS(SELECT 1 FROM public.booking_vehicle_assignments WHERE rental_id=_rental_id) THEN RAISE EXCEPTION 'versioned_closeout_required' USING ERRCODE='42501'; END IF;
 outcome:=public.end_rental_safe_v1(_rental_id,_end,_vehicle_status,_return_miles,_actor,'safe-release-v1');
 IF outcome->>'contract' IS DISTINCT FROM 'safe-release-v1' OR jsonb_typeof(outcome->'alreadyClosed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'unexpected_lifecycle_result'; END IF;
 RETURN CASE WHEN (outcome->>'alreadyClosed')::boolean THEN 'already_closed' ELSE 'closed' END;
END $$;
