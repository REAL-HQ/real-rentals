-- PROPOSED DATA FIX. DO NOT RUN until Dolmar approves AND migration
-- 20261122143000_collections.sql is applied. Nothing here touches Stripe or sends anything.
--
-- Moves Heather Bell's balance (rental 36973513, CZO7DA, VIN ...118769) into Collections and
-- records the repossession with the proposed repo date below.
--
-- WHAT SHE OWES TODAY (read-only check of production, Nov 22 2026 ~9:45 AM ET)
--   payments 400fe56c  Rent, due Nov 17, $350, late_fees $100 (applied through Nov 19), balance $450,
--                      status Overdue, Stripe invoice in_1UcoXLGsNNO50lXbzxegwqAM (still open in Stripe)
--   payments c697326e  Fee "Replacement key", due Nov 19, $150, status Unpaid
--   rentals.balance_due_cents = 60000 ($600)
--   vehicle_expenses e58c562e ($150, "Replacement key") is OUR cost of the key, not a second charge
--   to her. Her key charge is payments c697326e only, so it becomes ONE Key Replacement line.
--
-- REPO DATE: PROPOSED Thu Nov 19, 2026 = day 3 of the missed week (Nov 17, 18, 19)
--   Evidence (all read-only):
--   * One Step GPS (FLEET reports): CZO7DA drove all day Nov 17 (Lakeland, Seffner/I-4 at 58-61 mph
--     around 8 PM) and parked at 4335 Williamstown Blvd, Lakeland (hotel) at 9:02 PM Nov 17.
--   * Starter disabled Nov 19 4:48 AM ET (FLEET, Dolmar-approved), still at the hotel. FLEET then
--     reported her driving despite the disabled starter on Nov 19 (Bartow ~12:31 PM, Winter Haven
--     ~2:00-2:30 PM, Lakeland N Rd 98 ~7:55 PM), so she still had the car on Nov 19.
--   * One Step alerts: starter disable/enable events on CZO7DA Nov 19 between 8:41 and 10:46 PM ET.
--   * Dolmar in FLEET's chat on the night of Nov 19 (after 10:48 PM ET): "I was able to do a repo on
--     Heathers car tonight with our spare key."
--   * audit_log 4ca52c6b (Nov 19 10:55 PM ET): rental closed via end_rental_tx, close_reason
--     repossessed, end_date 2026-11-19, "Repossessed by owner Nov 19 2026 with spare key".
--   * FLEET's 8 PM Nov 20 GPS check shows CZO7DA at 3616 E Hillsborough Ave, Tampa (in our hands).
--   Conclusion: secured the night of Nov 19 = day 3. If Dolmar says day 2, change the date to
--   2026-11-18 below (or edit the repo date in Payments > Collections afterwards; it recalculates).
--
-- RESULT WITH REPO DATE NOV 19 (day 3)
--   Unpaid Rent, week of Nov 17: $350 / 7 x 3 days = $150.00 (replaces $350.00)
--   Late Fees on Nov 17 rent: $100.00 (in full; $50/day for Nov 18 and 19, under the $350 cap)
--   Key Replacement: $150.00
--   Total owed in Collections: $400.00 (was $600.00). Days late on the repo date: 2.
--   (With Nov 18 / day 2 instead: rent $100.00, total $350.00, days late 1.)
--
-- SIDE EFFECTS
--   * payments 400fe56c and c697326e become status 'collections': off the Overdue filter, the
--     Outstanding total, the Overview Collections card and all automatic past-due/late-fee/reminder
--     texts and emails; no more late fees accrue on them.
--   * rentals 36973513: close_reason 'repossessed', repossessed_on, days_late_at_repo set;
--     balance_due_cents set to the Collections total (40000) so the Past tab agrees.
--   * Stripe invoice in_1UcoXL stays open in Stripe (not touched). If it is ever paid ($350), the
--     webhook marks payments 400fe56c paid and that row's lines are paid automatically: $150 rent,
--     then $100 late fees. The other $100 is left unapplied for staff to review (it is never spilled
--     onto the key line automatically, to rule out double counting). Whether to void or leave that
--     invoice is Dolmar's call; per his rule a separately paid invoice is marked paid_out_of_band,
--     never voided.
--   * Every change is logged in collection_item_events and audit_log as the Owner account.
-- Refuses (and changes nothing) unless exactly one closed Heather Bell rental matches.
-- Safe to re-run: items are created once per payments row; the proration is recomputed, not stacked.

BEGIN;

DO $$
DECLARE
  rid uuid;
  n int;
  owner_id uuid;
  repo_date constant date := DATE '2026-11-19';  -- PROPOSED (day 3). Use 2026-11-18 for day 2.
  res jsonb;
  total numeric;
BEGIN
  IF to_regclass('public.collection_items') IS NULL THEN
    RAISE EXCEPTION 'Apply migration 20261122143000_collections.sql first';
  END IF;

  SELECT count(*), min(r.id::text)::uuid INTO n, rid
  FROM public.rentals r JOIN public.applications a ON a.id = r.application_id
  WHERE r.id::text LIKE '36973513%' AND r.status = 'closed'
    AND a.full_name ILIKE '%heather%' AND a.full_name ILIKE '%bell%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one closed Heather Bell rental 36973513..., found %', n;
  END IF;

  SELECT ur.user_id INTO owner_id
  FROM public.user_roles ur LEFT JOIN auth.users u ON u.id = ur.user_id
  WHERE ur.role::text = 'admin'
  ORDER BY (lower(coalesce(u.email, '')) IN ('dolmarcross@gmail.com', 'dolmar@drivereal.com')) DESC, ur.created_at NULLS LAST
  LIMIT 1;

  -- Moves her open rows (rent principal, its late fees, the key fee) and prorates the missed week.
  res := public.record_rental_repossession(rid, repo_date, owner_id,
    'Backfill (proposed/collections/01-heather-bell-collections.sql): repossessed with spare key the night of Nov 19, 2026; main key not recovered');

  -- The key fee row's reason is "Replacement key"; make sure its line reads Key Replacement.
  UPDATE public.collection_items SET reason = 'key_replacement'
  WHERE rental_id = rid AND source_kind = 'payment' AND reason <> 'key_replacement'
    AND source_payment_id IN (SELECT id FROM public.payments WHERE rental_id = rid AND type = 'fee' AND reason ILIKE '%key%');

  SELECT coalesce(sum(amount - amount_paid), 0) INTO total FROM public.collection_items
  WHERE rental_id = rid AND public.collection_status_is_open(status);
  UPDATE public.rentals SET balance_due_cents = round(total * 100)::int WHERE id = rid;

  RAISE NOTICE 'Heather Bell: % ; Collections total now $%', res, total;
END $$;

COMMIT;
