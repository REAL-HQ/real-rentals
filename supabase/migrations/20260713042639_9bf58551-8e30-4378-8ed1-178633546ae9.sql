
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION private.driver_market_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.market_id FROM public.rentals r
  JOIN public.vehicles v ON v.id = r.vehicle_id
  WHERE r.driver_id = auth.uid() AND r.status = 'active' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.driver_owns_rental(_rental_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rentals WHERE id = _rental_id AND driver_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION private.partner_owns_rental(_rental_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rentals r
    JOIN public.vehicles v ON v.id = r.vehicle_id
    JOIN public.partners p ON p.id = v.partner_id
    WHERE r.id = _rental_id AND p.user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION private.is_partner_owner(_partner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.partners WHERE id = _partner_id AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION private.partner_owns_vehicle(_vehicle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicles v
    JOIN public.partners p ON p.id = v.partner_id
    WHERE v.id = _vehicle_id AND p.user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.driver_market_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.driver_owns_rental(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.partner_owns_rental(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_partner_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.partner_owns_vehicle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.driver_market_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.driver_owns_rental(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.partner_owns_rental(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_partner_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.partner_owns_vehicle(uuid) TO authenticated;

-- Rewrite all public policies referencing the old public.* helpers to point at private.*
DO $$
DECLARE
  r RECORD;
  new_qual TEXT;
  new_check TEXT;
  cmd_kw TEXT;
  roles_sql TEXT;
  fn TEXT;
  fns TEXT[] := ARRAY['has_role','driver_market_id','driver_owns_rental','partner_owns_rental','is_partner_owner','partner_owns_vehicle'];
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname IN ('public','storage')
      AND (COALESCE(qual,'') ~ '(has_role|driver_market_id|driver_owns_rental|partner_owns_rental|is_partner_owner|partner_owns_vehicle)\('
        OR COALESCE(with_check,'') ~ '(has_role|driver_market_id|driver_owns_rental|partner_owns_rental|is_partner_owner|partner_owns_vehicle)\(')
  LOOP
    new_qual := COALESCE(r.qual,'');
    new_check := COALESCE(r.with_check,'');
    FOREACH fn IN ARRAY fns LOOP
      new_qual := regexp_replace(new_qual, '(^|[^a-zA-Z0-9_.])'||fn||'\(', '\1private.'||fn||'(', 'g');
      new_check := regexp_replace(new_check, '(^|[^a-zA-Z0-9_.])'||fn||'\(', '\1private.'||fn||'(', 'g');
      new_qual := replace(new_qual, 'public.'||fn||'(', 'private.'||fn||'(');
      new_check := replace(new_check, 'public.'||fn||'(', 'private.'||fn||'(');
    END LOOP;

    roles_sql := array_to_string(r.roles, ', ');

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    cmd_kw := CASE r.cmd
      WHEN 'SELECT' THEN 'FOR SELECT'
      WHEN 'INSERT' THEN 'FOR INSERT'
      WHEN 'UPDATE' THEN 'FOR UPDATE'
      WHEN 'DELETE' THEN 'FOR DELETE'
      WHEN 'ALL' THEN 'FOR ALL'
      ELSE ''
    END;

    IF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I %s TO %s WITH CHECK (%s)',
        r.policyname, r.schemaname, r.tablename, cmd_kw, roles_sql, new_check);
    ELSIF r.cmd IN ('UPDATE','ALL') THEN
      IF new_check <> '' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I %s TO %s USING (%s) WITH CHECK (%s)',
          r.policyname, r.schemaname, r.tablename, cmd_kw, roles_sql, new_qual, new_check);
      ELSE
        EXECUTE format('CREATE POLICY %I ON %I.%I %s TO %s USING (%s)',
          r.policyname, r.schemaname, r.tablename, cmd_kw, roles_sql, new_qual);
      END IF;
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I %s TO %s USING (%s)',
        r.policyname, r.schemaname, r.tablename, cmd_kw, roles_sql, new_qual);
    END IF;
  END LOOP;
END $$;

-- Now the public wrappers should have no dependents
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.driver_market_id();
DROP FUNCTION IF EXISTS public.driver_owns_rental(uuid);
DROP FUNCTION IF EXISTS public.partner_owns_rental(uuid);
DROP FUNCTION IF EXISTS public.is_partner_owner(uuid);
DROP FUNCTION IF EXISTS public.partner_owns_vehicle(uuid);
