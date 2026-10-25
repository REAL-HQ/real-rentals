-- Activation insurance setting v1 inner DDL. Runner owns the transaction.
-- 1. The Owner exception setting lives in the existing public.app_settings table under the
--    key 'rental_activation'. Default OFF. A missing or unreadable value reads as OFF.
-- 2. Only public.set_rental_activation_insurance_exception (Owner-checked, audited in the same
--    transaction) may write that key. A row trigger refuses every other writer, including
--    service_role and an Owner writing the table directly; restrictive policies refuse
--    authenticated writes of that key as a second layer. Other app_settings keys are untouched.
-- 3. public.activate_rental_checked_tx wraps the existing public.activate_rental_tx (unchanged)
--    in the same transaction: it locks and re-reads the setting, the insurance state, the
--    licence documents and the signed agreement, refuses unless they pass, calls
--    activate_rental_tx, and writes one audit row. service_role EXECUTE only.

INSERT INTO public.app_settings (key, value)
VALUES ('rental_activation', '{"allow_activation_without_insurance_verification": false}'::jsonb);

CREATE FUNCTION private.rental_activation_setting_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $guardfn$
BEGIN
 IF (TG_OP OPERATOR(pg_catalog.<>) 'INSERT' AND OLD.key OPERATOR(pg_catalog.=) 'rental_activation')
 OR (TG_OP OPERATOR(pg_catalog.<>) 'DELETE' AND NEW.key OPERATOR(pg_catalog.=) 'rental_activation') THEN
  -- Only the Owner setter sets this flag (transaction-local) and runs as the function owner.
  IF pg_catalog.current_setting('app.rental_activation_setting_write', true) IS DISTINCT FROM 'on'
  OR current_user OPERATOR(pg_catalog.=) ANY (ARRAY['authenticated', 'anon', 'service_role']::pg_catalog.name[]) THEN
   RAISE EXCEPTION 'rental_activation_setting_owner_rpc_only' USING ERRCODE = '42501';
  END IF;
 END IF;
 IF TG_OP OPERATOR(pg_catalog.=) 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $guardfn$;
REVOKE ALL ON FUNCTION private.rental_activation_setting_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER rental_activation_setting_guard BEFORE INSERT OR UPDATE OR DELETE ON public.app_settings
 FOR EACH ROW EXECUTE FUNCTION private.rental_activation_setting_guard();

-- Second layer: authenticated sessions (Owner included) never write this key directly.
CREATE POLICY rental_activation_setting_no_client_insert ON public.app_settings AS RESTRICTIVE
 FOR INSERT TO authenticated WITH CHECK (key <> 'rental_activation');
CREATE POLICY rental_activation_setting_no_client_update ON public.app_settings AS RESTRICTIVE
 FOR UPDATE TO authenticated USING (key <> 'rental_activation') WITH CHECK (key <> 'rental_activation');
CREATE POLICY rental_activation_setting_no_client_delete ON public.app_settings AS RESTRICTIVE
 FOR DELETE TO authenticated USING (key <> 'rental_activation');

-- The Owner setter. Called with the Owner's own JWT (auth.uid()); audited in this transaction.
CREATE FUNCTION public.set_rental_activation_insurance_exception(_allow boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $setfn$
DECLARE
 actor uuid := auth.uid();
 old_value jsonb;
 old_present boolean;
 old_allow boolean;
 changed_at timestamptz := pg_catalog.clock_timestamp();
 actor_email text;
 audit_id uuid;
BEGIN
 IF _allow IS NULL THEN RAISE EXCEPTION 'setting_value_required' USING ERRCODE = '22004'; END IF;
 IF actor IS NULL OR private.is_owner() IS NOT TRUE THEN
  RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
 END IF;
 SELECT s.value INTO old_value FROM public.app_settings s WHERE s.key = 'rental_activation' FOR UPDATE;
 old_present := FOUND;
 old_allow := old_present
  AND pg_catalog.jsonb_typeof(old_value OPERATOR(pg_catalog.->) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'boolean'
  AND (old_value OPERATOR(pg_catalog.->>) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'true';
 PERFORM pg_catalog.set_config('app.rental_activation_setting_write', 'on', true);
 INSERT INTO public.app_settings (key, value)
 VALUES ('rental_activation', pg_catalog.jsonb_build_object(
   'allow_activation_without_insurance_verification', _allow, 'updated_at', changed_at, 'updated_by', actor))
 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
 PERFORM pg_catalog.set_config('app.rental_activation_setting_write', 'off', true);
 SELECT u.email INTO actor_email FROM auth.users u WHERE u.id = actor;
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (actor, actor_email, 'admin', 'settings.rental_activation_updated', 'app_settings', 'rental_activation',
  pg_catalog.concat('Allow Activation Without Insurance Verification: ',
   CASE WHEN old_allow THEN 'On' ELSE 'Off' END, ' -> ', CASE WHEN _allow THEN 'On' ELSE 'Off' END),
  pg_catalog.jsonb_build_object('setting', 'allow_activation_without_insurance_verification',
   'from', old_allow, 'to', _allow, 'from_row_present', old_present, 'changed_at', changed_at, 'actor_user_id', actor),
  changed_at)
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('from', old_allow, 'to', _allow, 'changed_at', changed_at, 'audit_id', audit_id);
END $setfn$;
REVOKE ALL ON FUNCTION public.set_rental_activation_insurance_exception(boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_rental_activation_insurance_exception(boolean) TO authenticated;

-- The checked activation. Same transaction as activate_rental_tx: no exception handler, no
-- autonomous work; any refusal or failure (here or inside activate_rental_tx) rolls back
-- every lock, read and write below, including the audit row.
CREATE FUNCTION public.activate_rental_checked_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid,
 _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date,
 _pickup_miles integer, _actor uuid, _insurance_exception_ack boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $checkedfn$
DECLARE
 today date := (pg_catalog.now() AT TIME ZONE 'America/New_York')::date;
 setting_value jsonb;
 setting_present boolean;
 setting_allow boolean;
 app_expires date;
 verified boolean;
 has_insurance_doc boolean;
 doc_expired boolean;
 insurance_status text;
 exception_used boolean := false;
 esign boolean;
 paper boolean;
 rental uuid;
 audit_id uuid;
BEGIN
 -- M2 lock order: the shared release lock before any row lock (re-entrant inside activate_rental_tx).
 PERFORM pg_catalog.pg_advisory_xact_lock(710026, 2);
 -- 1. The Owner setting, locked FOR SHARE so a concurrent Owner change waits for this transaction.
 SELECT s.value INTO setting_value FROM public.app_settings s WHERE s.key = 'rental_activation' FOR SHARE;
 setting_present := FOUND;
 setting_allow := setting_present
  AND pg_catalog.jsonb_typeof(setting_value OPERATOR(pg_catalog.->) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'boolean'
  AND (setting_value OPERATOR(pg_catalog.->>) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'true';
 -- 2. The application (FOR UPDATE: the lock activate_rental_tx takes next), the screening and
 --    the documents this check reads (FOR SHARE).
 SELECT a.insurance_expires_on INTO app_expires FROM public.applications a WHERE a.id = _application_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT sc.insurance_verified IS TRUE INTO verified FROM public.driver_screenings sc WHERE sc.lead_id = _application_id FOR SHARE;
 verified := verified IS TRUE;
 PERFORM 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = ANY (ARRAY['insurance', 'license_front', 'license_back', 'agreement']) FOR SHARE;
 PERFORM 1 FROM public.agreements g WHERE g.application_id = _application_id AND g.status = 'signed' FOR SHARE;
 has_insurance_doc := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected');
 doc_expired := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected' AND d.expires_at < today);
 insurance_status := CASE WHEN app_expires < today OR doc_expired THEN 'expired'
  WHEN verified THEN 'verified' WHEN NOT has_insurance_doc THEN 'missing' ELSE 'unverified' END;
 -- 3. Hard requirements re-checked here, under the locks above.
 IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
   AND d.category = 'license_front' AND d.review_status IS DISTINCT FROM 'rejected')
 OR NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
   AND d.category = 'license_back' AND d.review_status IS DISTINCT FROM 'rejected') THEN
  RAISE EXCEPTION 'missing_documents';
 END IF;
 esign := EXISTS (SELECT 1 FROM public.agreements g WHERE g.application_id = _application_id AND g.source = 'rental'
  AND g.status = 'signed' AND g.signed_at IS NOT NULL AND g.voided_at IS NULL AND g.rental_id IS NULL);
 -- A paper agreement counts only with its audited Manager/Owner verification of this exact file.
 paper := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.category = 'agreement'
  AND d.is_current IS TRUE AND d.review_status = 'verified' AND d.storage_path IS NOT NULL AND d.reviewed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.audit_log l WHERE l.action = 'document.verified' AND l.entity_type = 'application'
   AND l.entity_id = _application_id::text AND l.actor_role = ANY (ARRAY['admin', 'team'])
   AND l.metadata OPERATOR(pg_catalog.->>) 'paper_agreement' = 'true'
   AND l.metadata OPERATOR(pg_catalog.->>) 'documentId' = d.id::text
   AND l.metadata OPERATOR(pg_catalog.->>) 'storage_path' = d.storage_path
   AND l.metadata OPERATOR(pg_catalog.->>) 'reviewed_at_ms' = (pg_catalog.floor(EXTRACT(EPOCH FROM d.reviewed_at) * 1000))::bigint::text));
 IF NOT esign AND NOT paper THEN RAISE EXCEPTION 'no_signed_agreement'; END IF;
 -- 4. Insurance: verified, or the Owner exception is ON and the operator acknowledged it.
 IF insurance_status <> 'verified' THEN
  IF NOT setting_allow THEN RAISE EXCEPTION 'insurance_not_verified:%', insurance_status; END IF;
  IF _insurance_exception_ack IS NOT TRUE THEN RAISE EXCEPTION 'insurance_ack_required:%', insurance_status; END IF;
  exception_used := true;
 END IF;
 -- 5. The existing, unchanged activation transaction.
 rental := public.activate_rental_tx(_application_id, _vehicle_id, _driver_id, _weekly_rate, _deposit, _deposit_held,
  _start, _end, _pickup_miles, _actor);
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata)
 VALUES (_actor, NULL, NULL, 'rental.activation_checked', 'rental', rental::text,
  CASE WHEN exception_used THEN 'Rental started without verified insurance under the Owner exception'
   ELSE 'Rental started with verified insurance' END,
  pg_catalog.jsonb_build_object('application_id', _application_id, 'vehicle_id', _vehicle_id, 'driver_id', _driver_id,
   'actor_user_id', _actor, 'insurance_status', insurance_status, 'exception_used', exception_used,
   'setting_present', setting_present, 'setting_allow_without_insurance_verification', setting_allow,
   'insurance_exception_acknowledged', _insurance_exception_ack IS TRUE, 'signed_agreement', CASE WHEN esign THEN 'esign' ELSE 'paper' END,
   'checked_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'source', 'activate_rental_checked_tx'))
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('rental_id', rental, 'insurance_status', insurance_status,
  'exception_used', exception_used, 'setting_present', setting_present, 'setting_allow', setting_allow,
  'acknowledged', _insurance_exception_ack IS TRUE, 'signed_agreement', CASE WHEN esign THEN 'esign' ELSE 'paper' END,
  'audit_id', audit_id);
END $checkedfn$;
REVOKE ALL ON FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean) TO service_role;
