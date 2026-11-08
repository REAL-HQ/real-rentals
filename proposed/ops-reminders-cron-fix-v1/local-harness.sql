-- Local validation only: stand-ins for pg_cron / pg_net with the real signatures.
CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA private;
CREATE TABLE private.cron_tokens (name text primary key, token text);
INSERT INTO private.cron_tokens VALUES ('ops-reminders', 'local-test');
CREATE TABLE cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
INSERT INTO cron.job (jobname, schedule, command) VALUES ('ops-reminders-daily', '30 13 * * *', 'SELECT extensions.http_post(url := ''x'')');
INSERT INTO cron.job (jobname, schedule, command) VALUES ('late-fees-daily', '30 11 * * *', 'SELECT 1');
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ UPDATE cron.job SET command = coalesce(alter_job.command, cron.job.command), schedule = coalesce(alter_job.schedule, cron.job.schedule) WHERE jobid = job_id $$;
CREATE TABLE net.calls (url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO net.calls VALUES (url, headers, body); RETURN 1; END $$;
