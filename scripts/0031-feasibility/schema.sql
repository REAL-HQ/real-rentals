-- Disposable model of the production privilege shape, taken from read-only
-- catalog reads on 2026-10-23. Role names are local stand-ins:
--   app_exec        <- postgres              (owns public.*, BYPASSRLS, NOT superuser)
--   storage_owner   <- supabase_storage_admin (owns storage.objects, ZERO members)
--   super_exec      <- supabase_admin        (the one superuser)
CREATE SCHEMA storage AUTHORIZATION storage_owner;
CREATE SCHEMA private;
CREATE SCHEMA drizzle;

-- private.is_manager / is_staff, the qualifier helpers the policies call.
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION private.is_staff()   RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT USAGE ON SCHEMA private TO authenticated, app_exec, super_exec;

-- The four public relations the package touches, owned by app_exec.
CREATE TABLE public.applications (id uuid PRIMARY KEY);
CREATE TABLE public.application_identity_reviews (id uuid PRIMARY KEY);
CREATE TABLE public.documents (id uuid PRIMARY KEY, driver_id uuid,
  storage_bucket text, category text);
CREATE TABLE public.agreements (id uuid PRIMARY KEY);
ALTER TABLE public.applications               OWNER TO app_exec;
ALTER TABLE public.application_identity_reviews OWNER TO app_exec;
ALTER TABLE public.documents                  OWNER TO app_exec;
ALTER TABLE public.agreements                 OWNER TO app_exec;
ALTER TABLE public.applications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreements                 ENABLE ROW LEVEL SECURITY;

-- storage.objects, owned by storage_owner. app_exec is deliberately NOT a
-- member of storage_owner, matching production (the role has zero members).
CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects OWNER TO storage_owner;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated, app_exec, super_exec;

-- The drizzle ledger, seeded with 23 rows to match production exactly. The
-- Supabase route does not write this table, which is the point of the test.
CREATE TABLE drizzle.__drizzle_migrations (id integer PRIMARY KEY, hash text, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations
SELECT g, 'h'||g, 1791000000000 + g FROM generate_series(1,23) g;
ALTER TABLE drizzle.__drizzle_migrations OWNER TO app_exec;
-- In production postgres owns the drizzle schema too; without USAGE the
-- executor cannot even read the ledger to check the pin.
ALTER SCHEMA drizzle OWNER TO app_exec;
GRANT USAGE ON SCHEMA drizzle TO app_exec, super_exec;
