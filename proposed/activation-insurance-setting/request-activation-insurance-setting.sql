-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PREPARATI', 'ON ONLY. Activation insurance setting v1: Owner exception setting, audited setter, checked activation wrapper. Single statement.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '8703d1460f9ceffafb48449fb59fd6271a954e06b211394b45ed40267e3dc950', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '8703d1460f9ceffafb48449fb59fd6271a954e06b211394b45ed40267e3dc950';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 35744), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '1e94cac995a3b44f58ddec5adb67b9857e383a886bfb5d3770a1177357b8bfca';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 35744) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PREPARATION ONLY. Activation insurance setting v1: Owner exception setting, audited setter, checked activation wrapper. Single statement.
-- Send only as request-activation-insurance-setting.sql (guard v3 + these exact bytes) through query_database with the pinned project.
-- Provider owns the outer transaction. No explicit transaction commands. No migration ledger is written.
-- Changes: one app_settings row (key rental_activation, OFF), one SECURITY INVOKER trigger function + trigger on public.app_settings,
-- three RESTRICTIVE write policies on public.app_settings for that key, two SECURITY DEFINER functions, one audit_log evidence row.
-- Untouched: activate_rental_tx, end_rental_tx, every other policy (including the five Security 0031 policies), both ledgers.
DO $rrais$
DECLARE
 profile jsonb := '{"project_ref": "yuyzdsnrbfhkmfzpvhwx", "lovable_project_id": "8cf1f99e-71ad-4a93-a47c-bfbe833616d6", "database": "postgres", "system_identifier": "7642734024280108049", "execution_role": "postgres"}'::jsonb;
 approved_sql text := $approvedais$-- Activation insurance setting v1 inner DDL. Runner owns the transaction.
-- 1. The Owner exception setting lives in the existing public.app_settings table under the
--    key 'rental_activation'. Default OFF. A missing or unreadable value reads as OFF.
-- 2. Only public.set_rental_activation_insurance_exception (Owner-checked, audited in the same
--    transaction) may write that key. A row trigger refuses every other writer, including
--    service_role and an Owner writing the table directly; restrictive policies refuse
--    authenticated writes of that key as a second layer. Other app_settings keys are untouched.
-- 3. public.activate_rental_checked_tx wraps the existing public.activate_rental_tx (unchanged)
--    in the same transaction: it checks the acting user is a Manager/Owner, locks and re-reads
--    the setting, the insurance state, the licence documents, the signed agreement, the
--    interview and the passed inspection, refuses unless they pass (only interview and
--    inspection may be overridden, with a reason), calls activate_rental_tx, and writes the
--    rental.activated audit row in the same transaction. service_role EXECUTE only.

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
-- every lock, read and write below, including the rental.activated audit row, which this
-- function writes itself so the activation and its required audit evidence commit together.
-- _audit carries what only the server knows: the actor's email and role, request ip and user
-- agent, the summary line, account_created, and the soft-blocker overrides with their reason.
CREATE FUNCTION public.activate_rental_checked_tx(_application_id uuid, _vehicle_id uuid, _driver_id uuid,
 _weekly_rate numeric, _deposit numeric, _deposit_held boolean, _start date, _end date,
 _pickup_miles integer, _actor uuid, _insurance_exception_ack boolean, _audit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $checkedfn$
DECLARE
 today date := (pg_catalog.now() AT TIME ZONE 'America/New_York')::date;
 setting_value jsonb;
 setting_present boolean;
 setting_allow boolean;
 app_expires date;
 verified boolean;
 interview_done boolean;
 inspection_passed boolean;
 has_insurance_doc boolean;
 doc_expired boolean;
 insurance_status text;
 exception_used boolean := false;
 esign boolean;
 paper boolean;
 overrides jsonb;
 override_codes text[] := ARRAY[]::text[];
 override_reason text;
 bad_code text;
 rental uuid;
 audit_id uuid;
 decided_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
 IF _audit IS NULL OR pg_catalog.jsonb_typeof(_audit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'audit_payload_required'; END IF;
 -- M2 lock order: the shared release lock before any row lock (re-entrant inside activate_rental_tx).
 PERFORM pg_catalog.pg_advisory_xact_lock(710026, 2);
 -- 0. The acting user must be a Manager or Owner (the server already checked; this is the database's own check).
 PERFORM 1 FROM public.user_roles r WHERE r.user_id = _actor AND r.role::text = ANY (ARRAY['admin', 'team']) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'actor_not_manager' USING ERRCODE = '42501'; END IF;
 -- 1. The Owner setting, locked FOR SHARE so a concurrent Owner change waits for this transaction.
 SELECT s.value INTO setting_value FROM public.app_settings s WHERE s.key = 'rental_activation' FOR SHARE;
 setting_present := FOUND;
 setting_allow := setting_present
  AND pg_catalog.jsonb_typeof(setting_value OPERATOR(pg_catalog.->) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'boolean'
  AND (setting_value OPERATOR(pg_catalog.->>) 'allow_activation_without_insurance_verification') OPERATOR(pg_catalog.=) 'true';
 -- 2. The application (FOR UPDATE: the lock activate_rental_tx takes next), the screening, the
 --    documents, agreements and passed inspections this check reads (FOR SHARE).
 SELECT a.insurance_expires_on INTO app_expires FROM public.applications a WHERE a.id = _application_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
 SELECT sc.insurance_verified IS TRUE, sc.interview_completed_at IS NOT NULL INTO verified, interview_done
  FROM public.driver_screenings sc WHERE sc.lead_id = _application_id FOR SHARE;
 verified := verified IS TRUE;
 interview_done := interview_done IS TRUE;
 PERFORM 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = ANY (ARRAY['insurance', 'license_front', 'license_back', 'agreement']) FOR SHARE;
 PERFORM 1 FROM public.agreements g WHERE g.application_id = _application_id AND g.status = 'signed' FOR SHARE;
 PERFORM 1 FROM public.inspections i WHERE i.vehicle_id = _vehicle_id AND i.inspection_type = 'pre_delivery' AND i.status = 'passed' FOR SHARE;
 inspection_passed := FOUND;
 has_insurance_doc := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected');
 doc_expired := EXISTS (SELECT 1 FROM public.documents d WHERE d.driver_id = _application_id AND d.is_current IS TRUE
  AND d.category = 'insurance' AND d.review_status IS DISTINCT FROM 'rejected' AND d.expires_at < today);
 insurance_status := CASE WHEN app_expires < today OR doc_expired THEN 'expired'
  WHEN verified THEN 'verified' WHEN NOT has_insurance_doc THEN 'missing' ELSE 'unverified' END;
 -- 3. Hard requirements re-checked here, under the locks above. No override reaches these.
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
 -- 5. Soft blockers (the only overridable ones): an override may name only no_interview and
 --    no_passed_inspection, needs a written reason, and must cover every one that is unmet now.
 overrides := _audit OPERATOR(pg_catalog.->) 'overrides';
 IF overrides IS NOT NULL AND pg_catalog.jsonb_typeof(overrides) <> 'null' THEN
  IF pg_catalog.jsonb_typeof(overrides) <> 'object' OR pg_catalog.jsonb_typeof(overrides OPERATOR(pg_catalog.->) 'blockers') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'override_payload_invalid';
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(b OPERATOR(pg_catalog.->>) 'code'), ARRAY[]::text[]) INTO override_codes
   FROM pg_catalog.jsonb_array_elements(overrides OPERATOR(pg_catalog.->) 'blockers') b;
  SELECT c INTO bad_code FROM pg_catalog.unnest(override_codes) c
   WHERE c IS NULL OR c <> ALL (ARRAY['no_interview', 'no_passed_inspection']) LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'override_not_allowed:%', COALESCE(bad_code, 'null'); END IF;
  override_reason := pg_catalog.btrim(overrides OPERATOR(pg_catalog.->>) 'reason');
  IF override_reason IS NULL OR pg_catalog.length(override_reason) < 5 THEN RAISE EXCEPTION 'override_reason_required'; END IF;
 ELSE
  overrides := NULL;
 END IF;
 IF NOT interview_done AND NOT ('no_interview' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:no_interview'; END IF;
 IF NOT inspection_passed AND NOT ('no_passed_inspection' = ANY (override_codes)) THEN RAISE EXCEPTION 'override_required:no_passed_inspection'; END IF;
 -- 6. The existing, unchanged activation transaction.
 rental := public.activate_rental_tx(_application_id, _vehicle_id, _driver_id, _weekly_rate, _deposit, _deposit_held,
  _start, _end, _pickup_miles, _actor);
 -- 7. The required rental.activated audit entry, in this transaction.
 INSERT INTO public.audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, ip, user_agent)
 VALUES (_actor, pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'actor_email', 320), pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'actor_role', 40),
  'rental.activated', 'rental', rental::text,
  pg_catalog.left(COALESCE(NULLIF(_audit OPERATOR(pg_catalog.->>) 'summary', ''), 'Activated rental'), 300),
  pg_catalog.jsonb_build_object('vehicle_id', _vehicle_id, 'application_id', _application_id, 'driver_id', _driver_id,
   'account_created', (_audit OPERATOR(pg_catalog.->>) 'account_created') = 'true',
   'overrides', CASE WHEN overrides IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
     'blockers', overrides OPERATOR(pg_catalog.->) 'blockers', 'reason', override_reason, 'by', _actor, 'at', decided_at) END,
   'insurance', pg_catalog.jsonb_build_object('acting_user_id', _actor, 'at', decided_at, 'status', insurance_status,
     'exception_used', exception_used, 'setting_allow_without_verification', setting_allow, 'setting_present', setting_present,
     'setting_source', 'activation_transaction', 'acknowledged', _insurance_exception_ack IS TRUE, 'checked_in_transaction', true),
   'checks', pg_catalog.jsonb_build_object('signed_agreement', CASE WHEN esign THEN 'esign' ELSE 'paper' END,
     'interview_completed', interview_done, 'inspection_passed', inspection_passed, 'license_documents', true),
   'transaction_id', pg_catalog.txid_current()::text, 'source', 'activate_rental_checked_tx'),
  pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'ip', 100), pg_catalog.left(_audit OPERATOR(pg_catalog.->>) 'user_agent', 500))
 RETURNING id INTO audit_id;
 RETURN pg_catalog.jsonb_build_object('rental_id', rental, 'insurance_status', insurance_status,
  'exception_used', exception_used, 'setting_present', setting_present, 'setting_allow', setting_allow,
  'acknowledged', _insurance_exception_ack IS TRUE, 'signed_agreement', CASE WHEN esign THEN 'esign' ELSE 'paper' END,
  'audit_id', audit_id);
END $checkedfn$;
REVOKE ALL ON FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb) TO service_role;
$approvedais$;
 journal jsonb; receipts integer; p0031 text; activate_def text; activate_acl text;
 policies_before jsonb; policies_after jsonb; acl_before text; acl_after text; n integer;
 prev_search_path text := pg_catalog.current_setting('search_path');
BEGIN
 IF profile->>'project_ref' IS DISTINCT FROM 'yuyzdsnrbfhkmfzpvhwx'
 OR profile->>'lovable_project_id' IS DISTINCT FROM '8cf1f99e-71ad-4a93-a47c-bfbe833616d6'
 OR profile->>'system_identifier' IS NULL OR profile->>'execution_role' IS NULL OR profile->>'database' IS NULL
 THEN RAISE EXCEPTION 'UNSEALED_TARGET_PROFILE'; END IF;
 IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM profile->>'system_identifier'
 OR pg_catalog.current_database() IS DISTINCT FROM profile->>'database'
 OR current_user IS DISTINCT FROM profile->>'execution_role'
 THEN RAISE EXCEPTION 'TARGET_MISMATCH'; END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(approved_sql, 'UTF8')), 'hex') IS DISTINCT FROM 'ec415d3a617224857044f15a194b73f24e887b42d2b79b9faa27f06537915c17'
 THEN RAISE EXCEPTION 'SQL_CHECKSUM_MISMATCH'; END IF;
 -- Everything below is schema-qualified or resolves in pg_catalog; no session search_path applies.
 PERFORM pg_catalog.set_config('search_path', '', true);
 PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
 PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
 PERFORM pg_catalog.pg_advisory_xact_lock(7310202);
 LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
 LOCK TABLE public.app_settings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.audit_log IN SHARE ROW EXCLUSIVE MODE;
 -- Ledger: the 23 receipts production holds since Security 0031, as a prefix. Read only.
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY id) INTO journal FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 23) j;
 IF journal IS DISTINCT FROM '[{"created_at": 1791420975062, "hash": "60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa", "id": 1}, {"created_at": 1791421074958, "hash": "738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5", "id": 2}, {"created_at": 1791430766220, "hash": "cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138", "id": 3}, {"created_at": 1791431279577, "hash": "611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b", "id": 4}, {"created_at": 1791432590443, "hash": "63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033", "id": 5}, {"created_at": 1791432832737, "hash": "63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271", "id": 6}, {"created_at": 1791458463060, "hash": "33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808", "id": 7}, {"created_at": 1791459951490, "hash": "9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43", "id": 8}, {"created_at": 1791462253541, "hash": "dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265", "id": 9}, {"created_at": 1791462346435, "hash": "ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957", "id": 10}, {"created_at": 1791463536348, "hash": "18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77", "id": 11}, {"created_at": 1791463558283, "hash": "6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e", "id": 12}, {"created_at": 1791464019517, "hash": "873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4", "id": 13}, {"created_at": 1791471257211, "hash": "c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1", "id": 14}, {"created_at": 1791473301327, "hash": "0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890", "id": 15}, {"created_at": 1791473830599, "hash": "2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc", "id": 16}, {"created_at": 1791477139776, "hash": "a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a", "id": 17}, {"created_at": 1791479523295, "hash": "71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6", "id": 18}, {"created_at": 1791480452755, "hash": "cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2", "id": 19}, {"created_at": 1791480942211, "hash": "6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e", "id": 20}, {"created_at": 1791481035617, "hash": "2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80", "id": 21}, {"created_at": 1791496432098, "hash": "a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de", "id": 22}, {"created_at": 1792408979135, "hash": "9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11", "id": 23}]'::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT'; END IF;
 SELECT pg_catalog.count(*) INTO receipts FROM drizzle.__drizzle_migrations;
 -- Security 0031: the five containment policies exactly as installed on 2026-10-24. Never touched here.
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' THEN RAISE EXCEPTION 'POLICY_0031_DRIFT'; END IF;
 -- The existing activation transaction: present, service-role only, and never changed by this package.
 IF pg_catalog.to_regprocedure('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_MISSING'; END IF;
 IF pg_catalog.has_function_privilege('authenticated', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 OR pg_catalog.has_function_privilege('anon', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role', 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'ACTIVATE_RENTAL_TX_ACL_DRIFT'; END IF;
 activate_def := pg_catalog.md5(pg_catalog.pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure));
 activate_acl := (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure);
 -- app_settings: the reviewed shape (RLS on, the Owner-only permissive policy).
 policies_before := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass);
 acl_before := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF (SELECT c.relkind = 'r' AND c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass) IS NOT TRUE
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname = 'Admins manage settings' AND po.polpermissive)
 THEN RAISE EXCEPTION 'APP_SETTINGS_DRIFT'; END IF;
 IF pg_catalog.to_regprocedure('private.is_owner()') IS NULL OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
 THEN RAISE EXCEPTION 'HELPER_MISSING'; END IF;
 -- Columns the wrapper and setter read, with their types.
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a WHERE NOT a.attisdropped AND a.attnum > 0 AND (
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'insurance_verified' AND a.atttypid = 'boolean'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'lead_id' AND a.atttypid = 'uuid'::pg_catalog.regtype) OR
      (a.attrelid = 'public.driver_screenings'::pg_catalog.regclass AND a.attname = 'interview_completed_at') OR
      (a.attrelid = 'public.inspections'::pg_catalog.regclass AND a.attname IN ('vehicle_id','inspection_type','status')) OR
      (a.attrelid = 'public.user_roles'::pg_catalog.regclass AND a.attname IN ('user_id','role')) OR
      (a.attrelid = 'public.applications'::pg_catalog.regclass AND a.attname = 'insurance_expires_on' AND a.atttypid = 'date'::pg_catalog.regtype) OR
      (a.attrelid = 'public.documents'::pg_catalog.regclass AND a.attname IN ('driver_id','category','is_current','review_status','expires_at','storage_path','reviewed_at')) OR
      (a.attrelid = 'public.agreements'::pg_catalog.regclass AND a.attname IN ('application_id','source','status','signed_at','voided_at','rental_id')) OR
      (a.attrelid = 'public.audit_log'::pg_catalog.regclass AND a.attname IN ('actor_user_id','actor_role','action','entity_type','entity_id','metadata','ip','user_agent')) OR
      (a.attrelid = 'public.app_settings'::pg_catalog.regclass AND a.attname IN ('key','value')))) <> 32
 THEN RAISE EXCEPTION 'COLUMN_SHAPE_DRIFT'; END IF;
 IF NOT pg_catalog.has_table_privilege(current_user, 'public.audit_log', 'INSERT') THEN RAISE EXCEPTION 'AUDIT_INSERT_UNAVAILABLE'; END IF;
 -- Idempotence: one install per evidence row; a re-run, or a partial install, is refused.
 IF EXISTS (SELECT 1 FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1') THEN
  RAISE EXCEPTION 'AIS_EVIDENCE_REPLAY'; END IF;
 IF pg_catalog.to_regprocedure('public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb)') IS NOT NULL OR pg_catalog.to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') IS NOT NULL
 OR pg_catalog.to_regprocedure('private.rental_activation_setting_guard()') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.app_settings'::pg_catalog.regclass AND tgname = 'rental_activation_setting_guard')
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.app_settings'::pg_catalog.regclass AND polname LIKE 'rental_activation_setting_%')
 OR EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'rental_activation')
 THEN RAISE EXCEPTION 'AIS_PARTIAL_INSTALL_OR_KEY_EXISTS'; END IF;

 -- Native permission checks remain authoritative; no role elevation.
 EXECUTE approved_sql;
 -- TEST_FAILURE_POINT (only disposable test copies may inject failure here)

 -- Post: the three functions are exactly the reviewed objects.
 IF (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '669338378bd3bab69f756e923665fc3a690669fc8ed3a9b9f5c32e4f2c81298a'
      AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.activate_rental_checked_tx(uuid, uuid, uuid, numeric, numeric, boolean, date, date, integer, uuid, boolean, jsonb)'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_WRAPPER_MISMATCH'; END IF;
 IF (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '39ff1d560ff33a22c416857840b2c6185e94876699cb0aee26d0301e2095fd97'
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) e WHERE e.grantee = 0)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.set_rental_activation_insurance_exception(boolean)'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_SETTER_MISMATCH'; END IF;
 IF (SELECT NOT p.prosecdef AND l.lanname = 'plpgsql' AND p.proconfig = ARRAY['search_path=""'] AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') = '8723cbdee5c18629f112f0701a5035146ea7937d3e3567b2569c2d2ced73214e'
      AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = 'private.rental_activation_setting_guard()'::pg_catalog.regprocedure) IS NOT TRUE
 THEN RAISE EXCEPTION 'POST_GUARD_FUNCTION_MISMATCH'; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public.app_settings'::pg_catalog.regclass AND t.tgname = 'rental_activation_setting_guard'
      AND NOT t.tgisinternal AND t.tgtype = 31 AND t.tgenabled = 'O' AND t.tgfoid = 'private.rental_activation_setting_guard()'::pg_catalog.regprocedure) <> 1
 THEN RAISE EXCEPTION 'POST_TRIGGER_MISMATCH'; END IF;
 -- Post: app_settings policies = before + exactly the three restrictive ones; ACL unchanged.
 policies_after := (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text, po.polqual::text, po.polwithcheck::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname NOT LIKE 'rental_activation_setting_%');
 IF policies_after IS DISTINCT FROM policies_before THEN RAISE EXCEPTION 'POST_UNEXPECTED_POLICY_CHANGE'; END IF;
 IF (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(po.polname, po.polcmd, po.polpermissive, po.polroles::pg_catalog.regrole[]::text) ORDER BY po.polname COLLATE "C") FROM pg_catalog.pg_policy po WHERE po.polrelid = 'public.app_settings'::pg_catalog.regclass AND po.polname LIKE 'rental_activation_setting_%')
  IS DISTINCT FROM '[["rental_activation_setting_no_client_delete", "d", false, "{authenticated}"], ["rental_activation_setting_no_client_insert", "a", false, "{authenticated}"], ["rental_activation_setting_no_client_update", "w", false, "{authenticated}"]]'::jsonb
 THEN RAISE EXCEPTION 'POST_POLICY_MISMATCH'; END IF;
 acl_after := (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.app_settings'::pg_catalog.regclass);
 IF acl_after IS DISTINCT FROM acl_before THEN RAISE EXCEPTION 'POST_ACL_CHANGED'; END IF;
 -- Post: the seeded setting is OFF, and only that one row was added.
 IF (SELECT value FROM public.app_settings WHERE key = 'rental_activation') IS DISTINCT FROM '{"allow_activation_without_insurance_verification": false}'::jsonb
 THEN RAISE EXCEPTION 'POST_SETTING_NOT_OFF'; END IF;
 -- Post: activate_rental_tx byte-identical (definition and ACL), 0031 and the ledger unchanged.
 IF pg_catalog.md5(pg_catalog.pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure)) IS DISTINCT FROM activate_def
 OR (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::pg_catalog.regprocedure) IS DISTINCT FROM activate_acl
 THEN RAISE EXCEPTION 'POST_ACTIVATE_RENTAL_TX_CHANGED'; END IF;
 SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n' ORDER BY policyname)) INTO p0031
 FROM pg_catalog.pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment');
 IF p0031 IS DISTINCT FROM 'd33877618a9f40924d14e49b6653d7fa' THEN RAISE EXCEPTION 'POST_POLICY_0031_CHANGED'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM drizzle.__drizzle_migrations;
 IF n IS DISTINCT FROM receipts THEN RAISE EXCEPTION 'POST_JOURNAL_CHANGED'; END IF;

 INSERT INTO public.audit_log(actor_user_id, actor_email, actor_role, action, entity_type, entity_id, summary, metadata, created_at)
 VALUES (NULL, NULL, current_user, 'security_migration_verified', 'database_migration', 'activation_insurance_setting_v1',
  'Activation insurance setting v1 postconditions verified by database migration executor',
  pg_catalog.jsonb_build_object('project_ref', profile->>'project_ref', 'package', 'activation-insurance-setting v1',
   'execution_at', pg_catalog.clock_timestamp(), 'transaction_id', pg_catalog.txid_current()::text, 'database_executor', current_user,
   'session_executor', session_user, 'inner_sql_sha256', 'ec415d3a617224857044f15a194b73f24e887b42d2b79b9faa27f06537915c17', 'wrapper_prosrc_sha256', '669338378bd3bab69f756e923665fc3a690669fc8ed3a9b9f5c32e4f2c81298a',
   'setter_prosrc_sha256', '39ff1d560ff33a22c416857840b2c6185e94876699cb0aee26d0301e2095fd97', 'guard_prosrc_sha256', '8723cbdee5c18629f112f0701a5035146ea7937d3e3567b2569c2d2ced73214e', 'activate_rental_tx_def_md5', activate_def,
   'policies_0031_md5', p0031, 'drizzle_receipts', receipts, 'setting_seeded', false),
  pg_catalog.clock_timestamp());
 SELECT pg_catalog.count(*) INTO n FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id = 'activation_insurance_setting_v1';
 IF n <> 1 THEN RAISE EXCEPTION 'EXECUTION_EVIDENCE_MISMATCH'; END IF;
 PERFORM pg_catalog.set_config('search_path', prev_search_path, true);
END;
$rrais$;
