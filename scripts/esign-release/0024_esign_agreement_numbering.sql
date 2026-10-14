-- PROPOSED — NOT APPLIED. Agreement numbers RRA-000001.
-- Number after Codex's 0022 and the eSign template migration (provisionally 0023).
--
-- Design:
--  * A sequence hands out numbers; nextval() is atomic, so concurrent sends
--    can never receive the same number. Gaps are possible (a send that fails
--    after taking a number) and are acceptable; duplicates are not.
--  * The number is taken only inside issueAgreement, immediately before the
--    agreements insert — never during preview. Previews print
--    "Assigned When Sent", and the preview fingerprint is computed over that
--    placeholder; after the fingerprint matches, the server substitutes the
--    reserved number, renders the final body, and inserts body + number in one
--    row. The signed PDF therefore carries the number the driver signed.
--  * agreement_number is UNIQUE and immutable once set (trigger), and existing
--    rows (all pre-v1.6) keep NULL — no backfill, no change to signed records.

CREATE SEQUENCE IF NOT EXISTS public.agreement_number_seq START 1;

ALTER TABLE public.agreements ADD COLUMN IF NOT EXISTS agreement_number text;
CREATE UNIQUE INDEX IF NOT EXISTS agreements_agreement_number_key
  ON public.agreements (agreement_number) WHERE agreement_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_agreement_number()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'RRA-' || lpad(nextval('public.agreement_number_seq')::text, 6, '0')
$$;
REVOKE ALL ON FUNCTION public.next_agreement_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_agreement_number() TO service_role;

CREATE OR REPLACE FUNCTION public.agreements_number_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.agreement_number IS NOT NULL AND NEW.agreement_number IS DISTINCT FROM OLD.agreement_number THEN
    RAISE EXCEPTION 'agreement_number is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agreements_number_immutable ON public.agreements;
CREATE TRIGGER agreements_number_immutable BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.agreements_number_immutable();

-- Rollback: DROP TRIGGER agreements_number_immutable ON public.agreements;
--           DROP FUNCTION public.agreements_number_immutable(), public.next_agreement_number();
--           (column/index/sequence may stay; unused when the code path is off.)
