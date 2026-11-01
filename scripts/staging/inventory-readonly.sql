-- READ-ONLY staging inventory (aggregates only). Run on STAGING only. Refuses on the production system id.
SET TRANSACTION READ ONLY;
DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) = '7642734024280108049'
  THEN RAISE EXCEPTION 'refused: this is PRODUCTION'; END IF; END $$;
SELECT jsonb_build_object(
 'sysid',(SELECT system_identifier::text FROM pg_control_system()),
 'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
 'fdw_servers',(SELECT count(*) FROM pg_foreign_server),
 'dblink_or_fdw_ext',(SELECT count(*) FROM pg_extension WHERE extname IN ('dblink','postgres_fdw')),
 'pg_net',(SELECT count(*) FROM pg_extension WHERE extname='pg_net'),
 'prod_refs_in_functions',(SELECT count(*) FROM pg_proc WHERE prosrc ILIKE '%yuyzdsnrbfhkmfzpvhwx%' OR prosrc ILIKE '%drivereal.com%'),
 'auth_users',(SELECT count(*) FROM auth.users),
 'auth_users_non_example',(SELECT count(*) FROM auth.users WHERE email !~* '@example\.(invalid|com|org|net)$'),
 'buckets',(SELECT jsonb_agg(jsonb_build_object('id',b.id,'objects',(SELECT count(*) FROM storage.objects o WHERE o.bucket_id=b.id))) FROM storage.buckets b)
) AS staging_inventory;
