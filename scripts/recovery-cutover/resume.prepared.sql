-- PROPOSAL ONLY. Execute only after publication + drain evidence + separate approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(7310031);
LOCK TABLE public.application_resume_tokens IN ACCESS EXCLUSIVE MODE;
DO $verify$
BEGIN
 IF (SELECT prosrc FROM pg_proc WHERE oid='private.recovery_cutover_fence()'::regprocedure)
 IS DISTINCT FROM E'\nBEGIN\n RAISE EXCEPTION ''Recovery temporarily paused; retry after maintenance'' USING ERRCODE=''55000'';\nEND;\n'
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.application_resume_tokens'::regclass
 AND tgfoid='private.recovery_cutover_fence()'::regprocedure AND tgenabled='A'
 AND ((tgname='recovery_cutover_rows' AND tgtype=31)
 OR (tgname='recovery_cutover_truncate' AND tgtype=34)))<>2
 THEN RAISE EXCEPTION 'CUTOVER_FENCE_DRIFT'; END IF;
END $verify$;
DROP TRIGGER recovery_cutover_rows ON public.application_resume_tokens;
DROP TRIGGER recovery_cutover_truncate ON public.application_resume_tokens;
DROP FUNCTION private.recovery_cutover_fence();
COMMIT;
