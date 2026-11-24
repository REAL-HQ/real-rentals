-- Pending Reservation backfill. NOT a migration. Do not apply with the app.
-- Review the preview, then run the write section by hand if it is right.
--
-- A lead who signed and paid the Reservation Fee, and has a car on
-- applications.vehicle_id, but has no open rental, gets one
-- pending_reservation row and the car leaves Available.
-- Motivating case: Fabio application d81604fe-… / vehicle 02f8bac0-….
-- The preview matches those prefixes and every other lead in the same state.
--
-- Skips a lead with no portal user id (rentals.driver_id is required), a
-- blacklisted renter, a car that is not free, and a lead who already has
-- a reserved, on-hold, active, or pending rental.
-- No phone numbers are selected or written.

-- ---------------------------------------------------------------------------
-- 1. Preview: what would change. Run this first. It writes nothing.
-- ---------------------------------------------------------------------------
WITH paid AS (
  SELECT DISTINCT ON (p.driver_id)
    p.id AS payment_id,
    p.driver_id AS application_id,
    p.amount,
    p.notes
  FROM public.payments p
  WHERE p.reason = 'reservation_fee'
    AND p.status = 'paid'
    AND COALESCE(p.refunded_amount, 0) = 0
    AND p.notes NOT LIKE '%kept:%'
    AND p.notes NOT LIKE '%credited_week1:%'
  ORDER BY p.driver_id, p.paid_date DESC NULLS LAST, p.created_at DESC
),
signed AS (
  SELECT DISTINCT ON (a.application_id)
    a.application_id,
    a.id AS agreement_id,
    a.signed_at
  FROM public.agreements a
  WHERE a.status = 'signed'
    AND a.voided_at IS NULL
    AND COALESCE(a.metadata ->> 'amendment', '') = ''
  ORDER BY a.application_id, a.signed_at DESC NULLS LAST
),
open_rental AS (
  SELECT r.application_id
  FROM public.rentals r
  WHERE r.status IN ('reserved', 'on_hold', 'active', 'pending_reservation')
)
SELECT
  app.id AS application_id,
  app.full_name,
  app.user_id AS driver_user_id,
  app.vehicle_id,
  v.status AS vehicle_status,
  v.license_plate,
  right(regexp_replace(upper(COALESCE(v.vin, '')), '[^A-Z0-9]', '', 'g'), 6) AS vin_last_6,
  paid.payment_id,
  paid.amount AS reservation_fee,
  signed.agreement_id,
  CASE
    WHEN app.user_id IS NULL THEN 'skip: no portal user'
    WHEN app.vehicle_id IS NULL THEN 'skip: no vehicle'
    WHEN v.id IS NULL THEN 'skip: vehicle missing'
    WHEN v.archived_at IS NOT NULL OR v.status IN ('archived', 'sold', 'retired', 'rented', 'unavailable', 'for_sale', 'reserved', 'pending_reservation') THEN 'skip: vehicle not free'
    WHEN EXISTS (
      SELECT 1 FROM public.renter_blacklist b
      WHERE b.application_id = app.id AND b.removed_at IS NULL
    ) THEN 'skip: blacklisted'
    ELSE 'would hold: pending_reservation'
  END AS change
FROM paid
JOIN signed ON signed.application_id = paid.application_id
JOIN public.applications app ON app.id = paid.application_id AND app.deleted_at IS NULL
LEFT JOIN public.vehicles v ON v.id = app.vehicle_id
WHERE app.status IN ('approved', 'active')
  AND NOT EXISTS (SELECT 1 FROM open_rental o WHERE o.application_id = app.id)
ORDER BY app.full_name, app.id;

-- ---------------------------------------------------------------------------
-- 2. Write. Review the preview, then run this block once.
--    It inserts one pending rental and sets the free car to pending_reservation.
-- ---------------------------------------------------------------------------
/*
WITH paid AS (
  SELECT DISTINCT ON (p.driver_id)
    p.id AS payment_id,
    p.driver_id AS application_id,
    p.amount
  FROM public.payments p
  WHERE p.reason = 'reservation_fee'
    AND p.status = 'paid'
    AND COALESCE(p.refunded_amount, 0) = 0
    AND p.notes NOT LIKE '%kept:%'
    AND p.notes NOT LIKE '%credited_week1:%'
  ORDER BY p.driver_id, p.paid_date DESC NULLS LAST, p.created_at DESC
),
signed AS (
  SELECT DISTINCT ON (a.application_id) a.application_id, a.id AS agreement_id
  FROM public.agreements a
  WHERE a.status = 'signed' AND a.voided_at IS NULL
    AND COALESCE(a.metadata ->> 'amendment', '') = ''
  ORDER BY a.application_id, a.signed_at DESC NULLS LAST
),
candidates AS (
  SELECT
    app.id AS application_id,
    app.user_id,
    app.vehicle_id,
    COALESCE(v.weekly_rate, 0) AS weekly_rate,
    paid.payment_id,
    paid.amount,
    signed.agreement_id
  FROM paid
  JOIN signed ON signed.application_id = paid.application_id
  JOIN public.applications app ON app.id = paid.application_id AND app.deleted_at IS NULL
  JOIN public.vehicles v ON v.id = app.vehicle_id
  WHERE app.status IN ('approved', 'active')
    AND app.user_id IS NOT NULL
    AND v.archived_at IS NULL
    AND v.status IN ('available', 'onboarding')
    AND NOT EXISTS (
      SELECT 1 FROM public.rentals r
      WHERE r.application_id = app.id
        AND r.status IN ('reserved', 'on_hold', 'active', 'pending_reservation')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.rentals r
      WHERE r.vehicle_id = app.vehicle_id
        AND r.status IN ('reserved', 'on_hold', 'active', 'pending_reservation')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.renter_blacklist b
      WHERE b.application_id = app.id AND b.removed_at IS NULL
    )
),
inserted AS (
  INSERT INTO public.rentals (
    driver_id, vehicle_id, application_id, start_date, status, weekly_rate,
    deposit_amount, deposit_held,
    reservation_note,
    reservation_deposit_required, reservation_deposit_amount,
    reservation_deposit_status, reservation_deposit_payment_id
  )
  SELECT
    c.user_id, c.vehicle_id, c.application_id, (now() AT TIME ZONE 'America/New_York')::date,
    'pending_reservation', c.weekly_rate,
    0, false,
    '{"reservation_details":1,"pending_reservation":true,"pickup_time":null,"pickup_location":null,"note":null}',
    true, c.amount, 'applied', c.payment_id
  FROM candidates c
  RETURNING id, application_id, vehicle_id, reservation_deposit_payment_id
)
UPDATE public.vehicles v
SET status = 'pending_reservation'
FROM inserted i
WHERE v.id = i.vehicle_id
  AND v.status IN ('available', 'onboarding');

-- Then point the fee and the signed agreement at the new rental:
-- UPDATE public.payments p SET rental_id = i.id
-- FROM inserted i WHERE p.id = i.reservation_deposit_payment_id AND p.rental_id IS NULL;
-- UPDATE public.agreements a SET rental_id = i.id
-- FROM inserted i
-- JOIN candidates c ON c.application_id = i.application_id
-- WHERE a.id = c.agreement_id AND a.rental_id IS NULL;
*/
