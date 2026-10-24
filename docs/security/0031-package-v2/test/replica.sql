-- Disposable replica of exactly the catalog scope Security 0031 inspects, shaped like
-- production (PostgreSQL 17, en_US.UTF-8): role helpers, the five protected tables,
-- storage.objects with production's 24 mixed-case policy names, the 23-receipt Drizzle
-- journal and public.audit_log with production's exact columns, constraints, ACL and policy.
-- Synthetic data only. Load as the superuser named postgres into a database named postgres.
DO $r$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','sandbox_exec'] LOOP
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END $r$;
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage; CREATE SCHEMA drizzle; CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated, service_role;
-- As in production: authenticated has no USAGE on private (policies reference its functions by OID).
GRANT USAGE ON SCHEMA private TO service_role;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'SELECT pg_catalog.gen_random_uuid()';
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role text NOT NULL);
CREATE FUNCTION private.is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin', 'team')
  )
$function$;
CREATE FUNCTION private.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin', 'team', 'coordinator')
  )
$function$;
GRANT EXECUTE ON FUNCTION private.is_manager(), private.is_staff(), auth.uid() TO authenticated;
CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid, full_name text);
CREATE TABLE public.application_identity_reviews (id uuid PRIMARY KEY, application_id uuid, note text);
CREATE TABLE public.documents (id uuid PRIMARY KEY, driver_id uuid, storage_bucket text, category text);
CREATE TABLE public.agreements (id uuid PRIMARY KEY, application_id uuid);
CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text);
GRANT SELECT ON public.applications, public.application_identity_reviews, public.documents, public.agreements, storage.objects TO authenticated;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY; ALTER TABLE public.application_identity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY; ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read applications" ON public.applications FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Drivers read own application" ON public.applications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Staff read identity reviews" ON public.application_identity_reviews FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Drivers view their own documents" ON public.documents FOR SELECT TO authenticated USING (driver_id = auth.uid());
CREATE POLICY "Partners view their visible documents" ON public.documents FOR SELECT TO authenticated USING (false);
CREATE POLICY "Staff manage applicant documents" ON public.documents FOR SELECT TO authenticated USING (private.is_staff());
CREATE POLICY "Staff read agreements" ON public.agreements FOR SELECT TO authenticated USING (private.is_staff());
DO $p$ DECLARE n text; i int := 0; BEGIN
 FOREACH n IN ARRAY ARRAY['Admins can view license photos','Admins can view owner vehicle photos','Admins delete license photos','Admins delete owner vehicle photos','Admins delete profile screenshots','Admins update license photos','Admins update owner vehicle photos','Admins update profile screenshots','Managers delete vehicle photos','Managers manage receipt objects','Managers manage vehicle doc objects','Partners read their driver documents','Scoped upload owner vehicle photos','Staff manage condition media objects','Staff manage operational vehicle doc objects','Staff read vehicle photos','Staff update vehicle photos','Staff upload vehicle photos','admins read licenses','admins read profile screenshots','driver-docs admin delete','driver-docs admin insert','driver-docs admin read','driver-docs admin update'] LOOP
  i := i + 1;
  EXECUTE format('CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %L AND private.is_staff())', n, 'bucket-' || i);
 END LOOP; END $p$;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES
 (1,'60e27532f009295eb18cd9b0764093326417847d070f228be55c15afa3da53aa',1791420975062),(2,'738ba1b78a229c55eaf5f4bb8446d86afd6ff25feccd5277adf5ad4409cabeb5',1791421074958),
 (3,'cd11f5db078aaf63476e339f1cff6f581433a7978160ffdb74e328687700b138',1791430766220),(4,'611235fa2841a9b977a0a9c730558f64eafe3193bb9a7799794d8af9f12f8b7b',1791431279577),
 (5,'63623386f23a6c36cbc24cad601e469a5cb67a0ba52edf660aab72893395c033',1791432590443),(6,'63695e00db5f1636954ad79f396d72937402d940fdc279e0578c43a5361cf271',1791432832737),
 (7,'33c85b39c5410bc74e5302104d0f8cd062934f4fa4c4d8ae0c22c48d442bb808',1791458463060),(8,'9442071c9712fa259c9255fbeadbb73657c552fb5c4bed1ec0114304e9257b43',1791459951490),
 (9,'dcbabda64efa476c0b1c855807cf9747822af3dba4960771e1140a1cf56c5265',1791462253541),(10,'ee0ee9066eb3e0e9fabf3415da1c64d9d68484252a4371062167e8cdfd503957',1791462346435),
 (11,'18fb3113f234e0bb7834884e1e9c89a6d79ee880d4f59519b7399d990cbfcf77',1791463536348),(12,'6a558eda9c92b87d352e3849bd509ee939d6b5801afa77c6fe7d9d7b893b743e',1791463558283),
 (13,'873e4c4d4e4df1c0864291483d3fe805f3f4a1a5738f82572a3d2e5ab71022c4',1791464019517),(14,'c5807075884bdd3f8b868b9491bec4d2c61d685d55a11653cf9bf8fbe727aae1',1791471257211),
 (15,'0165723216a1346ae1dfab78180356c5f8b8a62038390119285a2f4ac6224890',1791473301327),(16,'2f12f169a12fc3acba57fc46423c51a461f407222c5272fbf142905222eea1cc',1791473830599),
 (17,'a3f9b526698a5f682f7b7162cec45ad75833e25a4fc16abfbf02a700944f040a',1791477139776),(18,'71b806abd5211fbe63227473a03e947d6a51d9fcda68c9927c62a24481ba54c6',1791479523295),
 (19,'cb6f88b17b356c9c6189da608829566f09ad6acd0d8411c0a38c332dd573dfc2',1791480452755),(20,'6ab09e206256d0b3752f8eb4e32c60be9f78cd07837398203a52a172d2029a2e',1791480942211),
 (21,'2c60e0bbd894ae6fd63fbafe8eb1956918169e43b7385ea11cca43f64be5cb80',1791481035617),(22,'a8f14f62b9c84e02e0e07a276300e7be6ef7f0f8eec221acd9981d2604eac2de',1791496432098),
 (23,'9ee4a1ced75ee787ab8647f67775ae4bb9c0bc7fc23d51acf17416e469948e11',1792408979135);
CREATE TABLE public.audit_log (
 id uuid NOT NULL DEFAULT extensions.gen_random_uuid(), actor_user_id uuid, actor_email text, actor_role text, action text NOT NULL,
 entity_type text, entity_id text, summary text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, ip text, user_agent text,
 created_at timestamp with time zone NOT NULL DEFAULT now(),
 CONSTRAINT audit_log_pkey PRIMARY KEY (id), CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL);
GRANT SELECT, REFERENCES, TRIGGER, MAINTAIN ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
GRANT SELECT, INSERT ON public.audit_log TO sandbox_exec;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read the audit log" ON public.audit_log FOR SELECT TO authenticated USING (private.is_manager());
INSERT INTO public.audit_log (action, summary) SELECT 'synthetic.baseline', 'synthetic row ' || g FROM generate_series(1, 5) g;
-- Identity buckets: staff may read them today (the containment subtracts the Coordinator).
CREATE POLICY "Staff read identity objects" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id IN ('license-uploads','driver-docs') AND private.is_staff());
-- Synthetic people and rows for the role access rehearsal.
INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-0000000000a1'),('00000000-0000-4000-8000-0000000000b1'),
 ('00000000-0000-4000-8000-0000000000c1'),('00000000-0000-4000-8000-0000000000d1');
INSERT INTO public.user_roles VALUES ('00000000-0000-4000-8000-0000000000a1','admin'),('00000000-0000-4000-8000-0000000000b1','team'),
 ('00000000-0000-4000-8000-0000000000c1','coordinator'),('00000000-0000-4000-8000-0000000000d1','driver');
INSERT INTO public.applications VALUES (gen_random_uuid(),'00000000-0000-4000-8000-0000000000d1','Synthetic Driver'),
 (gen_random_uuid(),NULL,'Synthetic Applicant A'),(gen_random_uuid(),NULL,'Synthetic Applicant B');
INSERT INTO public.application_identity_reviews SELECT gen_random_uuid(), id, 'synthetic review' FROM public.applications;
INSERT INTO public.documents VALUES (gen_random_uuid(),'00000000-0000-4000-8000-0000000000d1','license-uploads','license_front'),
 (gen_random_uuid(),NULL,'license-uploads','license_back'),(gen_random_uuid(),NULL,'vehicle-docs','registration');
INSERT INTO public.agreements SELECT gen_random_uuid(), id FROM public.applications LIMIT 1;
INSERT INTO storage.objects VALUES (gen_random_uuid(),'license-uploads','a.jpg'),(gen_random_uuid(),'driver-docs','b.pdf'),(gen_random_uuid(),'bucket-14','c.jpg');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY); GRANT SELECT ON public.vehicles TO authenticated;
INSERT INTO public.vehicles VALUES (gen_random_uuid()), (gen_random_uuid());
