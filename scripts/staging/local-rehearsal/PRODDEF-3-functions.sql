-- PRODUCTION DEFINITIONS (read-only query approved t31u, 2026-11-01). Repo versions differ only in comments/whitespace
-- (token-identical after stripping comments+whitespace). Applied after the migrations so pg_get_functiondef matches production byte-for-byte.
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
