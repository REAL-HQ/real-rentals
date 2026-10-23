-- LOCAL versioned consumer amendment applied AFTER Evidence V1 and Document/Identity V2.
-- Retains operation IDs, atomic evidence consumption and original recovery functions.
CREATE OR REPLACE FUNCTION private.record_snapshot_v1(a uuid,v uuid,g uuid,d uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE app jsonb; ag jsonb; doc jsonb; actor uuid; review uuid; linked jsonb; item record;
BEGIN
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT to_jsonb(x) INTO app FROM public.applications x WHERE id=a FOR UPDATE NOWAIT;
 actor:=private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND OR app IS NULL OR app->>'user_id' IS NULL OR app->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'identity_unavailable';END IF;
 review:=private.validate_license_v1(a);
 IF review IS NULL THEN RAISE EXCEPTION 'positive_identity_required';END IF;
 IF nullif(app->>'license_number','') IS NULL OR nullif(app->>'license_state','') IS NULL
 OR (app->>'license_expiration')::date IS NULL OR NOT isfinite((app->>'license_expiration')::date)
 OR (app->>'license_expiration')::date<CURRENT_DATE THEN RAISE EXCEPTION 'license_unavailable';END IF;
 PERFORM 1 FROM public.vehicles WHERE id=v FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_missing';END IF;
 FOR item IN SELECT to_jsonb(x) AS j FROM public.agreements x WHERE application_id=a AND rental_id IS NULL ORDER BY id FOR SHARE NOWAIT LOOP
 IF item.j->>'vehicle_id' IS DISTINCT FROM v::text OR item.j->>'status' IS DISTINCT FROM 'signed' THEN RAISE EXCEPTION 'legacy_agreement_conflict';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) INTO linked FROM public.agreements x WHERE application_id=a AND rental_id IS NULL;
 SELECT to_jsonb(x) INTO ag FROM public.agreements x WHERE id=g FOR SHARE NOWAIT;
 SELECT to_jsonb(x) INTO doc FROM public.documents x WHERE id=d FOR SHARE NOWAIT;
 -- Paper evidence may have no eSign row: the immutable registered document is authoritative;
 -- issuer must verify the reviewed paper registration/provenance, never invent an agreement row.
 IF doc IS NULL OR doc->'integrity_v1' IS NULL THEN RAISE EXCEPTION 'immutable_document_missing';END IF;
 IF ag IS NULL OR ag->>'document_id' IS DISTINCT FROM d::text OR ag->>'completed_document_id' IS DISTINCT FROM d::text
 OR ag->>'status' IS DISTINCT FROM 'signed' OR ag->>'voided_at' IS NOT NULL
 OR doc->'integrity_v1'->>'agreement' IS DISTINCT FROM g::text
 OR doc->'integrity_v1'->>'application' IS DISTINCT FROM a::text
 OR doc->'integrity_v1'->>'driver' IS DISTINCT FROM app->>'user_id'
 OR doc->'integrity_v1'->>'vehicle' IS DISTINCT FROM v::text
 OR doc->'integrity_v1'->>'sha256' IS DISTINCT FROM doc->>'content_sha256'
 OR doc->'integrity_v1'->>'sha256' IS DISTINCT FROM ag->>'sha256'
 THEN RAISE EXCEPTION 'signed_binding_mismatch'; END IF;
 doc:=doc||jsonb_build_object('version',doc->'integrity_v1'->>'version','sha256',doc->>'content_sha256');
 RETURN jsonb_build_object('application',app,'identity',private.license_snapshot_v1(a),'review',review,'agreement',ag,'document',doc,'legacy_linkable',linked);
END$$;

CREATE OR REPLACE FUNCTION private.record_existing_rental_evidence_core_v1(
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
 identity_id:=private.validate_license_v1(_application_id);
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
 agreement_id:=private.record_agreement_evidence_v1(_application_id,_vehicle_id,_started_at,_weekly_rate);
 IF agreement_id IS NULL THEN RAISE EXCEPTION 'agreement_required';END IF;
 IF _subscription_evidence_id IS NOT NULL THEN
  sub:=private.record_subscription_evidence_v1(_subscription_evidence_id,_application_id,_weekly_rate);
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
CREATE FUNCTION private.record_identity_reader_v2(app uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE snap jsonb; rid uuid;
BEGIN
 rid:=private.validate_license_v1(app);snap:=private.license_snapshot_v1(app);
 RETURN jsonb_build_object('applicationId',app,'driverId',snap->>'driver','positiveReview',rid,
 'reviewVersion',snap::text,'currentVersion',snap::text,'licenseNumber',snap->>'license_number','licenseState',snap->>'license_state',
 'licenseExpires',snap->>'license_expiration','licenseDocumentVersion',(snap->'documents')::text,
 'reviewedLicenseVersion',(snap->'documents')::text,'eligible',true);
END $$;
REVOKE ALL ON FUNCTION private.record_identity_reader_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.record_identity_reader_v2(uuid),private.validate_license_v1(uuid),private.license_snapshot_v1(uuid) TO rr_evidence_issuer;
GRANT EXECUTE ON FUNCTION private.validate_license_v1(uuid),private.license_snapshot_v1(uuid) TO rr_record_executor;
-- No new table grants, RLS bypass, issuer membership or SQL driver provisioning.
