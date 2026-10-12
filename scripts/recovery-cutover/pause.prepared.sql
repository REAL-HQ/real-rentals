-- PROPOSAL ONLY. Separate production SQL approval required.
-- Run only on verified yuyzdsnrbfhkmfzpvhwx; not an automatic migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(7310031);
LOCK TABLE public.application_resume_tokens IN ACCESS EXCLUSIVE MODE;
-- Deliberately no OR REPLACE / IF NOT EXISTS: drift or repeat stops safely.
CREATE FUNCTION private.recovery_cutover_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fence$
BEGIN
 RAISE EXCEPTION 'Recovery temporarily paused; retry after maintenance' USING ERRCODE='55000';
END;
$fence$;
REVOKE ALL ON FUNCTION private.recovery_cutover_fence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER recovery_cutover_rows BEFORE INSERT OR UPDATE OR DELETE
 ON public.application_resume_tokens FOR EACH ROW EXECUTE FUNCTION private.recovery_cutover_fence();
CREATE TRIGGER recovery_cutover_truncate BEFORE TRUNCATE
 ON public.application_resume_tokens FOR EACH STATEMENT EXECUTE FUNCTION private.recovery_cutover_fence();
ALTER TABLE public.application_resume_tokens ENABLE ALWAYS TRIGGER recovery_cutover_rows;
ALTER TABLE public.application_resume_tokens ENABLE ALWAYS TRIGGER recovery_cutover_truncate;
COMMIT;
-- This fences token storage even for service-role/BYPASSRLS and replica sessions.
-- It does NOT cancel already-minted HTTP/email work. Follow the drain gate.
