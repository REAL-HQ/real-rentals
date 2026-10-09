-- PROPOSED — NOT APPLIED. Vehicle Delete Safety, Phase 1.
-- Number: assigned at approval time (next free after the journal; never 0022,
-- which is reserved for Codex's Application Resume release).
--
-- Removes direct DELETE on vehicles from browser roles. The "Managers manage
-- vehicles" policy stays, so Manager SELECT/INSERT/UPDATE are unchanged.
-- Permanent deletion remains possible only through the Owner-only server
-- function (service role), which refuses any vehicle with linked records.
REVOKE DELETE ON public.vehicles FROM authenticated;
REVOKE DELETE ON public.vehicles FROM anon;

-- ROLLBACK (separate approval):
-- GRANT DELETE ON public.vehicles TO authenticated;
