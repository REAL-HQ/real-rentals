-- PROPOSED, NOT APPLIED, NOT IN supabase/migrations. Needs Dolmar's approval.
-- Florida 812.155 Addendum: groundwork for a LATER change that sends the
-- addendum through eSign (esign.server.ts) instead of print-and-upload.
--
-- The PR that adds the addendum (v1.15 PR) needs NO database change: staff
-- preview it, and once the Owner approves the wording they print it and file
-- the signed copy with the existing Paper Agreements upload.
--
-- eSign sending would store the addendum as its own kind of agreements row so
-- it can never count as the renter's rental agreement (activation, Reservation
-- Fee charge after signing, FLEET "agreement signed", portal agreement state
-- all read public.agreements without a source filter today). That code audit
-- and the send path are NOT built; this file only records the schema step.

BEGIN;
ALTER TABLE public.agreements DROP CONSTRAINT IF EXISTS agreements_source_chk;
ALTER TABLE public.agreements
  ADD CONSTRAINT agreements_source_chk CHECK (source IN ('rental', 'standalone', 'addendum'));
-- An addendum always belongs to a renter's application.
ALTER TABLE public.agreements DROP CONSTRAINT IF EXISTS agreements_addendum_app_chk;
ALTER TABLE public.agreements
  ADD CONSTRAINT agreements_addendum_app_chk CHECK (source <> 'addendum' OR application_id IS NOT NULL);
COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.agreements DROP CONSTRAINT IF EXISTS agreements_addendum_app_chk;
-- ALTER TABLE public.agreements DROP CONSTRAINT IF EXISTS agreements_source_chk;
-- ALTER TABLE public.agreements ADD CONSTRAINT agreements_source_chk CHECK (source IN ('rental','standalone'));
-- COMMIT;
