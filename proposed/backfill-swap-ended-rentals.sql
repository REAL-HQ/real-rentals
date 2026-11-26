-- PROPOSED, NOT APPLIED. Do not run this against production, staging, or any
-- shared database until the SELECT below has been reviewed row by row.
--
-- What the swap writer actually does
--   public.complete_rental_vehicle_swap_tx (latest body:
--   supabase/migrations/20261121070000_swap_insurance_optional.sql) does not
--   cancel the old rental and does not set end_date. There is no ended_at
--   column on rentals. The same rental stays status = 'active'. vehicle_id
--   moves to the replacement car. The end of the outgoing car is
--   rental_vehicle_swaps.completed_at. The reason is already
--   rental_vehicle_swaps.reason_code and reason (written when the swap is
--   sent). Billing is not touched. No change to that function is in this
--   file: it already records the end instant and the reason.
--
-- What this backfill would change
--   A Past-tab row that reads Cancelled with no end date, and that the app
--   now shows as Swap, is a different rentals row that still names
--   from_vehicle_id (typically a leftover reservation cancelled with no
--   end_date). This UPDATE sets that row's end_date to the swap's completion
--   date in America/New_York. It does not change status, does not insert a
--   rental, and does not copy the reason onto rentals — the reason stays on
--   the swap row, which is what the Past tab reads.
--
-- The SELECT is the list of live rows the UPDATE would touch. Run only the
-- SELECT first. If it returns nothing, there is nothing to backfill.

-- ---------------------------------------------------------------------
-- 0) Read-only. Every row the UPDATE below would change.
-- ---------------------------------------------------------------------
WITH completed AS (
  SELECT s.id,
         s.swap_number,
         s.rental_id,
         s.application_id,
         s.from_vehicle_id,
         s.completed_at,
         s.reason_code,
         s.reason,
         (s.completed_at AT TIME ZONE 'America/New_York')::date AS swap_end_date
    FROM public.rental_vehicle_swaps s
   WHERE s.status = 'completed'
     AND s.completed_at IS NOT NULL
),
candidates AS (
  SELECT r.id AS rental_id,
         r.status,
         r.start_date,
         r.end_date,
         r.vehicle_id,
         r.application_id,
         a.full_name,
         v.unit_number,
         v.license_plate,
         right(regexp_replace(upper(coalesce(v.vin, '')), '[^A-Z0-9]', '', 'g'), 6) AS vin_last6,
         c.id AS swap_id,
         c.swap_number,
         c.rental_id AS continuing_rental_id,
         c.completed_at,
         c.swap_end_date,
         c.reason_code,
         c.reason,
         cont.start_date AS continuing_start,
         cont.status AS continuing_status
    FROM public.rentals r
    JOIN completed c
      ON c.application_id = r.application_id
     AND c.from_vehicle_id = r.vehicle_id
    LEFT JOIN public.rentals cont ON cont.id = c.rental_id
    LEFT JOIN public.applications a ON a.id = r.application_id
    LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
   WHERE r.status IN ('cancelled', 'canceled', 'void', 'voided')
     AND (r.start_date IS NULL OR r.start_date <= c.swap_end_date)
     AND (r.end_date IS NULL OR r.end_date >= c.swap_end_date)
     AND (
       r.id = c.rental_id
       OR cont.start_date IS NULL
       OR r.start_date IS NULL
       OR r.start_date >= cont.start_date
     )
),
ranked AS (
  SELECT *,
         row_number() OVER (
           PARTITION BY swap_id
           ORDER BY (rental_id = continuing_rental_id) DESC,
                    start_date DESC NULLS LAST,
                    rental_id DESC
         ) AS swap_rank
    FROM candidates
),
claimed AS (
  SELECT DISTINCT ON (rental_id) *
    FROM ranked
   WHERE swap_rank = 1
   ORDER BY rental_id, completed_at
)
SELECT rental_id, full_name, status, start_date, end_date,
       unit_number, license_plate, vin_last6,
       swap_id, swap_number, continuing_rental_id, continuing_status,
       completed_at, swap_end_date, reason_code, reason
  FROM claimed
 WHERE end_date IS NULL
 ORDER BY full_name NULLS LAST, start_date;

-- Jonathon Boykins, if a matching row exists. Same rules as the list above.
-- Application id from the Nov 18 2026 readiness notes:
--   802fb55c-d7e8-45ae-9b40-dc5efa74753f
-- This does not write.
SELECT r.id AS rental_id, r.status, r.start_date, r.end_date,
       v.unit_number, v.license_plate,
       s.swap_number, s.status AS swap_status, s.completed_at, s.reason_code, s.reason,
       s.rental_id AS continuing_rental_id, s.from_vehicle_id
  FROM public.rentals r
  JOIN public.applications a ON a.id = r.application_id
  LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
  LEFT JOIN public.rental_vehicle_swaps s
    ON s.application_id = r.application_id
   AND s.from_vehicle_id = r.vehicle_id
   AND s.status = 'completed'
 WHERE a.full_name ILIKE '%Boykins%'
 ORDER BY r.start_date, s.completed_at;

-- ---------------------------------------------------------------------
-- 1) UPDATE. Do not run until the SELECT is reviewed.
--    Sets end_date only, and only where it is still null.
-- ---------------------------------------------------------------------
UPDATE public.rentals r
   SET end_date = x.swap_end_date,
       updated_at = now()
  FROM (
    WITH completed AS (
      SELECT s.id, s.rental_id, s.application_id, s.from_vehicle_id, s.completed_at,
             (s.completed_at AT TIME ZONE 'America/New_York')::date AS swap_end_date
        FROM public.rental_vehicle_swaps s
       WHERE s.status = 'completed' AND s.completed_at IS NOT NULL
    ),
    candidates AS (
      SELECT r.id AS rental_id, r.start_date, c.id AS swap_id, c.swap_end_date,
             c.completed_at, c.rental_id AS continuing_rental_id
        FROM public.rentals r
        JOIN completed c
          ON c.application_id = r.application_id
         AND c.from_vehicle_id = r.vehicle_id
        LEFT JOIN public.rentals cont ON cont.id = c.rental_id
       WHERE r.status IN ('cancelled', 'canceled', 'void', 'voided')
         AND r.end_date IS NULL
         AND (r.start_date IS NULL OR r.start_date <= c.swap_end_date)
         AND (
           r.id = c.rental_id
           OR cont.start_date IS NULL
           OR r.start_date IS NULL
           OR r.start_date >= cont.start_date
         )
    ),
    ranked AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY swap_id
               ORDER BY (rental_id = continuing_rental_id) DESC,
                        start_date DESC NULLS LAST,
                        rental_id DESC
             ) AS swap_rank
        FROM candidates
    )
    SELECT DISTINCT ON (rental_id) rental_id, swap_end_date
      FROM ranked
     WHERE swap_rank = 1
     ORDER BY rental_id, completed_at
  ) x
 WHERE r.id = x.rental_id
   AND r.end_date IS NULL
   AND r.status IN ('cancelled', 'canceled', 'void', 'voided');
