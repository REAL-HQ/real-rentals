-- Rollback for HOSTED-INSTALL step 25: proposed/m2-with-approval-boundary/19c-agreement-contract.sql
-- Restores the deny-all adapter from HOSTED-INSTALL step 24: proposed/m2-packet/19b.sql. Run after proposed/rollback/20-vehicle-swap.sql and before proposed/rollback/19b-agreement-evidence.sql.
BEGIN;
CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) RETURNS uuid
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'agreement_contract_unverified' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric) TO rr_record_executor;
COMMIT;
