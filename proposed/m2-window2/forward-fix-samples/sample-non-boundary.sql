-- Sample (harness only): a non-boundary function-level fix. Same logic, comment added.
CREATE OR REPLACE FUNCTION private.record_issuer_scope_v2(app uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 -- forward-fix sample: unchanged logic
 IF current_user<>'rr_evidence_issuer' OR app IS NULL OR app IS DISTINCT FROM nullif(current_setting('record.application_id',true),'')::uuid THEN RETURN false; END IF;
 PERFORM private.approval_actor(); PERFORM private.record_session_v1(); RETURN true;
END $function$;
