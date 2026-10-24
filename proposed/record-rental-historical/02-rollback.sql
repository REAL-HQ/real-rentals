-- PROPOSED. Rollback of 01-historical-agreements-v1.sql. Owner approval required.
-- One transaction. Restores the two replaced functions to the exact text they had
-- when 01 was installed (captured in private.historical_agreements_v1_prior), then
-- removes everything 01 added. It refuses once any registration exists, voided or
-- not: those rows are staff-verified evidence and audit history, so after first use
-- the way back is a reviewed forward fix, never a drop.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.historical_agreements_v1) THEN
    RAISE EXCEPTION 'historical_agreements_in_use: rollback refused; registrations exist';
  END IF;
  IF (SELECT count(*) FROM private.historical_agreements_v1_prior) <> 2 THEN
    RAISE EXCEPTION 'historical_agreements_prior_definitions_missing';
  END IF;
END $$;
DROP TRIGGER historical_agreement_consume_v1 ON private.record_operations;
DO $$ DECLARE d text; BEGIN
  FOR d IN SELECT definition FROM private.historical_agreements_v1_prior ORDER BY fn LOOP EXECUTE d; END LOOP;
END $$;
DROP FUNCTION public.register_historical_agreement_v1(uuid, uuid, uuid, uuid, date, timestamptz, numeric, numeric, text);
DROP FUNCTION public.void_historical_agreement_v1(uuid, text);
DROP FUNCTION public.historical_agreement_for_record_v1(uuid);
DROP FUNCTION private.historical_agreement_consume_v1();
DROP FUNCTION private.historical_agreement_result_v1(private.historical_agreements_v1, boolean);
DROP TABLE private.historical_agreements_v1;
DROP FUNCTION private.historical_agreement_guard_v1();
DROP FUNCTION private.historical_agreement_no_truncate_v1();
DROP TABLE private.historical_agreements_v1_prior;
COMMIT;
