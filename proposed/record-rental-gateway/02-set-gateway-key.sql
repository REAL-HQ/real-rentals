-- PROPOSED. Sets (or rotates) the evidence gateway key. Owner approval required.
-- Run with the hex printed by scripts/record-rental-gateway-key.mjs on the Owner's
-- machine; put the same hex in the Lovable Cloud secret RECORD_RENTAL_EVIDENCE_GATEWAY_KEY.
-- Never commit the key, paste it into chat, or keep it in a file. Rotation: run again
-- with a new key, then update the secret; requests signed with the old key are refused.
--   psql -v gateway_key_hex=<hex> -f 02-set-gateway-key.sql
BEGIN;
INSERT INTO private.record_gateway_key_v1 (id, key) VALUES (true, decode(:'gateway_key_hex', 'hex'))
ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, created_at = clock_timestamp();
DELETE FROM private.record_gateway_nonce_v1;
COMMIT;
