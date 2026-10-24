-- PROPOSED BACKFILL PLAN. LIVE DATA. NOT EXECUTED. OWNER APPROVAL REQUIRED.
-- Historical vehicle intervals for rentals that changed cars before
-- booking_vehicle_assignments existed.
-- Do not run this file against a hosted database. It inserts nothing.
--
-- Why a backfill is not in the swap install:
-- swap_rental_vehicle_tx refuses an effective time that is not after the
-- single open assignment. It will not pretend the rental's current
-- vehicle_id was the original car, and it will not invent earlier intervals.
-- Rows that already happened have to be copied from records an owner has
-- read. Those records were not read for this file. Staging is not the fleet.
--
-- What a future revision may insert, only after a separate owner approval
-- and only from rows that were actually read:
--   1. One closed booking_vehicle_assignments row per earlier car, with
--      started_at and ended_at taken from the rental and the swap record.
--      Record ids only. No names, emails, or phone numbers in this file.
--   2. One private.assignment_closures row per closed interval, reason
--      copied from the staff note, not guessed.
--   3. The open interval is the rental's current vehicle, starting when
--      the last recorded change happened. Do not backdate that car to the
--      rental start.
--   4. Do not update rentals.vehicle_id, vehicles.status, payments,
--      deposits, agreements, or Stripe.
--   5. Wait for proposed/m2-packet/20.sql (HOSTED-INSTALL step 26).
--      Do not run this until that file is installed.
--
-- Owner worksheet, comments only. Leave unread until the live rows are read.
-- rental id: unread
-- application id: unread
-- original vehicle id: unread
-- later vehicle ids: unread
-- open assignment id: unread
--
-- Rows this script inserts: none.

DO $$
BEGIN
 RAISE EXCEPTION 'backfill_refused_live_records_unread';
END $$;
