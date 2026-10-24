-- Sample (harness only): a boundary fix the owner names explicitly. lock_timeout 500ms -> 750ms;
-- every refusal (positive_identity_required) is kept.
CREATE OR REPLACE FUNCTION private.approval_validate(_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '750ms'
AS $function$
DECLARE snapshot jsonb; rid uuid;
BEGIN
 PERFORM private.approval_actor();snapshot:=private.approval_snapshot(_id);
 SELECT id INTO rid FROM public.application_identity_reviews WHERE application_id=_id AND kind='approval_identity' AND status='resolved' AND resolution='verified' AND approval_evidence=snapshot AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL ORDER BY resolved_at DESC,id DESC LIMIT 1;
 IF rid IS NULL THEN RAISE EXCEPTION 'positive_identity_required';END IF;RETURN rid;
END $function$;
