-- PROPOSED ONLY. Requires installed 0030. Never rewrite its SQL or receipt.
-- Runner owns transaction. Existing function ACL is explicitly narrowed.
CREATE OR REPLACE FUNCTION public.read_application_identity(_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); owner_id uuid;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
 END IF;
 -- Signed JWT claims are supplied by the API, never an RPC argument. Reject
 -- expired/revoked sessions even when a previously issued JWT is still signed.
 IF NOT EXISTS (
  SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
  WHERE s.id=(auth.jwt()->>'session_id')::uuid AND s.user_id=actor
   AND (s.not_after IS NULL OR s.not_after > now())
   AND (u.banned_until IS NULL OR u.banned_until <= now())
   AND u.deleted_at IS NULL
   AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL)
   AND (auth.jwt()->>'exp')::numeric > extract(epoch FROM now())
 ) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO owner_id FROM public.applications WHERE id=_application_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF (private.is_manager() IS TRUE OR (
   private.is_staff() IS FALSE AND owner_id IS NOT NULL AND owner_id=actor
 )) IS NOT TRUE THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 -- Sensitive columns are read only after the positive authorization check.
 RETURN (SELECT jsonb_build_object('license_number',a.license_number,
   'license_photo_url',a.license_photo_url) FROM public.applications a
   WHERE a.id=_application_id);
END;
$$;
REVOKE ALL ON FUNCTION public.read_application_identity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_application_identity(uuid) TO authenticated;
