REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_invites FROM authenticated, anon;