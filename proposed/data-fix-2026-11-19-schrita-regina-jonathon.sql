-- PROPOSED, NOT APPLIED. Production data fix, Nov 19 2026. Run only with
-- Dolmar's explicit approval, through Lovable query_database, one section at a time.
-- Every section: 0) backup SELECT (save the output), 1) backup copy, 2) change, 3) verify.
--
-- Rows read 11:05 AM ET Nov 19 2026. Each UPDATE is guarded on the values read
-- then, so a row that changed since updates nothing (check "rows affected").
--
-- NOT covered by SQL (Stripe, needs approval separately):
--   * Schrita: Stripe invoice in_1UcTbKGsNNO50lXbZvfhnC5J ($350) is still OPEN and
--     Stripe will retry it Fri Nov 20 ~12:23 PM ET -> a second $350 charge. She already
--     paid that week (pi_3UdKhDGsNNO50lXb0lSzNmHB, Nov 18 9:03 PM ET). Void it in Stripe
--     before then. (The site has no invoice.voided handler, so voiding changes no row.)
--   * Regina: invoice in_1UcS37GsNNO50lXbmWqL9CBh ($350, open, subscription paused with
--     behavior=void, no retry scheduled). Void it once the daily plan is confirmed.

-- =====================================================================
-- Backup table (once)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public._backup_20261119_payments AS
  SELECT now() AS backed_up_at, p.* FROM public.payments p WHERE false;
CREATE TABLE IF NOT EXISTS public._backup_20261119_rentals AS
  SELECT now() AS backed_up_at, r.* FROM public.rentals r WHERE false;

-- =====================================================================
-- A. Schrita Thomas (rental 49f6008f-bc8f-44f7-bd9a-82ded5e7d8af)
--    Apply her Nov 18 $350 Payment Link payment to the Nov 16 rent week,
--    clear the $50 late fee (she paid inside waiver 93f0e71e, Nov 16 waived
--    through Nov 18), void the duplicate Fee row, advance next due to Nov 23.
-- =====================================================================
-- 0) Backup select
SELECT id, type, status, amount, due_date, paid_date, late_fees, balance_due, stripe_invoice_id,
       stripe_payment_intent_id, stripe_charge_id, payment_method, stripe_paid_at, stripe_receipt_url, notes
  FROM public.payments WHERE id IN ('258e43e6-fac1-438a-b197-06d57985da4e','116c25bd-20d6-438a-94e9-464985ac0849');
SELECT id, next_payment_due, payment_status FROM public.rentals WHERE id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af';
SELECT id, due_date, waived_through, reason FROM public.rent_late_fee_waivers WHERE id = '93f0e71e-9fd8-41f1-af6e-5105ea83db56';

BEGIN;
-- 1) Backup copy
INSERT INTO public._backup_20261119_payments
  SELECT now(), p.* FROM public.payments p WHERE id IN ('258e43e6-fac1-438a-b197-06d57985da4e','116c25bd-20d6-438a-94e9-464985ac0849');
INSERT INTO public._backup_20261119_rentals
  SELECT now(), r.* FROM public.rentals r WHERE id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af';

-- 2a) Void the duplicate Fee row (payments are never deleted: zz_payments_delete_guard
--     says "void instead"). Clearing its Stripe ids frees the unique payment-intent and
--     charge indexes for the rent row; the ids stay in its notes and in the backup.
UPDATE public.payments
   SET status = 'void', balance_due = 0,
       stripe_payment_intent_id = NULL, stripe_charge_id = NULL,
       notes = 'Duplicate of rent row 258e43e6 (Nov 16 week); was pi_3UdKhDGsNNO50lXb0lSzNmHB, mis-typed Fee by the one-off webhook. Merged Nov 19 2026, approved by Dolmar <date/card>.',
       updated_at = now()
 WHERE id = '116c25bd-20d6-438a-94e9-464985ac0849'
   AND type = 'fee' AND status = 'paid' AND amount = 350
   AND stripe_payment_intent_id = 'pi_3UdKhDGsNNO50lXb0lSzNmHB';

-- 2b) Mark the Nov 16 rent week paid by that payment; late fee cleared per waiver.
UPDATE public.payments p
   SET status = 'paid',
       paid_date = '2026-11-18',
       late_fees = 0,
       balance_due = 0,
       late_fee_applied_through = NULL,
       stripe_payment_intent_id = b.stripe_payment_intent_id,
       stripe_charge_id = b.stripe_charge_id,
       stripe_customer_id = COALESCE(p.stripe_customer_id, b.stripe_customer_id),
       stripe_paid_at = b.stripe_paid_at,
       stripe_receipt_url = b.stripe_receipt_url,
       payment_method = COALESCE(b.payment_method, p.payment_method),
       notified_status = 'paid',
       failure_reason = NULL,
       notes = 'Paid Nov 18 2026 by Stripe Payment Link plink_1UdKfsGsNNO50lXbkP0hreuo (pi_3UdKhDGsNNO50lXb0lSzNmHB); merged from duplicate Fee row 116c25bd. $50 late fee cleared: paid inside waiver 93f0e71e (waived through Nov 18). Invoice in_1UcTbK to be voided in Stripe. Approved by Dolmar <date/card>.',
       updated_at = now()
  FROM (SELECT * FROM public._backup_20261119_payments WHERE id = '116c25bd-20d6-438a-94e9-464985ac0849' ORDER BY backed_up_at DESC LIMIT 1) b
 WHERE p.id = '258e43e6-fac1-438a-b197-06d57985da4e'
   AND p.status = 'overdue' AND p.amount = 350 AND p.due_date = '2026-11-16';

-- 2c) Rental: current, next rent Mon Nov 23.
UPDATE public.rentals
   SET next_payment_due = '2026-11-23', payment_status = 'current', updated_at = now()
 WHERE id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af'
   AND next_payment_due = '2026-11-16';

-- 3) Verify before COMMIT: one paid rent row due Nov 16 with pi_3UdKhD, the Fee row void, next due Nov 23.
SELECT id, type, status, amount, due_date, paid_date, late_fees, balance_due, stripe_payment_intent_id
  FROM public.payments WHERE rental_id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af' ORDER BY due_date;
SELECT next_payment_due, payment_status FROM public.rentals WHERE id = '49f6008f-bc8f-44f7-bd9a-82ded5e7d8af';
COMMIT;  -- or ROLLBACK if the verify output is wrong

-- =====================================================================
-- B. Regina (rental d8fbb519-db84-4b33-8669-7c62474d6bfd): $50/day rent
--    from Mon Nov 16. Retype her three $50 payments to Rent, record the daily
--    plan, close the weekly Nov 16 row the plan replaces (and its $50 late fee).
--    Result as of Nov 19 11 AM ET: Nov 16, 17, 18 paid; $50 due today; Current.
-- =====================================================================
-- 0) Backup select
SELECT id, type, reason, status, amount, due_date, paid_date, late_fees, balance_due, stripe_invoice_id, stripe_payment_intent_id, notes
  FROM public.payments WHERE rental_id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' ORDER BY due_date, created_at;
SELECT id, next_payment_due, payment_status, weekly_rate FROM public.rentals WHERE id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd';
SELECT key, value FROM public.app_settings WHERE key = 'daily_rent_plans';

BEGIN;
-- 1) Backup copy
INSERT INTO public._backup_20261119_payments
  SELECT now(), p.* FROM public.payments p
   WHERE id IN ('9d871c26-09b2-4647-b592-ddc2245d6b50','424e4d29-2606-4d38-8d4a-9e575a79a49d','5be946f6-3655-4684-8098-8a2c0718f4f3','39affb68-56ad-4af6-99fb-fcdb879b5b6a');
INSERT INTO public._backup_20261119_rentals
  SELECT now(), r.* FROM public.rentals r WHERE id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd';

-- 2a) Her $50 payments are daily rent, not fees (Dolmar t505u).
UPDATE public.payments
   SET type = 'rent', reason = 'Daily rent $50', updated_at = now()
 WHERE id IN ('9d871c26-09b2-4647-b592-ddc2245d6b50','424e4d29-2606-4d38-8d4a-9e575a79a49d','5be946f6-3655-4684-8098-8a2c0718f4f3')
   AND rental_id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' AND type = 'fee' AND amount = 50 AND status = 'paid';
-- expect 3 rows

-- 2b) Daily plan the app reads (src/lib/rent-standing.ts). Merges with any other plans.
INSERT INTO public.app_settings (key, value)
VALUES ('daily_rent_plans', jsonb_build_object('d8fbb519-db84-4b33-8669-7c62474d6bfd',
        jsonb_build_object('dailyRate', 50, 'startsOn', '2026-11-16', 'endsOn', NULL,
                           'note', 'Regina pays $50/day while weekly autopay sub_1URZk6 is paused (Dolmar t504u, Nov 19 2026)')))
ON CONFLICT (key) DO UPDATE
  SET value = COALESCE(public.app_settings.value, '{}'::jsonb) || EXCLUDED.value;

-- 2c) The weekly Nov 16 $350 row is replaced by the daily plan: owes nothing, $50 late fee removed.
UPDATE public.payments
   SET status = 'void', late_fees = 0, balance_due = 0, late_fee_applied_through = NULL,
       notes = 'Replaced by $50/day plan from Nov 16 2026 (Dolmar t504u). Was $350 overdue, $50 late fee. Stripe invoice in_1UcS37 to be voided. Approved by Dolmar <date/card>.',
       updated_at = now()
 WHERE id = '39affb68-56ad-4af6-99fb-fcdb879b5b6a'
   AND rental_id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' AND status = 'overdue' AND amount = 350 AND due_date = '2026-11-16';

-- 2d) Rental: today's day is the next one owed.
UPDATE public.rentals
   SET next_payment_due = '2026-11-19', payment_status = 'current', updated_at = now()
 WHERE id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' AND next_payment_due = '2026-11-16';

-- 3) Verify
SELECT id, type, status, amount, due_date, late_fees, balance_due FROM public.payments
 WHERE rental_id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd' AND due_date >= '2026-11-16' ORDER BY due_date;
SELECT value -> 'd8fbb519-db84-4b33-8669-7c62474d6bfd' FROM public.app_settings WHERE key = 'daily_rent_plans';
COMMIT;  -- or ROLLBACK

-- =====================================================================
-- C. Jonathon Boykins: his $50 (payments 03733dbe-a9c1-4eaf-9f42-2c04e386945a) is his
--    Reservation Fee. It already has reason 'reservation_fee', so the Payments page
--    in this PR shows and filters it as Reservation with NO data change.
--    Storing type = 'reservation' needs proposed/payments-type-reservation-v1.sql
--    first (the current check constraint rejects it); that migration backfills
--    this row and every other Reservation Fee row. Standalone, after the migration:
-- =====================================================================
-- SELECT id, type, reason, notes, amount, status FROM public.payments WHERE id = '03733dbe-a9c1-4eaf-9f42-2c04e386945a';
-- INSERT INTO public._backup_20261119_payments SELECT now(), p.* FROM public.payments p WHERE id = '03733dbe-a9c1-4eaf-9f42-2c04e386945a';
-- UPDATE public.payments SET type = 'reservation', updated_at = now()
--  WHERE id = '03733dbe-a9c1-4eaf-9f42-2c04e386945a' AND type = 'fee' AND reason = 'reservation_fee';

-- =====================================================================
-- Rollback (any section): restore from the backup copies, newest first.
-- =====================================================================
-- BEGIN;
-- -- Restore each changed payments row from its backup (Schrita: restore 116c25bd's
-- -- Stripe ids only after clearing them from 258e43e6, because of the unique indexes):
-- UPDATE public.payments p SET type = b.type, reason = b.reason, status = b.status, paid_date = b.paid_date,
--        late_fees = b.late_fees, balance_due = b.balance_due, late_fee_applied_through = b.late_fee_applied_through,
--        stripe_payment_intent_id = b.stripe_payment_intent_id, stripe_charge_id = b.stripe_charge_id,
--        stripe_paid_at = b.stripe_paid_at, stripe_receipt_url = b.stripe_receipt_url,
--        payment_method = b.payment_method, notified_status = b.notified_status, failure_reason = b.failure_reason, notes = b.notes
--   FROM (SELECT DISTINCT ON (id) * FROM public._backup_20261119_payments ORDER BY id, backed_up_at DESC) b
--  WHERE p.id = b.id;   -- run for 258e43e6 first, then 116c25bd
-- UPDATE public.rentals r SET next_payment_due = b.next_payment_due, payment_status = b.payment_status
--   FROM public._backup_20261119_rentals b WHERE r.id = b.id;
-- UPDATE public.app_settings SET value = value - 'd8fbb519-db84-4b33-8669-7c62474d6bfd' WHERE key = 'daily_rent_plans';
-- COMMIT;
