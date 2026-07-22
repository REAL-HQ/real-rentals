
CREATE OR REPLACE FUNCTION private.get_cron_token(_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = private
AS $$
  SELECT token FROM private.cron_tokens WHERE name = _name;
$$;

REVOKE ALL ON FUNCTION private.get_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_cron_token(text) TO service_role;

-- Also expose a public wrapper the PostgREST service role can call by name
CREATE OR REPLACE FUNCTION public.get_cron_token(_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT token FROM private.cron_tokens WHERE name = _name;
$$;

REVOKE ALL ON FUNCTION public.get_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_token(text) TO service_role;
