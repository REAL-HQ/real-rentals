-- Renter portal (PR D). Additive only: two new tables, private helpers and
-- SECURITY DEFINER reads that return the caller's own rows. No existing
-- policy, function, table or partner rule is changed. No cron, no pg_net.
--
-- Visibility (decided by private.renter_portal_stage):
--   assigned  rental exists, not active, not returned  -> plate + VIN only
--   active    status = 'active'                        -> + registration, own insurance,
--                                                          check-in/out photos, receipts
--   returned  end_date set or status returned/completed/ended/closed
--             -> photos + receipts of that rental until end_date + 1 year, then nothing
-- Cancelled rentals are ignored. Driver documents need 'driver' in
-- visibility. Vehicle paperwork is stored visibility {admin}; the ONLY
-- vehicle document a renter can open is the current 'registration' card of
-- the car on their ACTIVE rental. Title, finance, purchase and team originals
-- (vehicle-originals, vehicle_media) are never returned.

-- ---------------------------------------------------------------- vendors
CREATE TABLE public.renter_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN
    ('roadside','mechanic','car_wash','locksmith','towing','tire_shop','body_shop','glass','oil_change','other')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  website text CHECK (website IS NULL OR website ~* '^https?://'),
  address text CHECK (address IS NULL OR length(address) <= 300),
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  logo_url text CHECK (logo_url IS NULL OR logo_url ~* '^https://'),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX renter_vendors_order_idx ON public.renter_vendors (sort_order, name);
ALTER TABLE public.renter_vendors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renter_vendors FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.renter_vendors TO authenticated;

-- Any rental the caller has ever had (not cancelled).
CREATE OR REPLACE FUNCTION private.is_renter()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.driver_id = auth.uid()
      AND lower(coalesce(r.status,'')) NOT IN ('cancelled','canceled')
  )
$$;
REVOKE ALL ON FUNCTION private.is_renter() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_renter() TO authenticated, service_role;

CREATE POLICY "Staff manage renter vendors" ON public.renter_vendors
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Renters read active renter vendors" ON public.renter_vendors
  FOR SELECT TO authenticated USING (is_active AND private.is_renter());

-- ---------------------------------------------------------------- prefs
CREATE TABLE public.renter_portal_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_view text NOT NULL DEFAULT 'grid' CHECK (vendor_view IN ('grid','list')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.renter_portal_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renter_portal_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.renter_portal_prefs TO authenticated;
CREATE POLICY "Renters read own portal prefs" ON public.renter_portal_prefs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Renters insert own portal prefs" ON public.renter_portal_prefs
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Renters update own portal prefs" ON public.renter_portal_prefs
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------- stage
CREATE OR REPLACE FUNCTION private.renter_portal_stage(_status text, _end_date date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN lower(coalesce(_status,'')) IN ('cancelled','canceled') THEN 'none'
    WHEN lower(coalesce(_status,'')) IN ('returned','completed','ended','closed') THEN 'returned'
    WHEN lower(coalesce(_status,'')) = 'active' THEN 'active'
    WHEN _end_date IS NOT NULL AND _end_date < (now() AT TIME ZONE 'America/New_York')::date THEN 'returned'
    ELSE 'assigned'
  END
$$;
REVOKE ALL ON FUNCTION private.renter_portal_stage(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.renter_portal_stage(text, date) TO authenticated, service_role;

-- Rentals whose photos/receipts the caller may see right now.
CREATE OR REPLACE FUNCTION private.renter_visible_rental_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id FROM public.rentals r
  WHERE r.driver_id = auth.uid()
    AND (
      private.renter_portal_stage(r.status, r.end_date) = 'active'
      OR (private.renter_portal_stage(r.status, r.end_date) = 'returned'
          AND coalesce(r.end_date, r.updated_at::date) + interval '1 year'
              >= (now() AT TIME ZONE 'America/New_York')::date)
    )
$$;
REVOKE ALL ON FUNCTION private.renter_visible_rental_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.renter_visible_rental_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------- summary
CREATE OR REPLACE FUNCTION public.renter_portal_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _r record;
  _v record;
  _stage text;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;

  -- Current rental: active first, then assigned, then most recent returned.
  SELECT r.id, r.vehicle_id, r.application_id, r.status, r.start_date, r.end_date, r.updated_at,
         private.renter_portal_stage(r.status, r.end_date) AS stage
    INTO _r
    FROM public.rentals r
   WHERE r.driver_id = _uid
     AND private.renter_portal_stage(r.status, r.end_date) <> 'none'
   ORDER BY CASE private.renter_portal_stage(r.status, r.end_date)
              WHEN 'active' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
            r.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('stage','none'); END IF;
  _stage := _r.stage;

  IF _stage IN ('assigned','active') AND _r.vehicle_id IS NOT NULL THEN
    SELECT v.license_plate, v.plate_state, v.vin, v.registration_state, v.registration_number,
           v.registration_expires_on
      INTO _v FROM public.vehicles v WHERE v.id = _r.vehicle_id;
  END IF;

  _out := jsonb_build_object(
    'stage', _stage,
    'rentalId', _r.id,
    'plate', CASE WHEN _stage IN ('assigned','active') THEN _v.license_plate END,
    'plateState', CASE WHEN _stage IN ('assigned','active') THEN _v.plate_state END,
    'vin', CASE WHEN _stage IN ('assigned','active') THEN _v.vin END,
    'returnedOn', CASE WHEN _stage = 'returned' THEN coalesce(_r.end_date, _r.updated_at::date) END
  );

  IF _stage = 'active' THEN
    _out := _out || jsonb_build_object(
      'registration', jsonb_build_object(
        'state', _v.registration_state,
        'number', _v.registration_number,
        'expiresOn', _v.registration_expires_on,
        'files', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', d.id, 'label', coalesce(d.label, d.file_name, 'Registration'),
                                              'expiresOn', d.expires_at) ORDER BY d.created_at DESC)
            FROM public.documents d
           WHERE d.vehicle_id = _r.vehicle_id AND d.is_current
             AND d.category = 'registration'), '[]'::jsonb)),
      'insurance', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', d.id, 'label', coalesce(d.label, d.file_name, 'Insurance'),
                   'expiresOn', d.expires_at, 'reviewStatus', d.review_status, 'isCurrent', d.is_current,
                   'uploadedAt', d.created_at) ORDER BY d.created_at DESC)
            FROM public.documents d
            JOIN public.applications a ON a.id = d.driver_id
           WHERE a.user_id = _uid AND d.category = 'insurance' AND 'driver' = ANY (d.visibility)
             AND (d.is_current OR d.review_status = 'verified')), '[]'::jsonb)
    );
  END IF;

  IF _r.id IN (SELECT private.renter_visible_rental_ids()) THEN
    _out := _out || jsonb_build_object(
      'photos', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', m.id, 'phase', m.phase, 'angle', m.angle,
                 'mediaType', m.media_type, 'takenAt', m.created_at) ORDER BY m.created_at)
          FROM public.condition_media m WHERE m.rental_id = _r.id), '[]'::jsonb),
      'receipts', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'amount', p.amount,
                 'paidDate', p.paid_date, 'method', p.payment_method) ORDER BY p.paid_date DESC)
          FROM public.payments p
         WHERE p.rental_id = _r.id AND p.status = 'paid'), '[]'::jsonb)
    );
  END IF;

  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.renter_portal_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renter_portal_summary() TO authenticated;

-- One file the caller may open: returns bucket/path only when the summary
-- above would list it. The server signs the URL after this check.
CREATE OR REPLACE FUNCTION public.renter_portal_file(_kind text, _id uuid)
RETURNS TABLE (storage_bucket text, storage_path text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _kind = 'photo' THEN
    RETURN QUERY SELECT m.storage_bucket, m.storage_path FROM public.condition_media m
      WHERE m.id = _id AND m.rental_id IN (SELECT private.renter_visible_rental_ids());
  ELSIF _kind = 'registration' THEN
    RETURN QUERY SELECT d.storage_bucket, d.storage_path FROM public.documents d
      JOIN public.rentals r ON r.vehicle_id = d.vehicle_id
      WHERE d.id = _id AND d.category = 'registration' AND d.is_current
        AND r.driver_id = _uid AND private.renter_portal_stage(r.status, r.end_date) = 'active';
  ELSIF _kind = 'insurance' THEN
    RETURN QUERY SELECT d.storage_bucket, d.storage_path FROM public.documents d
      JOIN public.applications a ON a.id = d.driver_id
      WHERE d.id = _id AND a.user_id = _uid AND d.category = 'insurance' AND 'driver' = ANY (d.visibility)
        AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.driver_id = _uid
                     AND private.renter_portal_stage(r.status, r.end_date) = 'active');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.renter_portal_file(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renter_portal_file(text, uuid) TO authenticated;
