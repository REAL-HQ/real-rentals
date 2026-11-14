-- PREPARED, NOT RUN. Needs Dolmar's approval, and only AFTER
-- supabase/migrations/20261109190000_renter_reimbursements.sql is applied.
--
-- Moves the three renter reimbursements logged on 11/9/2026 out of
-- vehicle_expenses into renter_reimbursements, then removes those three
-- expense rows. Damon's $35 Uber row (df388dd5-e9cd-4752-95a2-9b1293fc7580)
-- is a business expense and is NOT touched.
--
-- Idempotent: source_expense_id is UNIQUE and the insert skips rows already
-- moved; the delete only removes expense rows that now have a copy.
-- Expect: INSERT 3 (or 0 on a re-run), DELETE 3 (or 0).
BEGIN;

INSERT INTO public.renter_reimbursements
  (application_id, rental_id, vehicle_id, paid_on, amount, method, reference, reason, notes, source_expense_id, created_by, created_at)
SELECT r.application_id, e.rental_id, e.vehicle_id, e.incurred_on, e.amount,
       CASE e.payment_method WHEN 'Zelle' THEN 'zelle' WHEN 'Cash App' THEN 'cash_app' ELSE 'other' END,
       e.reference, 'lost_revenue', e.notes, e.id, e.created_by, e.created_at
FROM public.vehicle_expenses e
JOIN public.rentals r ON r.id = e.rental_id
WHERE e.id IN ('1ca2f652-d50e-4734-b5ef-a171cd24d97f',  -- Damon  $50  2026-10-17 Zelle WFCT22S7BJM2
               'c27530ff-88c4-43c4-923d-81ecfc3dbb0b',  -- Regina $50  2026-10-19 Cash App
               '6a22b6e0-4527-4267-91aa-1b5458e19446')  -- Regina $50  2026-10-20 Cash App
ON CONFLICT (source_expense_id) DO NOTHING;

-- Only delete what is now safely copied.
DELETE FROM public.vehicle_expenses e
WHERE e.id IN ('1ca2f652-d50e-4734-b5ef-a171cd24d97f',
               'c27530ff-88c4-43c4-923d-81ecfc3dbb0b',
               '6a22b6e0-4527-4267-91aa-1b5458e19446')
  AND EXISTS (SELECT 1 FROM public.renter_reimbursements rr WHERE rr.source_expense_id = e.id);

-- Read back: expect 3 reimbursements totalling 150.00, and the Uber row still present.
SELECT id, application_id, paid_on, amount, method, reference, reason FROM public.renter_reimbursements ORDER BY paid_on;
SELECT id, amount, description FROM public.vehicle_expenses WHERE id = 'df388dd5-e9cd-4752-95a2-9b1293fc7580';

COMMIT;
