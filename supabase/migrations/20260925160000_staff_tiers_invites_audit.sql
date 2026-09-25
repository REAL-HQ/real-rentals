-- =============================================================================
-- Staff tiers, email invitations, and an audit trail
--
-- Until now "back office access" was one thing: role = 'admin'. The Team panel
-- could grant a 'team' role, but nothing honoured it — admin.tsx admits only
-- 'admin' — and user_roles has no INSERT policy, so the grant was refused by
-- RLS anyway. Team management has never actually worked.
--
-- This introduces three tiers:
--
--   admin        Owner       everything, including team and settings
--   team         Manager     all operations including money; not team/settings
--   coordinator  Coordinator applicants, drivers, vehicles, inspections, docs
--                            — no money, anywhere
--
-- ORDER MATTERS BELOW. is_staff() is widened to include coordinator, and a
-- dozen existing policies are written in terms of is_staff(). So the money
-- tables are re-pointed at is_manager() BEFORE is_staff() changes meaning.
-- Reversing those two steps would hand every coordinator the ledger.
-- =============================================================================

-- ---------------------------------------------------------------- 1. the role
--
-- ALTER TYPE ... ADD VALUE may run inside a transaction on PG12+, but the new
-- value cannot be *used* in that same transaction. Every helper below therefore
-- compares role::text rather than casting a literal to app_role — otherwise
-- CREATE FUNCTION would fail parsing 'coordinator'::app_role while this
-- migration is still open.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'coordinator';

-- --------------------------------------------------------------- 2. helpers

-- Owner. Grants and revokes access, changes settings.
CREATE OR REPLACE FUNCTION private.is_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text = 'admin'
  )
$$;
REVOKE ALL ON FUNCTION private.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_owner() TO authenticated, service_role;

-- Anyone trusted with money: rent, deposits, tolls, expenses, agreements.
CREATE OR REPLACE FUNCTION private.is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin', 'team')
  )
$$;
REVOKE ALL ON FUNCTION private.is_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_manager() TO authenticated, service_role;

COMMENT ON FUNCTION private.is_manager() IS
  'True for Owner and Manager. Gates every table that carries money. A
   Coordinator is staff but is deliberately NOT a manager.';

-- ------------------------------------- 3. re-point money BEFORE widening staff

-- These three are currently `is_staff()`, which is about to include
-- coordinators. Narrow them first.
DROP POLICY IF EXISTS "Staff manage deposit deductions" ON public.deposit_deductions;
DROP POLICY IF EXISTS "Managers manage deposit deductions" ON public.deposit_deductions;
CREATE POLICY "Managers manage deposit deductions" ON public.deposit_deductions
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Staff manage toll charges" ON public.toll_charges;
DROP POLICY IF EXISTS "Managers manage toll charges" ON public.toll_charges;
CREATE POLICY "Managers manage toll charges" ON public.toll_charges
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Staff manage incidents" ON public.incidents;
DROP POLICY IF EXISTS "Managers manage incidents" ON public.incidents;
CREATE POLICY "Managers manage incidents" ON public.incidents
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- Automations spend money (every SMS costs) and are configuration, not casework.
DROP POLICY IF EXISTS "Staff manage automation workflows" ON public.automation_workflows;
DROP POLICY IF EXISTS "Managers manage automation workflows" ON public.automation_workflows;
CREATE POLICY "Managers manage automation workflows" ON public.automation_workflows
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Staff manage automation steps" ON public.automation_steps;
DROP POLICY IF EXISTS "Managers manage automation steps" ON public.automation_steps;
CREATE POLICY "Managers manage automation steps" ON public.automation_steps
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- Already admin-only; widen to Manager so a manager can do the job, and no
-- further.
DROP POLICY IF EXISTS "Admins manage payments" ON public.payments;
DROP POLICY IF EXISTS "Managers manage payments" ON public.payments;
CREATE POLICY "Managers manage payments" ON public.payments
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Admins manage agreements" ON public.agreements;
DROP POLICY IF EXISTS "Managers manage agreements" ON public.agreements;
CREATE POLICY "Managers manage agreements" ON public.agreements
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

DROP POLICY IF EXISTS "Admins manage maintenance" ON public.maintenance_records;
DROP POLICY IF EXISTS "Managers manage maintenance" ON public.maintenance_records;
CREATE POLICY "Managers manage maintenance" ON public.maintenance_records
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- -------------------------------------------------------- 4. widen is_staff()
--
-- Safe now: everything with a dollar sign in it points at is_manager().
CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin', 'team', 'coordinator')
  )
$$;
REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated, service_role;

COMMENT ON FUNCTION private.is_staff() IS
  'True for anyone with back-office access: Owner, Manager or Coordinator.
   Gates casework. Money is gated by is_manager() instead.';

-- ------------------------------------------- 5. the Coordinator''s actual job

-- Applicants: read and vet. Deleting an applicant stays with managers.
DROP POLICY IF EXISTS "Admins can view applications" ON public.applications;
DROP POLICY IF EXISTS "Staff view applications" ON public.applications;
CREATE POLICY "Staff view applications" ON public.applications
  FOR SELECT TO authenticated USING (private.is_staff());

DROP POLICY IF EXISTS "Admins can update applications" ON public.applications;
DROP POLICY IF EXISTS "Staff update applications" ON public.applications;
CREATE POLICY "Staff update applications" ON public.applications
  FOR UPDATE TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

DROP POLICY IF EXISTS "Admins can delete applications" ON public.applications;
DROP POLICY IF EXISTS "Managers delete applications" ON public.applications;
CREATE POLICY "Managers delete applications" ON public.applications
  FOR DELETE TO authenticated USING (private.is_manager());

-- Documents: a coordinator verifying a licence needs to see and file them.
DROP POLICY IF EXISTS "Admins manage all documents" ON public.documents;
DROP POLICY IF EXISTS "Staff manage all documents" ON public.documents;
CREATE POLICY "Staff manage all documents" ON public.documents
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Screening results are the vetting record itself.
DROP POLICY IF EXISTS "Admins manage screenings" ON public.driver_screenings;
DROP POLICY IF EXISTS "Staff manage screenings" ON public.driver_screenings;
CREATE POLICY "Staff manage screenings" ON public.driver_screenings
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());

-- Vehicles: staff may look, managers may change. Rates and purchase price live
-- on this table, so writes are a money decision.
DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Managers manage vehicles" ON public.vehicles;
CREATE POLICY "Managers manage vehicles" ON public.vehicles
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());

-- Rentals: a coordinator must see who has which car; starting and ending one
-- (deposits, rates) stays with managers.
DROP POLICY IF EXISTS "Admins manage all rentals" ON public.rentals;
DROP POLICY IF EXISTS "Managers manage rentals" ON public.rentals;
CREATE POLICY "Managers manage rentals" ON public.rentals
  FOR ALL TO authenticated USING (private.is_manager()) WITH CHECK (private.is_manager());
DROP POLICY IF EXISTS "Staff read rentals" ON public.rentals;
CREATE POLICY "Staff read rentals" ON public.rentals
  FOR SELECT TO authenticated USING (private.is_staff());

-- ------------------------------------------------------- 6. user_roles itself
--
-- user_roles had exactly one policy — "view your own" — and no write policy at
-- all, so every grant from the browser was silently refused. Writes stay
-- server-side (service role), and owners get a read of the whole table so the
-- Team panel can list people.
DROP POLICY IF EXISTS "Owners read all role assignments" ON public.user_roles;
CREATE POLICY "Owners read all role assignments" ON public.user_roles
  FOR SELECT TO authenticated USING (private.is_owner());

COMMENT ON TABLE public.user_roles IS
  'Role grants. Deliberately has no INSERT/UPDATE/DELETE policy: every change
   goes through a server function running as the service role, so it can be
   audited and can enforce the last-owner rule.';

-- ----------------------------------------------------------- 7. invitations

CREATE TABLE IF NOT EXISTS public.staff_invites (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL,
  -- SHA-256 of the token that went out in the email. The raw token is never
  -- stored, so a dump of this table cannot be used to accept an invitation.
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by_email text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One live invitation per email address. Revoked and accepted ones don't count,
-- so an address can be re-invited after either.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_one_pending_per_email_idx
  ON public.staff_invites (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_invites_pending_idx
  ON public.staff_invites (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;

-- Owners can see who has been invited. Nobody writes from the browser — accept
-- runs server-side, because it has to verify a token the client must not be
-- able to look up.
DROP POLICY IF EXISTS "Owners read invites" ON public.staff_invites;
CREATE POLICY "Owners read invites" ON public.staff_invites
  FOR SELECT TO authenticated USING (private.is_owner());

-- Grants are spelled out rather than left to Supabase's default privileges.
-- A missing grant is what silently broke applicant uploads for two months:
-- the policy was correct and the privilege underneath it was not. Note the
-- absence of INSERT/UPDATE/DELETE — invitations are created and accepted by
-- server functions only, so the browser has no write path at all.
GRANT SELECT ON public.staff_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invites TO service_role;

-- ------------------------------------------------------------ 8. audit trail

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_role text,
  -- Verb, past tense: 'application.approved', 'rental.activated',
  -- 'role.granted', 'expense.deleted'.
  action text NOT NULL,
  entity_type text,
  entity_id text,
  -- One line a human can read without opening the metadata.
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_recent_idx  ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx  ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON public.audit_log (actor_user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Readable by managers, writable by nobody. Entries are written by server
-- functions through the service role, which bypasses RLS. With no UPDATE or
-- DELETE policy the trail cannot be edited or erased from the application at
-- all — which is the only thing that makes it worth keeping.
DROP POLICY IF EXISTS "Managers read the audit log" ON public.audit_log;
CREATE POLICY "Managers read the audit log" ON public.audit_log
  FOR SELECT TO authenticated USING (private.is_manager());

-- Append-only is enforced twice over: no write POLICY (above) and no write
-- GRANT (here). Either alone would do it; together, a future migration that
-- adds a policy by mistake still cannot make the log editable from a browser.
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;

COMMENT ON TABLE public.audit_log IS
  'Append-only record of who did what. Writes have neither a policy nor a
   grant, so the trail cannot be edited or erased from any browser session
   regardless of role. Entries are inserted by server functions through the
   service role.';
