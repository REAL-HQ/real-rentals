-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('-- PROPOSED ', 'ONLY. Do not copy this file under supabase/migrations.');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1), hdr) OPERATOR(pg_catalog.=) 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 2), hdr) OPERATOR(pg_catalog.=) 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), 'c26189867b166b923619b3b95670e6044fb7a6c00703eea39f4ca0c4314a7374', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) 'c26189867b166b923619b3b95670e6044fb7a6c00703eea39f4ca0c4314a7374';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1, 4578), 'UTF8')), 'hex') OPERATOR(pg_catalog.=) '4eca4e74ba21b1cb8eaad795ea7b03fb7ce6bda0e5ea5bedf0c28234d31f566e';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s OPERATOR(pg_catalog.+) 1 OPERATOR(pg_catalog.+) 4578) OPERATOR(pg_catalog.~) '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
-- PROPOSED ONLY. Do not copy this file under supabase/migrations.
-- HOSTED-INSTALL step 28: proposed/m2-packet/return.sql. Apply after HOSTED-INSTALL step 27: proposed/m2-packet/extend.sql.
--
-- A manager's return checklist for an ended rental: time, odometer, fuel or
-- charge, exterior and interior marks, keys, tolls or tickets, and a deposit
-- decision note. The note is not a refund, a charge, or a deposit settlement.
--
-- Photos stay in the existing private bucket condition-media (public = false).
-- "Staff manage condition media objects" already covers that bucket for staff,
-- so this file adds no storage policy and no public URL.

CREATE TABLE IF NOT EXISTS public.return_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  returned_at timestamptz NOT NULL,
  odometer integer NOT NULL CHECK (odometer >= 0 AND odometer <= 2000000),
  fuel_or_charge text NOT NULL CHECK (fuel_or_charge IN ('empty', 'quarter', 'half', 'three_quarter', 'full')),
  keys_returned boolean NOT NULL,
  tolls_tickets_note text,
  deposit_decision_needed boolean NOT NULL DEFAULT false,
  deposit_decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS return_checklists_rental_idx
  ON public.return_checklists (rental_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.return_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.return_checklists(id) ON DELETE CASCADE,
  area text NOT NULL CHECK (area IN ('exterior', 'interior')),
  item_key text NOT NULL,
  label text NOT NULL,
  result text NOT NULL CHECK (result IN ('ok', 'damage', 'na')),
  notes text,
  UNIQUE (checklist_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.return_checklist_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.return_checklists(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'condition-media' CHECK (storage_bucket = 'condition-media'),
  storage_path text NOT NULL,
  angle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path !~* '^https?://')
);

GRANT SELECT, INSERT ON public.return_checklists TO authenticated;
GRANT SELECT, INSERT ON public.return_checklist_items TO authenticated;
GRANT SELECT, INSERT ON public.return_checklist_photos TO authenticated;
GRANT ALL ON public.return_checklists TO service_role;
GRANT ALL ON public.return_checklist_items TO service_role;
GRANT ALL ON public.return_checklist_photos TO service_role;

ALTER TABLE public.return_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_checklist_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read return checklists" ON public.return_checklists;
CREATE POLICY "Managers read return checklists" ON public.return_checklists
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklists" ON public.return_checklists;
CREATE POLICY "Managers insert return checklists" ON public.return_checklists
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Managers read return checklist items" ON public.return_checklist_items;
CREATE POLICY "Managers read return checklist items" ON public.return_checklist_items
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklist items" ON public.return_checklist_items;
CREATE POLICY "Managers insert return checklist items" ON public.return_checklist_items
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Managers read return checklist photos" ON public.return_checklist_photos;
CREATE POLICY "Managers read return checklist photos" ON public.return_checklist_photos
  FOR SELECT TO authenticated USING (private.is_manager());
DROP POLICY IF EXISTS "Managers insert return checklist photos" ON public.return_checklist_photos;
CREATE POLICY "Managers insert return checklist photos" ON public.return_checklist_photos
  FOR INSERT TO authenticated WITH CHECK (private.is_manager());

COMMENT ON TABLE public.return_checklists IS
  'Manager return closeout. deposit_decision_note is a note only. HOSTED-INSTALL step 28: proposed/m2-packet/return.sql.';
