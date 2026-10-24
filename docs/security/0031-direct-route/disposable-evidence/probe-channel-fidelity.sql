-- Disposable project only: channel byte fidelity and single-statement atomicity.
DO $rrprobe$
DECLARE
 inner_sql text := $inner$CREATE POLICY rr_channel_probe ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (true);
CREATE TABLE public.rr_channel_probe_t (id int);
DO $c$ BEGIN EXECUTE 'CREATE POLICY rr_channel_probe2 ON public.rr_channel_probe_t FOR SELECT USING (true)'; END; $c$;
$inner$;
 q text := current_query();
 cut int := position(E'\n\n-- source: POST /v1/projects/:ref/database/query' in q);
BEGIN
 EXECUTE inner_sql;
 RAISE EXCEPTION 'RR_CHANNEL_PROBE submitted_len=% submitted_sha=% trailer=[%] policies=% table=% drizzle=%', octet_length(left(q, cut)),
  encode(sha256(convert_to(left(q, cut),'UTF8')),'hex'), replace(substr(q, cut + 1, 60), E'\n', '\n'),
  (SELECT count(*) FROM pg_policies WHERE policyname LIKE 'rr_channel_probe%'),
  to_regclass('public.rr_channel_probe_t') IS NOT NULL, (SELECT count(*) FROM drizzle.__drizzle_migrations);
END;
$rrprobe$;
