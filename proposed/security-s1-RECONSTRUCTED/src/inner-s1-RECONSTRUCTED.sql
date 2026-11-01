-- RECONSTRUCTED S1 inner SQL (NOT the original bd86d450). Function text is production's exact pg_get_functiondef.
CREATE OR REPLACE FUNCTION private.application_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 protected CONSTANT pg_catalog.text[] := ARRAY['id', 'created_at', 'user_id', 'primary_application_id',
  'reviewed_at', 'reviewed_by', 'deposit_status', 'deposit_amount', 'deposit_paid', 'weekly_rent',
  'payment_status', 'stripe_customer_id', 'stripe_payment_method_id', 'card_brand', 'card_last4',
  'card_exp_month', 'card_exp_year', 'card_on_file_at', 'ai_score', 'ai_tier', 'ai_flags', 'ai_summary',
  'scored_at', 'sms_consent_at', 'sms_consent_source', 'sms_consent_version', 'sms_consent_text',
  'sms_consent_phone', 'sms_consent_page', 'deleted_at', 'deleted_by', 'deleted_reason', 'purged_at',
  'legal_hold', 'contact_status', 'contact_status_note', 'contact_follow_up_on', 'contact_status_at',
  'contact_status_by'];
 insert_defaults CONSTANT pg_catalog.jsonb := '{"user_id": null, "primary_application_id": null,
  "reviewed_at": null, "reviewed_by": null, "deposit_status": "not_paid", "deposit_amount": null,
  "deposit_paid": 0, "weekly_rent": null, "payment_status": "current", "stripe_customer_id": null,
  "stripe_payment_method_id": null, "card_brand": null, "card_last4": null, "card_exp_month": null,
  "card_exp_year": null, "card_on_file_at": null, "ai_score": null, "ai_tier": null, "ai_flags": null,
  "ai_summary": null, "scored_at": null, "sms_consent_at": null, "sms_consent_source": null,
  "sms_consent_version": null, "sms_consent_text": null, "sms_consent_phone": null,
  "sms_consent_page": null, "deleted_at": null, "deleted_by": null, "deleted_reason": null,
  "purged_at": null, "legal_hold": false, "contact_status": "new", "contact_status_note": null,
  "contact_follow_up_on": null, "contact_status_at": null, "contact_status_by": null}';
 new_row pg_catalog.jsonb;
 old_row pg_catalog.jsonb;
 col pg_catalog.text;
BEGIN
 IF (current_user OPERATOR(pg_catalog.=) ANY (ARRAY['authenticated', 'anon']::pg_catalog.name[])) IS NOT TRUE THEN
  RETURN NEW;
 END IF;
 new_row := pg_catalog.to_jsonb(NEW);
 IF TG_OP OPERATOR(pg_catalog.=) 'INSERT' THEN
  IF (NEW.status OPERATOR(pg_catalog.=) ANY (ARRAY['partial', 'new']::pg_catalog.text[])) IS NOT TRUE THEN
   RAISE EXCEPTION USING ERRCODE = 'RRS01', MESSAGE = 'application_status_server_only',
    DETAIL = 'A client may create an application only as partial or new.';
  END IF;
  FOR col IN SELECT k FROM pg_catalog.jsonb_object_keys(insert_defaults) AS k LOOP
   IF (new_row OPERATOR(pg_catalog.?) col) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'RRS03', MESSAGE = 'application_write_guard_misconfigured', DETAIL = col;
   END IF;
   IF (new_row OPERATOR(pg_catalog.->) col) IS DISTINCT FROM (insert_defaults OPERATOR(pg_catalog.->) col) THEN
    RAISE EXCEPTION USING ERRCODE = 'RRS02', MESSAGE = 'application_column_server_only', DETAIL = col;
   END IF;
  END LOOP;
  RETURN NEW;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION USING ERRCODE = 'RRS01', MESSAGE = 'application_status_server_only',
   DETAIL = 'Application status changes only through the server.';
 END IF;
 old_row := pg_catalog.to_jsonb(OLD);
 FOREACH col IN ARRAY protected LOOP
  IF (new_row OPERATOR(pg_catalog.?) col) IS NOT TRUE THEN
   RAISE EXCEPTION USING ERRCODE = 'RRS03', MESSAGE = 'application_write_guard_misconfigured', DETAIL = col;
  END IF;
  IF (new_row OPERATOR(pg_catalog.->) col) IS DISTINCT FROM (old_row OPERATOR(pg_catalog.->) col) THEN
   RAISE EXCEPTION USING ERRCODE = 'RRS02', MESSAGE = 'application_column_server_only', DETAIL = col;
  END IF;
 END LOOP;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.application_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_application_write_guard BEFORE INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION private.application_write_guard();
REVOKE ALL ON TABLE public.applications FROM PUBLIC, anon, authenticated, service_role, sandbox_exec;
REVOKE ALL ("id", "full_name", "email", "phone", "dob", "address", "city", "state", "zip", "license_number", "license_state", "license_expiration", "years_licensed", "license_photo_url", "platforms", "weekly_hours", "platform_active", "vehicle_id", "start_date", "rental_term", "payment_method", "consent_gps", "consent_background", "consent_prepay", "consent_terms", "status", "notes", "created_at", "deposit_status", "deposit_amount", "deposit_paid", "weekly_rent", "payment_status", "background_check_status", "mvr_status", "incident_count", "updated_at", "rideshare_history_status", "earnings_verified_status", "user_id", "platform_status", "rental_length", "trips_completed", "rating", "market_id", "source", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "pickup_date", "pickup_time", "return_date", "return_time", "sms_consent", "license_valid", "gig_status", "start_timing", "vehicle_size", "rental_duration", "profile_screenshot_url", "full_coverage_insurance", "how_heard", "score", "current_step", "rental_duration_days", "trip_screenshots", "resubmission_count", "resubmission_history", "primary_application_id", "contacted_at", "landing_page", "referrer", "ai_score", "ai_tier", "ai_flags", "ai_summary", "scored_at", "recovery_email_sent_24h", "recovery_email_sent_72h", "stripe_customer_id", "stripe_payment_method_id", "card_brand", "card_last4", "card_exp_month", "card_exp_year", "card_on_file_at", "doc_request_sent_at", "requested_docs", "doc_request_note", "insurance_doc_url", "recovery_sent_at", "insurance_carrier", "insurance_policy_number", "insurance_expires_on", "insurance_rideshare_endorsement", "insurance_status", "sms_opt_out_at", "reviewed_at", "reviewed_by", "expected_duration", "drive_type", "insurance_answer", "contract_start_date", "contract_end_date", "sms_consent_at", "sms_consent_source", "sms_consent_version", "sms_consent_text", "sms_consent_phone", "sms_consent_page", "waitlist_signed_up_at", "waitlist_source", "deleted_at", "deleted_by", "deleted_reason", "purged_at", "legal_hold", "contact_status", "contact_status_note", "contact_follow_up_on", "contact_status_at", "contact_status_by") ON TABLE public.applications FROM PUBLIC, anon, authenticated, service_role, sandbox_exec;
GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE public.applications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.applications TO service_role;
GRANT INSERT, SELECT ON TABLE public.applications TO sandbox_exec;
GRANT INSERT ("city", "email", "full_name", "gclid", "landing_page", "market_id", "phone", "pickup_date", "platform_status", "primary_application_id", "referrer", "rental_length", "rental_term", "resubmission_count", "resubmission_history", "return_date", "sms_consent", "source", "state", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term", "vehicle_id") ON TABLE public.applications TO anon;
GRANT INSERT ("city", "email", "full_name", "gclid", "landing_page", "market_id", "phone", "pickup_date", "platform_status", "referrer", "rental_length", "rental_term", "resubmission_count", "resubmission_history", "return_date", "sms_consent", "source", "state", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term", "vehicle_id") ON TABLE public.applications TO authenticated;
GRANT UPDATE ("address", "background_check_status", "city", "consent_background", "consent_gps", "consent_prepay", "consent_terms", "contacted_at", "contract_end_date", "contract_start_date", "current_step", "dob", "doc_request_note", "doc_request_sent_at", "drive_type", "earnings_verified_status", "email", "expected_duration", "full_coverage_insurance", "full_name", "gclid", "gig_status", "how_heard", "incident_count", "insurance_answer", "insurance_carrier", "insurance_doc_url", "insurance_expires_on", "insurance_policy_number", "insurance_rideshare_endorsement", "insurance_status", "landing_page", "license_expiration", "license_number", "license_photo_url", "license_state", "license_valid", "market_id", "mvr_status", "notes", "payment_method", "phone", "pickup_date", "pickup_time", "platform_active", "platform_status", "platforms", "profile_screenshot_url", "rating", "recovery_email_sent_24h", "recovery_email_sent_72h", "recovery_sent_at", "referrer", "rental_duration", "rental_duration_days", "rental_length", "rental_term", "requested_docs", "resubmission_count", "resubmission_history", "return_date", "return_time", "rideshare_history_status", "score", "sms_consent", "sms_opt_out_at", "source", "start_date", "start_timing", "state", "trip_screenshots", "trips_completed", "updated_at", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term", "vehicle_id", "vehicle_size", "weekly_hours", "years_licensed", "zip") ON TABLE public.applications TO authenticated;
