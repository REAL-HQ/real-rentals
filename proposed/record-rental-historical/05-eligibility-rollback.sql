-- PROPOSED. Rollback of 04-eligibility-v1.sql. Owner approval required. One transaction.
-- Restores the five replaced functions to their exact text from before 04 (captured in
-- private.historical_eligibility_v1_prior) and removes what 04 added. It refuses once a
-- legacy-eSign registration exists: that row is staff-verified evidence and audit
-- history, and dropping its columns would lose it. Paper registrations are untouched.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.historical_agreements_v1 WHERE source <> 'paper') THEN
    RAISE EXCEPTION 'legacy_registrations_exist: rollback refused';
  END IF;
  IF (SELECT count(*) FROM private.historical_eligibility_v1_prior) <> 5 THEN
    RAISE EXCEPTION 'eligibility_prior_definitions_missing';
  END IF;
END $$;
DROP FUNCTION public.register_legacy_esign_agreement_v1(uuid, uuid, uuid, timestamptz, numeric, numeric, text);
DO $$ DECLARE d text; BEGIN
  FOR d IN SELECT definition FROM private.historical_eligibility_v1_prior ORDER BY fn LOOP EXECUTE d; END LOOP;
END $$;
DROP FUNCTION private.register_historical_core_v1(uuid, uuid, uuid, uuid, date, timestamptz, numeric, numeric, text, uuid);
DROP FUNCTION private.agreement_open_v1(uuid, text, timestamptz);
-- historical_agreement_result_v1 reads the row type; restore 01's text before dropping columns.
CREATE OR REPLACE FUNCTION private.historical_agreement_result_v1(h private.historical_agreements_v1, recovered boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('contract', 'historical-agreement-v1', 'historicalAgreementId', h.id,
    'status', CASE WHEN h.status = 'voided' THEN 'voided' WHEN h.rental_id IS NOT NULL THEN 'recorded' ELSE 'registered' END,
    'verification', h.verification, 'applicationId', h.application_id, 'vehicleId', h.vehicle_id,
    'documentId', h.document_id, 'documentSha256', h.document_sha256, 'signedOn', h.signed_on,
    'rentalStart', h.rental_start, 'weeklyCents', h.weekly_cents, 'depositCents', h.deposit_cents,
    'currency', h.currency, 'termsSummary', h.terms_summary, 'registeredBy', h.registered_by,
    'registeredAt', h.registered_at, 'rentalId', h.rental_id, 'recovered', recovered)
$$;
ALTER TABLE private.historical_agreements_v1
  DROP CONSTRAINT historical_agreements_v1_legacy_shape,
  DROP COLUMN legacy_signed_at, DROP COLUMN legacy_agreement_id, DROP COLUMN source;
DROP TABLE private.historical_eligibility_v1_prior;
COMMIT;
