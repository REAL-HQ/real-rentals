-- Production catalog parity — rehearsal only, never production.
-- Every statement reproduces state read from production's catalog (read-only,
-- 2026-10-23) that no receipted or out-of-band repo file creates. Schema only:
-- no rows, no secrets, no outbound calls.
--
-- 1. Three functions whose production bodies are the repo's code with comments
--    and line breaks removed (applied out-of-band). Text is pg_get_functiondef
--    output verbatim; CREATE OR REPLACE keeps the existing ACLs.
CREATE OR REPLACE FUNCTION public.enforce_screening_pipeline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE doc_count int; rec_count int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('docs_pending','insurance_verified','approved','pickup_scheduled','active_renter') THEN
    IF NEW.interview_completed_at IS NULL THEN RAISE EXCEPTION 'Cannot advance to %: interview must be completed first', NEW.status; END IF;
    IF NEW.disqualified THEN RAISE EXCEPTION 'Cannot advance to %: driver is disqualified', NEW.status; END IF;
  END IF;
  IF NEW.status IN ('insurance_verified','approved','pickup_scheduled','active_renter') THEN
    SELECT count(DISTINCT category) INTO doc_count FROM public.documents
      WHERE driver_id = NEW.lead_id AND is_current
        AND coalesce(review_status,'uploaded') <> 'rejected'
        AND category IN ('license_front','license_back','insurance','gig_profile');
    IF doc_count < 4 THEN RAISE EXCEPTION 'Cannot advance to %: all four driver documents required (have %)', NEW.status, doc_count; END IF;
    IF NEW.insurance_verified IS NOT TRUE THEN RAISE EXCEPTION 'Cannot advance to %: insurance not yet verified', NEW.status; END IF;
    SELECT count(*) INTO rec_count FROM public.documents
      WHERE driver_id = NEW.lead_id AND is_current
        AND coalesce(review_status,'uploaded') <> 'rejected'
        AND category = 'verification_recording';
    IF rec_count < 1 THEN RAISE EXCEPTION 'Cannot advance to %: verification call recording required', NEW.status; END IF;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.vehicle_media_enhanced_unpublished()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.kind = 'ai_enhanced' THEN
    NEW.published := false;
    NEW.provenance := 'ai_enhanced';
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.vehicle_media_sync_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_vehicle_photos(OLD.vehicle_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_vehicle_photos(NEW.vehicle_id);
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    PERFORM public.sync_vehicle_photos(OLD.vehicle_id);
  END IF;
  RETURN NEW;
END $function$
;
-- 2. Production's vehicle_media grants no table privilege to anon.
REVOKE ALL ON public.vehicle_media FROM anon;
-- 3. Storage buckets as production configures them (all private).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('condition-media', 'condition-media', false, 52428800, NULL),
  ('database_export_10_10_26', 'database_export_10_10_26', false, NULL, NULL),
  ('driver-docs', 'driver-docs', false, NULL, NULL),
  ('license-uploads', 'license-uploads', false, 26214400, '{image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf}'),
  ('owner-vehicle-photos', 'owner-vehicle-photos', false, NULL, NULL),
  ('profile-screenshots', 'profile-screenshots', false, 26214400, '{image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf}'),
  ('receipts', 'receipts', false, NULL, NULL),
  ('rental-agreements', 'rental-agreements', false, NULL, NULL),
  ('vehicle-docs', 'vehicle-docs', false, 20971520, NULL),
  ('vehicle-photos', 'vehicle-photos', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
