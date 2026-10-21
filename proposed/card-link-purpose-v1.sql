-- LOCAL PROPOSAL. Not a migration. Do not run against a hosted database.
--
-- application_resume_tokens has no purpose column. A card-on-file link minted
-- into that table is therefore indistinguishable from a thank-you resume link.
-- This adds the column the server already tries to write.
--
-- Existing rows stay NULL, which means resume. Resume inserts omit the column,
-- so thank-you links keep working before and after this runs. Card inserts set
-- purpose = 'card'. Until this column exists, card issuance fails and does not
-- fall back to an unscoped token. /thank-you rejects purpose = 'card'.
-- createCardOnFileSession accepts only purpose = 'card'.

ALTER TABLE public.application_resume_tokens
  ADD COLUMN IF NOT EXISTS purpose text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_resume_tokens_purpose_check'
  ) THEN
    ALTER TABLE public.application_resume_tokens
      ADD CONSTRAINT application_resume_tokens_purpose_check
      CHECK (purpose IS NULL OR purpose IN ('resume', 'card'));
  END IF;
END $$;

COMMENT ON COLUMN public.application_resume_tokens.purpose IS
  'NULL or resume opens /thank-you. card is accepted only by createCardOnFileSession and must not open the application wizard.';
