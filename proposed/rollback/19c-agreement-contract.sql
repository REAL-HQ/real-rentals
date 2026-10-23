-- Rollback for 19c-agreement-contract.sql. Restores the step 19b deny-all adapter.
-- Run after step 20's rollback and before proposed/rollback/19b-agreement-evidence.sql.
BEGIN;
CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) RETURNS uuid
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) TO rr_record_executor;
COMMIT;
