-- Additive identity-review audit protection, ordered after unchanged 0022.
-- Transaction control belongs exclusively to the migration runner.
-- No historical data rewrite and no automatic deletion or anonymization.
-- Provisional seven-year identity-audit retention is subject to legal review;
-- it does not authorize deletion at expiry or permanent indefinite retention.
-- Auth-user deletion may fail when ON DELETE SET NULL touches protected history.
-- Future deletion/minimization requires a separately approved workflow.
-- Owners/superusers remain trusted DDL principals; this is not tamper-proof storage.
CREATE FUNCTION private.guard_identity_audit_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Audit history cannot be truncated' USING ERRCODE = '42501';
  END IF;
  IF left(OLD.action, 16) = 'identity_review.' THEN
    RAISE EXCEPTION 'Identity audit history is append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF left(NEW.action, 16) = 'identity_review.' THEN
      RAISE EXCEPTION 'Identity audit events must be appended' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_identity_audit_history() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER identity_audit_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.guard_identity_audit_history();
CREATE TRIGGER identity_audit_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.guard_identity_audit_history();
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER identity_audit_append_only;
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER identity_audit_no_truncate;

-- Whole-table truncation cannot selectively preserve identity events.
REVOKE TRUNCATE ON public.audit_log FROM PUBLIC, anon, authenticated, service_role;
