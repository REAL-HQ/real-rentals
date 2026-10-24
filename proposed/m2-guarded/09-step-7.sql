-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- LOCAL PRO', 'POSAL ONLY; outside migration discovery. Requires reviewed Record Rental V3.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'fd3e3ffe64296b9c0dae6123a077a41d26293b437a92227ee441540c14968b5f', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'fd3e3ffe64296b9c0dae6123a077a41d26293b437a92227ee441540c14968b5f';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 24183), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'c27b49a46e55381eacbfc6f1bb2c246c9ee2c73ce549172d81d44bbadac9b665';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 24183) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- LOCAL PROPOSAL ONLY; outside migration discovery. Requires reviewed Record Rental V3.
-- No role membership or production credential provisioning. Trusted issuer is server-only.
CREATE ROLE rr_evidence_issuer NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE TABLE private.record_evidence_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, session_id uuid NOT NULL,
 operation_id uuid NOT NULL UNIQUE, application_id uuid NOT NULL,
 request jsonb NOT NULL, verified jsonb NOT NULL, snapshot jsonb NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
CREATE TABLE private.record_evidence_consumed_v1 (
 evidence_id uuid PRIMARY KEY REFERENCES private.record_evidence_v1,
 operation_id uuid NOT NULL UNIQUE, result jsonb NOT NULL
);
CREATE TABLE private.record_evidence_context_v1 (
 transaction_id bigint PRIMARY KEY, evidence_id uuid NOT NULL REFERENCES private.record_evidence_v1
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['record_evidence_v1','record_evidence_consumed_v1','record_evidence_context_v1'] LOOP
 EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role,rr_evidence_issuer',t);
 END LOOP;
END$$;
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.record_evidence_v1 FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable();
CREATE TRIGGER consumption_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON private.record_evidence_consumed_v1 FOR EACH STATEMENT EXECUTE FUNCTION private.record_immutable();
-- Reads provider-authenticated session claim; checks actual session persistence/expiry.
CREATE FUNCTION private.record_session_v1() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; s uuid; BEGIN
 a:=private.approval_actor(); s:=nullif(auth.jwt()->>'session_id','')::uuid;
 PERFORM 1 FROM auth.sessions WHERE id=s AND user_id=a AND (not_after IS NULL OR not_after>clock_timestamp()) FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_unavailable' USING ERRCODE='42501';END IF;
 RETURN s;
END$$;
-- Lock order follows existing global approval/lifecycle locks, then application, roles,
-- vehicle; agreement/document rows follow. Global approval lock serializes their writers.
CREATE FUNCTION private.record_snapshot_v1(a uuid,v uuid,g uuid,d uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE app jsonb; ag jsonb; doc jsonb; actor uuid; review uuid; linked jsonb; item record;
BEGIN
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT to_jsonb(x) INTO app FROM public.applications x WHERE id=a FOR UPDATE NOWAIT;
 actor:=private.approval_actor(); PERFORM private.record_session_v1();
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND OR app IS NULL OR app->>'user_id' IS NULL OR app->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'identity_unavailable';END IF;
 review:=private.approval_validate(a);
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
 IF doc IS NULL THEN RAISE EXCEPTION 'document_missing';END IF;
 RETURN jsonb_build_object('application',app,'identity',private.approval_snapshot(a),'review',review,'agreement',ag,'document',doc,'legacy_linkable',linked);
END$$;
CREATE FUNCTION private.issue_record_evidence_v1(req jsonb, verified jsonb, expected_snapshot jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; s uuid; snap jsonb; e private.record_evidence_v1; token uuid; g jsonb; sub jsonb;
BEGIN
 a:=private.approval_actor();s:=private.record_session_v1();g:=verified->'agreement';sub:=verified->'subscription';
 snap:=private.record_snapshot_v1((req->>'applicationId')::uuid,(req->>'vehicleId')::uuid,(g->>'id')::uuid,(g->>'documentId')::uuid);
 IF snap IS DISTINCT FROM expected_snapshot OR verified->'request'->>'actorId' IS DISTINCT FROM a::text
 OR verified->'request'->>'operationId' IS DISTINCT FROM req->>'operationId'
 OR verified->'request'->>'applicationId' IS DISTINCT FROM req->>'applicationId'
 OR verified->'request'->>'vehicleId' IS DISTINCT FROM req->>'vehicleId'
 OR (verified->'request'->>'startedAt')::timestamptz IS DISTINCT FROM (req->>'startedAt')::timestamptz
 OR (verified->'request'->>'weeklyCents')::numeric IS DISTINCT FROM (req->>'weeklyRate')::numeric*100
 OR verified->'request'->>'driverId' IS DISTINCT FROM snap->'application'->>'user_id'
 OR g->>'signedVersion' IS DISTINCT FROM g->>'currentVersion' OR g->>'signedHash' IS DISTINCT FROM g->>'currentHash'
 OR (g->>'signedHash') !~ '^[a-f0-9]{64}$'
 OR g->>'status' IS DISTINCT FROM 'signed'
 OR NOT ((g->>'kind'='esign' AND g->>'verification'='esign-verified' AND snap->'agreement' <> 'null'::jsonb)
 OR (g->>'kind'='paper' AND g->>'verification'='paper-registered')) THEN RAISE EXCEPTION 'evidence_mismatch';END IF;

 IF (g ?& ARRAY['id','documentId','provenanceId','signedVersion','currentVersion','signedHash','currentHash','status','kind','verification','applicationId','driverId','vehicleId','weeklyCents','currency','effectiveAt','signedAt']) IS NOT TRUE
 OR (g->>'applicationId'=req->>'applicationId' AND g->>'driverId'=snap->'application'->>'user_id'
 AND g->>'vehicleId'=req->>'vehicleId' AND (g->>'weeklyCents')::numeric=(req->>'weeklyRate')::numeric*100
 AND g->>'currency'=verified->'request'->>'currency'
 AND (g->>'effectiveAt')::timestamptz=(req->>'startedAt')::timestamptz
 AND isfinite((g->>'signedAt')::timestamptz) AND (g->>'signedAt')::timestamptz<=(req->>'startedAt')::timestamptz
 AND length(g->>'signedVersion')>0 AND (g->>'signedHash') ~ '^[a-f0-9]{64}$') IS NOT TRUE
 THEN RAISE EXCEPTION 'agreement_binding_invalid';END IF;
 IF (snap->'document'->>'id'=g->>'documentId'
 AND nullif(snap->'document'->>'version','')=g->>'signedVersion'
 AND snap->'document'->>'version'=g->>'currentVersion'
 AND (snap->'document'->>'sha256') ~ '^[a-f0-9]{64}$'
 AND snap->'document'->>'sha256'=g->>'signedHash'
 AND snap->'document'->>'sha256'=g->>'currentHash') IS NOT TRUE
 THEN RAISE EXCEPTION 'authoritative_document_mismatch';END IF;
 IF sub IS NULL THEN RAISE EXCEPTION 'subscription_field_required';END IF;
 IF sub<>'null'::jsonb AND ((sub ?& ARRAY['account','environment','customer','subscription','applicationId','driverId','currency','unitAmount','interval','intervalCount','quantity','status','observedAt','expiresAt','nextDue']) IS NOT TRUE
 OR (sub->>'account'=verified->'request'->>'account' AND sub->>'environment'=verified->'request'->>'environment'
 AND sub->>'applicationId'=req->>'applicationId' AND sub->>'driverId'=snap->'application'->>'user_id'
 AND sub->>'currency'=verified->'request'->>'currency' AND (sub->>'unitAmount')::numeric=(req->>'weeklyRate')::numeric*100
 AND sub->>'interval'='week' AND sub->>'intervalCount'='1' AND sub->>'quantity'='1' AND sub->>'status'='active'
 AND (sub->>'customer') ~ '^cus_[A-Za-z0-9]+$' AND (sub->>'subscription') ~ '^sub_[A-Za-z0-9]+$'
 AND isfinite((sub->>'observedAt')::timestamptz) AND isfinite((sub->>'expiresAt')::timestamptz)
 AND (sub->>'observedAt')::timestamptz<=clock_timestamp() AND (sub->>'expiresAt')::timestamptz>clock_timestamp()
 AND (sub->>'expiresAt')::timestamptz<=(sub->>'observedAt')::timestamptz+interval '5 minutes') IS NOT TRUE)
 THEN RAISE EXCEPTION 'subscription_binding_invalid';END IF;
 SELECT * INTO e FROM private.record_evidence_v1 WHERE operation_id=(req->>'operationId')::uuid;
 IF FOUND THEN
 IF e.actor_id<>a OR e.session_id<>s OR e.request IS DISTINCT FROM req OR (e.verified #- '{subscription,observedAt}' #- '{subscription,expiresAt}') IS DISTINCT FROM (verified #- '{subscription,observedAt}' #- '{subscription,expiresAt}') OR e.snapshot IS DISTINCT FROM snap THEN RAISE EXCEPTION 'operation_conflict';END IF;
 -- Recover the original reference without extending either immutable freshness window.
 IF e.expires_at<=clock_timestamp() OR (e.verified->'subscription'->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'evidence_expired';END IF;
 RETURN e.id;END IF;
 INSERT INTO private.record_evidence_v1(actor_id,session_id,operation_id,application_id,request,verified,snapshot)
 VALUES(a,s,(req->>'operationId')::uuid,(req->>'applicationId')::uuid,req,verified,snap) RETURNING id INTO token;
 RETURN token;
END$$;
CREATE FUNCTION private.record_agreement_evidence_v1(a uuid,v uuid,t timestamptz,rate numeric) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.record_evidence_v1;BEGIN
 SELECT x.* INTO e FROM private.record_evidence_v1 x JOIN private.record_evidence_context_v1 c ON c.evidence_id=x.id WHERE c.transaction_id=txid_current();
 IF e.id IS NULL OR e.application_id<>a OR (e.request->>'vehicleId')::uuid<>v OR (e.request->>'startedAt')::timestamptz<>t OR (e.request->>'weeklyRate')::numeric<>rate THEN RAISE EXCEPTION 'evidence_context_missing';END IF;
 RETURN (e.verified->'agreement'->>'provenanceId')::uuid;
END$$;
CREATE FUNCTION private.record_subscription_evidence_v1(token uuid,a uuid,rate numeric) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.record_evidence_v1; sub jsonb;BEGIN
 SELECT x.* INTO e FROM private.record_evidence_v1 x JOIN private.record_evidence_context_v1 c ON c.evidence_id=x.id WHERE c.transaction_id=txid_current() AND x.id=token;
 sub:=e.verified->'subscription';
 IF e.id IS NULL OR e.application_id<>a OR (e.request->>'weeklyRate')::numeric<>rate OR sub IS NULL OR sub='null'::jsonb
 OR (sub->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'subscription_evidence_unavailable';END IF;
 RETURN jsonb_build_object('account',sub->>'account','environment',sub->>'environment','customer',sub->>'customer','subscription',sub->>'subscription','next_due',CASE WHEN sub->>'nextDue' IS NULL THEN NULL ELSE ((sub->>'nextDue')::timestamptz AT TIME ZONE 'UTC')::date END);
END$$;

-- Exact reviewed V3 core, renamed with only evidence-helper bindings changed.
CREATE FUNCTION private.record_existing_rental_evidence_core_v1(
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
ALTER FUNCTION private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamptz,numeric,numeric,integer,uuid,text) OWNER TO rr_record_executor;
REVOKE ALL ON FUNCTION private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamptz,numeric,numeric,integer,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.record_existing_rental_evidence_core_v1(uuid,uuid,uuid,timestamptz,numeric,numeric,integer,uuid,text) TO postgres;
CREATE FUNCTION public.record_existing_rental_evidence_v1(token uuid, req jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.record_evidence_v1; actor uuid; sess uuid; snap jsonb; result jsonb; g jsonb;
BEGIN
 actor:=private.approval_actor();sess:=private.record_session_v1();
 PERFORM private.approval_lock();
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'record_contention' USING ERRCODE='40001';END IF;
 SELECT * INTO e FROM private.record_evidence_v1 WHERE id=token FOR UPDATE NOWAIT;
 IF e.id IS NULL OR e.actor_id<>actor OR e.session_id<>sess OR e.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'evidence_binding_invalid';END IF;
 -- Recover immutable committed result before checking current mutable documents/freshness.
 SELECT c.result INTO result FROM private.record_evidence_consumed_v1 c WHERE c.evidence_id=token;
 IF FOUND THEN RETURN result || jsonb_build_object('recovered',true);END IF;
 IF e.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'evidence_expired';END IF;
 snap:=private.record_snapshot_v1(e.application_id,(req->>'vehicleId')::uuid,(e.verified->'agreement'->>'id')::uuid,(e.verified->'agreement'->>'documentId')::uuid);
 IF snap IS DISTINCT FROM e.snapshot THEN RAISE EXCEPTION 'evidence_changed';END IF;
 g:=e.verified->'agreement';
 IF (snap->'document'->>'id'=g->>'documentId'
 AND nullif(snap->'document'->>'version','')=g->>'signedVersion'
 AND snap->'document'->>'version'=g->>'currentVersion'
 AND (snap->'document'->>'sha256') ~ '^[a-f0-9]{64}$'
 AND snap->'document'->>'sha256'=g->>'signedHash'
 AND snap->'document'->>'sha256'=g->>'currentHash') IS NOT TRUE
 THEN RAISE EXCEPTION 'authoritative_document_mismatch';END IF;

 INSERT INTO private.record_evidence_context_v1 VALUES(txid_current(),token);
 result:=private.record_existing_rental_evidence_core_v1((req->>'operationId')::uuid,e.application_id,(req->>'vehicleId')::uuid,
 (req->>'startedAt')::timestamptz,(req->>'weeklyRate')::numeric,(req->>'deposit')::numeric,(req->>'pickupMileage')::integer,
 CASE WHEN e.verified->'subscription'='null'::jsonb THEN NULL ELSE token END,req->>'reason');
 INSERT INTO private.record_evidence_consumed_v1 VALUES(token,e.operation_id,result);
 DELETE FROM private.record_evidence_context_v1 WHERE transaction_id=txid_current();
 IF private.approval_actor() IS DISTINCT FROM actor OR private.record_session_v1() IS DISTINCT FROM sess THEN RAISE EXCEPTION 'actor_changed';END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION private.record_session_v1(),private.record_snapshot_v1(uuid,uuid,uuid,uuid),
 private.issue_record_evidence_v1(jsonb,jsonb,jsonb),private.record_agreement_evidence_v1(uuid,uuid,timestamptz,numeric),
 private.record_subscription_evidence_v1(uuid,uuid,numeric),public.record_existing_rental_evidence_v1(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.issue_record_evidence_v1(jsonb,jsonb,jsonb) TO rr_evidence_issuer;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence_v1(uuid,uuid,timestamptz,numeric),private.record_subscription_evidence_v1(uuid,uuid,numeric) TO rr_record_executor;
GRANT EXECUTE ON FUNCTION public.record_existing_rental_evidence_v1(uuid,jsonb) TO authenticated;
-- Installation owner must already hold reviewed DDL/definer authority. No ownership change
-- to existing objects, role memberships, broad grants or service-role access is supplied.
GRANT USAGE ON SCHEMA private TO rr_evidence_issuer;
GRANT EXECUTE ON FUNCTION private.record_snapshot_v1(uuid,uuid,uuid,uuid) TO rr_evidence_issuer;
