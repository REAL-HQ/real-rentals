-- REVIEW ONLY: after PR39 and interface read package, in one provider transaction.
-- No journal entry or automatic discovery. Existing activation remains the sole rental writer.
DO $$ BEGIN
 IF to_regprocedure('public.reservation_convert(uuid,bigint,numeric,numeric,boolean,integer)') IS NULL
 OR to_regprocedure('public.reservation_interface_list(text,timestamptz,uuid)') IS NULL
 THEN RAISE EXCEPTION 'reservation_conversion_prerequisites_missing'; END IF;
END $$;
CREATE FUNCTION private.reservation_verified_driver(_application uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.applications; u auth.users;
BEGIN
 SELECT * INTO a FROM public.applications WHERE id=_application;
 SELECT * INTO u FROM auth.users WHERE id=a.user_id;
 IF a.user_id IS NULL OR u.id IS NULL OR nullif(btrim(a.email),'') IS NULL
 OR lower(btrim(a.email)) IS DISTINCT FROM lower(btrim(u.email))
 OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=a.user_id AND role='driver')
 OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=a.user_id AND role IN ('admin','team','coordinator'))
 THEN RAISE EXCEPTION 'verified_driver_identity_required'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.reservation_verified_driver(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reservation_convert(_id uuid,_version bigint,_weekly_rate numeric,_deposit numeric,_deposit_held boolean,_pickup_miles integer DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; r public.reservations; driver uuid; rental uuid;
BEGIN
 actor:=private.reservation_manager();SELECT * INTO r FROM public.reservations WHERE id=_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 -- Idempotent only for the current recorded version; stale requests never mutate.
 IF _version IS NULL OR r.version<>_version THEN RAISE EXCEPTION 'stale_version'; END IF;
 IF r.state='converted' THEN RETURN r.rental_id; END IF;
 IF _weekly_rate IS NULL OR _weekly_rate<=0 OR _weekly_rate>100000 OR _deposit IS NULL OR _deposit<0 OR _deposit>100000 THEN RAISE EXCEPTION 'invalid_terms'; END IF;
 IF r.state<>'confirmed' OR r.pickup_at>clock_timestamp() THEN RAISE EXCEPTION 'not_ready_for_conversion'; END IF;
 PERFORM private.reservation_eligible(r.application_id,r.vehicle_id);
 SELECT user_id INTO driver FROM public.applications WHERE id=r.application_id FOR UPDATE;
 IF driver IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=driver AND role='driver')
 OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=driver AND role IN ('admin','team','coordinator'))
 THEN RAISE EXCEPTION 'verified_driver_identity_required'; END IF;
 PERFORM private.reservation_verified_driver(r.application_id);
 UPDATE public.reservations SET state='converted' WHERE id=_id;
 rental:=public.activate_rental_tx(r.application_id,r.vehicle_id,driver,_weekly_rate,_deposit,_deposit_held,
 (r.pickup_at AT TIME ZONE r.timezone)::date,(r.agreed_end_at AT TIME ZONE r.timezone)::date,_pickup_miles,actor);
 UPDATE public.reservations SET rental_id=rental,version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=_id;
 RETURN rental;
END $$;

CREATE FUNCTION public.reservation_conversion_preview(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.reservations; blockers text[]:='{}'; missing text; signed boolean;
BEGIN
 PERFORM private.reservation_manager();
 SELECT * INTO r FROM public.reservations WHERE id=_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
 IF r.state<>'confirmed' THEN blockers:=array_append(blockers,'Reservation is not Confirmed.'); END IF;
 IF r.pickup_at>clock_timestamp() THEN blockers:=array_append(blockers,'Scheduled pickup has not arrived.'); END IF;
 BEGIN
  PERFORM private.reservation_eligible(r.application_id,r.vehicle_id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IN ('applicant_not_approved','vehicle_not_ready','pre_delivery_evidence_missing','active_rental_conflict') THEN blockers:=array_append(blockers,SQLERRM); ELSE RAISE; END IF;
 END;
 BEGIN PERFORM private.reservation_verified_driver(r.application_id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='verified_driver_identity_required' THEN blockers:=array_append(blockers,'Verified Driver account linkage required.'); ELSE RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.rentals t JOIN public.applications a ON a.user_id=t.driver_id WHERE a.id=r.application_id AND t.status='active') THEN blockers:=array_append(blockers,'Driver already has an active rental.'); END IF;
 IF EXISTS(SELECT 1 FROM public.reservations other WHERE other.id<>r.id AND other.vehicle_id=r.vehicle_id AND other.state IN ('reserved','confirmed')
 AND tstzrange(other.pickup_at,other.occupied_until,'[)') && tstzrange((r.pickup_at AT TIME ZONE r.timezone)::date::timestamp AT TIME ZONE r.timezone,
 (((r.agreed_end_at AT TIME ZONE r.timezone)::date+1)::timestamp AT TIME ZONE r.timezone)+make_interval(mins=>r.turnaround_minutes),'[)'))
 THEN blockers:=array_append(blockers,'Future reservation conflict; rental end dates occupy the entire final day.'); END IF;
 SELECT EXISTS(SELECT 1 FROM public.agreements WHERE application_id=r.application_id AND vehicle_id=r.vehicle_id AND status='signed' AND signed_at IS NOT NULL) INTO signed;
 RETURN jsonb_build_object('id',r.id,'version',r.version,'rentalId',r.rental_id,'state',r.state,'blockers',blockers,
 'agreement',CASE WHEN signed THEN 'Signed agreement recorded for this applicant and vehicle; current terms still require staff review.' ELSE 'No signed agreement recorded for this applicant and vehicle.' END,
 'payment','Payment and deposit receipt not verified. This conversion does not collect payment or start Stripe billing.');
END $$;
REVOKE ALL ON FUNCTION public.reservation_conversion_preview(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reservation_conversion_preview(uuid) TO authenticated;
