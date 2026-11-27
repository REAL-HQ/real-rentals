-- DNC list: staff can see the contact details on the DNC tab and search by phone / email.
-- Requested by Dolmar Nov 27 2026 (12:10 PM ET). DO NOT apply to production until Dolmar approves.
--
-- 20261127170000_internal_dnc_list.sql granted authenticated column SELECT on the display
-- columns only. This adds phones and emails to that grant. Nothing else changes:
--   * RLS stays enabled and forced; the only authenticated policy is "Staff read DNC list"
--     (private.is_staff()), so non-staff accounts still read no rows.
--   * anon still has nothing. No INSERT / UPDATE / DELETE for anon or authenticated; every write
--     still goes through the server after a role check, and is audited.
-- The DNC tab itself reads through a staff-checked server function (service role), so the app
-- works with or without this grant; it keeps a staff session's direct read consistent with what
-- the tab shows. Re-runnable.

GRANT SELECT (phones, emails) ON public.dnc_list TO authenticated;

-- Rollback (back to display columns only; a column-level REVOKE works here because the
-- previous migration never granted table-level SELECT):
-- REVOKE SELECT (phones, emails) ON public.dnc_list FROM authenticated;
