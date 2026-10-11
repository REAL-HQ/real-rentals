-- Reserved 0030; local reviewed proposal only. Runner owns transaction.
-- Requires 0022 and 0025; does not change their executable SQL or audit guards.
-- Restrictive policies intersect existing permissive policies; do not replace them.
CREATE FUNCTION private.identity_document_access(_application uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT private.is_manager() OR (
   NOT private.is_staff() AND EXISTS (
     SELECT 1 FROM public.applications a WHERE a.id=_application AND a.user_id=auth.uid()
   )
 );
$$;
REVOKE ALL ON FUNCTION private.identity_document_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.identity_document_access(uuid) TO authenticated;

-- Treat all applicant-bound documents as sensitive: category relabeling must not
-- turn a licence into an unprotected 'other' attachment. Vehicle-only rows retain
-- existing access. All four commands are protected, including row reassignment.
CREATE POLICY identity_document_boundary ON public.documents AS RESTRICTIVE
FOR ALL TO authenticated
USING ((driver_id IS NULL AND storage_bucket NOT IN ('license-uploads','profile-screenshots','driver-docs') AND coalesce(category,'') NOT IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording')) OR private.identity_document_access(driver_id))
WITH CHECK ((driver_id IS NULL AND storage_bucket NOT IN ('license-uploads','profile-screenshots','driver-docs') AND coalesce(category,'') NOT IN ('license_front','license_back','insurance','insurance_card','gig_profile','trip_history','verification_recording')) OR private.identity_document_access(driver_id));

-- Storage is a second boundary, including paths unregistered in documents.
-- This never adds access: existing bucket policies still have to allow it.
CREATE POLICY identity_storage_boundary ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated
USING (
 bucket_id NOT IN ('license-uploads','profile-screenshots','driver-docs')
 OR private.is_manager()
 OR (NOT private.is_staff() AND EXISTS (
   SELECT 1 FROM public.applications a
   WHERE a.user_id=auth.uid() AND a.id::text=split_part(name,'/',1)
 ))
)
WITH CHECK (
 bucket_id NOT IN ('license-uploads','profile-screenshots','driver-docs')
 OR private.is_manager()
 OR (NOT private.is_staff() AND EXISTS (
   SELECT 1 FROM public.applications a
   WHERE a.user_id=auth.uid() AND a.id::text=split_part(name,'/',1)
 ))
);

-- Shared authenticated DB role cannot implement per-staff column masking.
-- Remove broad SELECT (and any existing column SELECT grants), grant only the
-- approved projection, and expose sensitive fields through the checked RPC below.
REVOKE SELECT ON public.applications FROM PUBLIC, anon, authenticated;
DO $$ DECLARE cols text; BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols
 FROM pg_attribute WHERE attrelid='public.applications'::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE 'REVOKE SELECT ('||cols||') ON public.applications FROM PUBLIC, anon, authenticated';
 SELECT string_agg(quote_ident(attname),',') INTO cols
 FROM pg_attribute WHERE attrelid='public.applications'::regclass AND attnum>0 AND NOT attisdropped
 AND attname=ANY(ARRAY['id','user_id','full_name','email','phone','status','created_at','updated_at',
 'pickup_date','current_step','license_valid','license_state','license_expiration','full_coverage_insurance',
 'insurance_expires_on','gig_platform','rating','trip_count','market_id','vehicle_id','contacted_at',
 'reviewed_at','primary_application_id','resubmission_count','background_check_status','mvr_status','rideshare_history_status','earnings_verified_status','weekly_rent','deposit_status','payment_status','platforms','trips_completed','start_timing','drive_type','years_licensed','insurance_answer','insurance_rideshare_endorsement','gig_status','insurance_status']);
 IF cols IS NULL THEN RAISE EXCEPTION 'Missing safe application projection'; END IF;
 EXECUTE 'GRANT SELECT ('||cols||') ON public.applications TO authenticated';
END $$;

CREATE FUNCTION public.read_application_identity(_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.applications;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.applications WHERE id=_application_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT private.is_manager() AND NOT (
   NOT private.is_staff() AND a.user_id=auth.uid()
 ) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('license_number',a.license_number,
   'license_photo_url',a.license_photo_url);
END;
$$;
REVOKE ALL ON FUNCTION public.read_application_identity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_application_identity(uuid) TO authenticated;
-- Query consumers use application_read_projection; direct base-table SELECT * fails closed.

-- Stable row shape for existing clients; coordinators receive only allowlisted
-- operational fields. Filters on protected columns see NULL, never hidden values.
-- Definer view requires explicit row authorization, matching existing read policy.
CREATE VIEW public.application_read_projection WITH (security_barrier=true) AS
SELECT (jsonb_populate_record(NULL::public.applications,
 CASE WHEN private.is_manager() OR auth.role()='service_role'
   OR (NOT private.is_staff() AND a.user_id=auth.uid()) THEN to_jsonb(a)
 ELSE (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
       FROM jsonb_each(to_jsonb(a)) WHERE key=ANY(ARRAY['id','user_id','full_name','email','phone','status','created_at','updated_at','pickup_date','current_step','license_valid','license_state','license_expiration','full_coverage_insurance','insurance_expires_on','gig_platform','rating','trip_count','market_id','vehicle_id','contacted_at','reviewed_at','primary_application_id','resubmission_count','background_check_status','mvr_status','rideshare_history_status','earnings_verified_status','weekly_rent','deposit_status','payment_status','platforms','trips_completed','start_timing','drive_type','years_licensed','insurance_answer','insurance_rideshare_endorsement','gig_status','insurance_status'])) END
 )).* ,
 coalesce(to_jsonb(a)->>'license_photo_url','')<>'' AS identity_license_on_file,
 coalesce(to_jsonb(a)->>'insurance_doc_url','')<>'' AS identity_insurance_on_file,
 coalesce(to_jsonb(a)->>'profile_screenshot_url','')<>'' AS identity_profile_on_file,
 CASE WHEN jsonb_typeof(to_jsonb(a)->'trip_screenshots')='array' THEN jsonb_array_length(to_jsonb(a)->'trip_screenshots')>0 ELSE false END AS identity_trips_on_file
FROM public.applications a
WHERE auth.role()='service_role' OR private.is_staff() OR a.user_id=auth.uid()
 OR (a.vehicle_id IS NOT NULL AND private.partner_owns_vehicle(a.vehicle_id));
REVOKE ALL ON public.application_read_projection FROM PUBLIC,anon;
GRANT SELECT ON public.application_read_projection TO authenticated,service_role;

-- Existing signed agreement bodies/PDFs can contain the full licence number.
-- Coordinators use the checked status-only server endpoint. Driver-own policies
-- remain in force; this does not grant any new driver agreement access.
-- Reduced staging has no agreements relation. Never create a placeholder or grant
-- access here. Any future introduction of agreements MUST install this boundary
-- in the same transaction, before granting application access (release prerequisite).
DO $agreement_boundary$
BEGIN
 IF to_regclass('public.agreements') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY identity_agreement_boundary ON public.agreements AS RESTRICTIVE
   FOR SELECT TO authenticated USING (NOT private.is_staff() OR private.is_manager())';
 END IF;
END;
$agreement_boundary$;

-- Free-form decision notes may contain identification details. Keep them out of
-- Coordinator responses and direct SQL/API access; preserve Manager+ reads.
REVOKE SELECT ON public.application_identity_reviews FROM PUBLIC,anon,authenticated;
REVOKE SELECT (resolution_note) ON public.application_identity_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,application_id,kind,submitted_full_name,submitted_email,submitted_phone,source,status,resolution,resolved_by,resolved_at,created_at) ON public.application_identity_reviews TO authenticated;
CREATE VIEW public.identity_review_read_projection WITH (security_barrier=true) AS
SELECT id,application_id,kind,submitted_full_name,submitted_email,submitted_phone,source,status,resolution,
 CASE WHEN private.is_manager() OR auth.role()='service_role' THEN resolution_note ELSE NULL::text END AS resolution_note,
 resolved_by,resolved_at,created_at
FROM public.application_identity_reviews
WHERE private.is_staff() OR auth.role()='service_role';
REVOKE ALL ON public.identity_review_read_projection FROM PUBLIC,anon;
GRANT SELECT ON public.identity_review_read_projection TO authenticated,service_role;

-- Shared authenticated grants must preserve Manager/Owner writes. The row trigger
-- rejects Coordinator changes to identity values, document pointers, and ownership
-- bindings; operational updates still pass through existing RLS and column grants.
CREATE FUNCTION private.guard_application_identity_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF private.is_staff() AND NOT private.is_manager() THEN
  FOREACH k IN ARRAY ARRAY['id','user_id','license_number','license_photo_url',
    'insurance_doc_url','profile_screenshot_url','trip_screenshots'] LOOP
   IF (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k) THEN
    RAISE EXCEPTION 'Identity fields require Manager or Owner authorization' USING ERRCODE='42501';
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_application_identity_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_application_identity_write BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION private.guard_application_identity_write();
