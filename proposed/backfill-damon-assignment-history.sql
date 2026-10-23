-- LIVE DATA. NOT EXECUTED. OWNER APPROVAL REQUIRED.
-- One-time history for the rental this file is named for.
-- Do not run against a hosted database without a separate owner approval
-- after the live rows have actually been read.
--
-- Rows this script would insert: none.
-- Live rental and vehicle records were not readable when this file was
-- written. Production refused the read. Staging is not the fleet.
-- The open rental's current vehicle must not be backdated as the original
-- car, and earlier intervals must not be invented.
--
-- Owner worksheet, comments only. Fill these from the live rows before any
-- future revision. Record ids only. No names, emails, or phone numbers.
-- rental id: unread
-- application id: unread
-- original vehicle id: unread
-- later vehicle ids: unread
-- open assignment id: unread

DO $$
BEGIN
 RAISE EXCEPTION 'backfill_refused_live_records_unread';
END $$;
