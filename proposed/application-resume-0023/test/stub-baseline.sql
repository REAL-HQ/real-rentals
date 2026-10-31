-- LOCAL TEST ONLY. Minimal Supabase-shaped stand-in for the objects Drizzle 0023 touches. Never run against a shared database.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA drizzle;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations(hash, created_at) SELECT md5(g::text), 1700000000000 + g FROM generate_series(1, 23) g;
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL);
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
 $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'team')) $$;
GRANT USAGE ON SCHEMA private TO authenticated, service_role; GRANT EXECUTE ON FUNCTION private.is_manager() TO authenticated;
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, full_name text, status text DEFAULT 'partial',
 deleted_at timestamptz, purged_at timestamptz, resubmission_history jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION private.application_write_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER zz_application_write_guard BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION private.application_write_guard();
CREATE TABLE public.application_resume_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, last_used_at timestamptz, revoked_at timestamptz);
ALTER TABLE public.application_resume_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_resume_tokens FROM anon, authenticated;
CREATE TABLE public.application_identity_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES public.applications(id),
 kind text NOT NULL, status text NOT NULL DEFAULT 'open', resolution text, resolution_note text, resolved_by uuid, resolved_at timestamptz);
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.audit_log (id bigserial PRIMARY KEY, actor_user_id uuid, actor_email text, actor_role text, action text, entity_type text, entity_id text,
 summary text, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric);
CREATE TABLE public.agreements (id uuid PRIMARY KEY); CREATE TABLE public.documents (id uuid PRIMARY KEY); CREATE TABLE public.reviews (id uuid PRIMARY KEY);
CREATE POLICY coordinator_agreement_containment ON public.agreements AS RESTRICTIVE FOR ALL TO authenticated USING (true);
CREATE POLICY coordinator_application_containment ON public.applications AS RESTRICTIVE FOR ALL TO authenticated USING (true);
CREATE POLICY coordinator_document_containment ON public.documents AS RESTRICTIVE FOR ALL TO authenticated USING (true);
CREATE POLICY coordinator_identity_storage_containment ON public.documents AS RESTRICTIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY coordinator_review_containment ON public.reviews AS RESTRICTIVE FOR ALL TO authenticated USING (true);
-- Fixture applicants: one with a send 30s ago (backfilled), one 3 days ago (not), one malformed, one without history.
INSERT INTO public.applications(id, email, full_name, resubmission_history) VALUES
 ('00000000-0000-4000-8000-000000000001', 'a@fixture.invalid', 'Fixture A', jsonb_build_array(jsonb_build_object('link_sent', true, 'at', (now() - interval '30 seconds')::text))),
 ('00000000-0000-4000-8000-000000000002', 'b@fixture.invalid', 'Fixture B', jsonb_build_array(jsonb_build_object('link_sent', true, 'at', (now() - interval '3 days')::text))),
 ('00000000-0000-4000-8000-000000000003', 'c@fixture.invalid', 'Fixture C', '[{"link_sent": true, "at": "not a date"}]'),
 ('00000000-0000-4000-8000-000000000004', 'd@fixture.invalid', 'Fixture D', '[]');
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-0000000000aa', 'mgr@fixture.invalid');
INSERT INTO public.user_roles VALUES ('00000000-0000-4000-8000-0000000000aa', 'admin');
INSERT INTO public.application_identity_reviews(id, application_id, kind) VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000004', 'phone_conflict');
