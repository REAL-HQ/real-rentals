-- Condition photo EXIF timestamps + staff-only GPS. Additive.
-- Renter portal summary gains capturedByRole and prefers taken_at over created_at.
-- Precise GPS is NEVER returned by renter_portal_summary.

ALTER TABLE public.condition_media
  ADD COLUMN IF NOT EXISTS taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS taken_at_source text,
  ADD COLUMN IF NOT EXISTS gps_lat double precision,
  ADD COLUMN IF NOT EXISTS gps_lng double precision;

DO $$ BEGIN
  ALTER TABLE public.condition_media
    ADD CONSTRAINT condition_media_taken_at_source_chk
    CHECK (taken_at_source IS NULL OR taken_at_source IN ('exif', 'upload', 'client'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.condition_media.taken_at IS
  'Camera/EXIF capture time when known; else upload time (taken_at_source=upload).';
COMMENT ON COLUMN public.condition_media.taken_at_source IS
  'exif | upload | client — how taken_at was set.';
COMMENT ON COLUMN public.condition_media.gps_lat IS
  'EXIF GPS latitude. Staff-only; never expose precise coords to renters.';
COMMENT ON COLUMN public.condition_media.gps_lng IS
  'EXIF GPS longitude. Staff-only; never expose precise coords to renters.';

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
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id,
                 'phase', m.phase,
                 'angle', m.angle,
                 'mediaType', m.media_type,
                 'capturedByRole', m.captured_by_role,
                 'takenAt', coalesce(m.taken_at, m.created_at),
                 'takenAtSource', coalesce(m.taken_at_source, 'upload')
               ) ORDER BY coalesce(m.taken_at, m.created_at))
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
