-- LOCAL REHEARSAL BASELINE ONLY (disposable Postgres). Production-structure-equivalent public.applications
-- rebuilt from the read-only production catalog evidence (2026-10-31). NOT for any Supabase project.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE sandbox_exec LOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE anon NOLOGIN NOBYPASSRLS; ALTER ROLE authenticated NOLOGIN NOBYPASSRLS; ALTER ROLE service_role NOLOGIN BYPASSRLS; ALTER ROLE sandbox_exec LOGIN BYPASSRLS; ALTER ROLE authenticator LOGIN NOBYPASSRLS;
CREATE SCHEMA private; CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, private, auth TO anon, authenticated, service_role, sandbox_exec;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true),'')::uuid $f$;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$ SELECT coalesce(current_setting('test.role', true),'') IN ('staff','manager','owner') $f$;
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$ SELECT coalesce(current_setting('test.role', true),'') IN ('manager','owner') $f$;
CREATE FUNCTION private.partner_owns_vehicle(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$ SELECT false $f$;
CREATE TABLE public.rentals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid, status text);
GRANT ALL ON public.rentals TO service_role;
CREATE TABLE public.applications (
 "id" uuid NOT NULL DEFAULT gen_random_uuid(),
 "full_name" text NOT NULL DEFAULT '',
 "email" text NOT NULL DEFAULT '',
 "phone" text NOT NULL DEFAULT '',
 "dob" date,
 "address" text,
 "city" text,
 "state" text,
 "zip" text,
 "license_number" text,
 "license_state" text,
 "license_expiration" date,
 "years_licensed" integer,
 "license_photo_url" text,
 "platforms" text[],
 "weekly_hours" integer,
 "platform_active" boolean,
 "vehicle_id" uuid,
 "start_date" date,
 "rental_term" text,
 "payment_method" text,
 "consent_gps" boolean,
 "consent_background" boolean,
 "consent_prepay" boolean,
 "consent_terms" boolean,
 "status" text NOT NULL DEFAULT 'new',
 "notes" text,
 "created_at" timestamp with time zone DEFAULT now(),
 "deposit_status" text NOT NULL DEFAULT 'not_paid',
 "deposit_amount" numeric(10,2),
 "deposit_paid" numeric(10,2) DEFAULT 0,
 "weekly_rent" numeric(10,2),
 "payment_status" text NOT NULL DEFAULT 'current',
 "background_check_status" text NOT NULL DEFAULT 'not_started',
 "mvr_status" text NOT NULL DEFAULT '',
 "incident_count" integer NOT NULL DEFAULT 0,
 "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
 "rideshare_history_status" text NOT NULL DEFAULT '',
 "earnings_verified_status" text NOT NULL DEFAULT '',
 "user_id" uuid,
 "platform_status" text,
 "rental_length" text,
 "trips_completed" text,
 "rating" numeric,
 "market_id" uuid,
 "source" text,
 "utm_source" text,
 "utm_medium" text,
 "utm_campaign" text,
 "utm_term" text,
 "utm_content" text,
 "gclid" text,
 "pickup_date" date,
 "pickup_time" text,
 "return_date" date,
 "return_time" text,
 "sms_consent" boolean,
 "license_valid" boolean,
 "gig_status" text,
 "start_timing" text,
 "vehicle_size" text,
 "rental_duration" text,
 "profile_screenshot_url" text,
 "full_coverage_insurance" boolean,
 "how_heard" text,
 "score" integer NOT NULL DEFAULT 0,
 "current_step" text,
 "rental_duration_days" integer,
 "trip_screenshots" text[] NOT NULL DEFAULT '{}',
 "resubmission_count" integer NOT NULL DEFAULT 0,
 "resubmission_history" jsonb NOT NULL DEFAULT '{}',
 "primary_application_id" uuid,
 "contacted_at" timestamp with time zone,
 "landing_page" text,
 "referrer" text,
 "ai_score" integer,
 "ai_tier" text,
 "ai_flags" jsonb,
 "ai_summary" text,
 "scored_at" timestamp with time zone,
 "recovery_email_sent_24h" timestamp with time zone,
 "recovery_email_sent_72h" timestamp with time zone,
 "stripe_customer_id" text,
 "stripe_payment_method_id" text,
 "card_brand" text,
 "card_last4" text,
 "card_exp_month" integer,
 "card_exp_year" integer,
 "card_on_file_at" timestamp with time zone,
 "doc_request_sent_at" timestamp with time zone,
 "requested_docs" jsonb NOT NULL DEFAULT '{}',
 "doc_request_note" text,
 "insurance_doc_url" text,
 "recovery_sent_at" timestamp with time zone,
 "insurance_carrier" text,
 "insurance_policy_number" text,
 "insurance_expires_on" date,
 "insurance_rideshare_endorsement" boolean,
 "insurance_status" text NOT NULL DEFAULT '',
 "sms_opt_out_at" timestamp with time zone,
 "reviewed_at" timestamp with time zone,
 "reviewed_by" uuid,
 "expected_duration" text,
 "drive_type" text,
 "insurance_answer" text,
 "contract_start_date" date,
 "contract_end_date" date,
 "sms_consent_at" timestamp with time zone,
 "sms_consent_source" text,
 "sms_consent_version" text,
 "sms_consent_text" text,
 "sms_consent_phone" text,
 "sms_consent_page" text,
 "waitlist_signed_up_at" timestamp with time zone,
 "waitlist_source" text,
 "deleted_at" timestamp with time zone,
 "deleted_by" uuid,
 "deleted_reason" text,
 "purged_at" timestamp with time zone,
 "legal_hold" boolean NOT NULL DEFAULT false,
 "contact_status" text NOT NULL DEFAULT 'new',
 "contact_status_note" text,
 "contact_follow_up_on" date,
 "contact_status_at" timestamp with time zone,
 "contact_status_by" uuid
);
ALTER TABLE public.applications ADD PRIMARY KEY (id);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$
;
CREATE OR REPLACE FUNCTION private.application_active_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
     AND NOT EXISTS (SELECT 1 FROM public.rentals r
                     WHERE (r.application_id = NEW.id) AND r.status = 'active') THEN
    RAISE EXCEPTION 'active_requires_running_rental'
      USING HINT = 'A driver becomes Active only when a rental is started (activate_rental_tx).';
  END IF;
  RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION private.application_active_guard() FROM PUBLIC;
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER applications_active_guard BEFORE INSERT OR UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION private.application_active_guard();
CREATE POLICY "Anyone can submit applications" ON public.applications FOR INSERT TO anon,authenticated WITH CHECK ((((char_length(full_name) >= 1) AND (char_length(full_name) <= 120)) AND ((char_length(email) >= 5) AND (char_length(email) <= 255)) AND (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text) AND ((char_length(phone) >= 7) AND (char_length(phone) <= 32))));
CREATE POLICY "No direct application deletes" ON public.applications AS RESTRICTIVE FOR DELETE TO anon,authenticated USING (false);
CREATE POLICY "Partners can view their assigned drivers" ON public.applications FOR SELECT TO authenticated USING (((vehicle_id IS NOT NULL) AND private.partner_owns_vehicle(vehicle_id)));
CREATE POLICY "Staff update applications" ON public.applications FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE POLICY "Staff view applications" ON public.applications FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Users can view their own application" ON public.applications FOR SELECT TO authenticated USING (((user_id IS NOT NULL) AND (user_id = auth.uid())));
CREATE POLICY "coordinator_application_containment" ON public.applications AS RESTRICTIVE FOR SELECT TO authenticated USING (((private.is_manager() IS TRUE) OR (private.is_staff() IS FALSE)));
-- Pre-S1 ACL (Supabase default grants; the exact pre-install ACL was not retrieved)
GRANT ALL ON public.applications TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.applications TO sandbox_exec;
CREATE TABLE public.audit_log (id bigserial PRIMARY KEY, entity_type text, entity_id text, action text, actor_role text, metadata jsonb, created_at timestamptz DEFAULT now());
-- Journal tables (empty locally; journal gates are expected to be false in this rehearsal)
CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
