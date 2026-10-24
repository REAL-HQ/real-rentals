-- PROPOSED. Rollback of 01-evidence-gateway-v1.sql (and the key from 02). Owner
-- approval required. One transaction. Removes both gateway RPCs, the check, the HMAC
-- helper, the key and the nonce table. Nothing else depends on them; evidence already
-- issued through the gateway stays valid, because it lives in the M2 tables.
BEGIN;
DROP FUNCTION public.record_evidence_gateway_v1(text, text, bigint, uuid, text);
DROP FUNCTION public.record_license_gateway_v1(text, text, bigint, uuid, text);
DROP FUNCTION private.record_gateway_check_v1(text, text, bigint, uuid, text);
DROP FUNCTION private.hmac_sha256_v1(bytea, bytea);
DROP TABLE private.record_gateway_key_v1;
DROP TABLE private.record_gateway_nonce_v1;
COMMIT;
