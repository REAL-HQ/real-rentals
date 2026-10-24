-- PROPOSED. Revokes the evidence gateway key immediately. Owner approval required.
-- Every gateway call is refused (gateway_not_provisioned) until 02 sets a new key; the
-- RPCs and their grants stay installed. Use on any suspicion the key has leaked, then
-- remove RECORD_RENTAL_EVIDENCE_GATEWAY_KEY from the Lovable Cloud secrets.
BEGIN;
INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary, metadata)
SELECT NULL, 'record_gateway.key_revoked', 'security_setting', 'record_evidence_gateway',
  'Record Rental evidence gateway key revoked',
  jsonb_build_object('key_id', left(encode(pg_catalog.sha256(key), 'hex'), 12), 'executor', current_user)
FROM private.record_gateway_key_v1;
DELETE FROM private.record_gateway_key_v1;
DELETE FROM private.record_gateway_nonce_v1;
COMMIT;
