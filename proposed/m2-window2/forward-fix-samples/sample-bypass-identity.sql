-- Negative sample (harness only): removes the verified-identity requirement. Must be refused.
CREATE OR REPLACE FUNCTION private.approval_validate(_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '500ms'
AS $function$
DECLARE snapshot jsonb; rid uuid;
BEGIN
 PERFORM private.approval_actor();snapshot:=private.approval_snapshot(_id);
 SELECT id INTO rid FROM public.application_identity_reviews WHERE application_id=_id ORDER BY id LIMIT 1;
 RETURN coalesce(rid, _id);
END $function$;
