-- =============================================================================
-- Restore the second layer on audit_log and staff_invites
--
-- 20260925160000 states that the audit log is append-only "twice over: no
-- write POLICY and no write GRANT". On a real Supabase project only the first
-- half was true.
--
-- Supabase ships an ALTER DEFAULT PRIVILEGES rule that grants ALL on newly
-- created tables in `public` to anon, authenticated and service_role. So the
-- moment CREATE TABLE ran, `authenticated` already held INSERT, UPDATE and
-- DELETE. The migration then added `GRANT SELECT`, which changed nothing it
-- did not already have, and never revoked the rest.
--
-- A local PostgreSQL replay has no such default-privileges rule, which is
-- exactly why this passed in testing and not in production: the local run was
-- verifying the absence of a grant that only production ever created.
--
-- The security outcome was never wrong — RLS refused every write, because
-- neither table has an INSERT/UPDATE/DELETE policy, and that was confirmed
-- against production with all three tiers. But defence in depth was one layer
-- rather than two, and the comment in the file claimed otherwise.
--
-- Scoped deliberately:
--
--   * `authenticated` is the role every browser session runs as. It keeps
--     SELECT and loses everything else.
--   * `anon` loses everything. A signed-out visitor has no business reading
--     who is on the team or what the staff did.
--   * `service_role` keeps INSERT. It is the only path an audit entry is ever
--     written through, so revoking it would stop the log recording anything
--     while appearing to succeed.
--
-- Not touched: vehicle_expenses, payments, toll_charges, deposit_deductions
-- and maintenance_records all carry the same default `anon` grants. That is
-- the pre-existing project-wide baseline, it predates these migrations, and
-- RLS refuses anon on all of them since none has an anon-facing policy.
-- Changing one of them here would be inconsistent and out of scope.
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log     FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_invites FROM authenticated;

REVOKE ALL ON public.audit_log     FROM anon;
REVOKE ALL ON public.staff_invites FROM anon;

-- Re-assert the end state explicitly rather than leaving it to be inferred
-- from whatever survived the revokes above.
GRANT SELECT ON public.audit_log     TO authenticated;
GRANT SELECT ON public.staff_invites TO authenticated;
GRANT SELECT, INSERT ON public.audit_log                     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invites TO service_role;

COMMENT ON TABLE public.audit_log IS
  'Append-only record of who did what. From any browser session (role
   `authenticated`) writes are refused twice: no INSERT/UPDATE/DELETE policy,
   and no INSERT/UPDATE/DELETE grant. Entries are written only by server
   functions through the service role.';
