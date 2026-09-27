-- =============================================================================
-- The AI assessment columns become service-role only.
--
-- ai_summary and ai_flags are free-form text a language model wrote. Everything
-- that reaches them has to pass the assessment guard first — no eligibility
-- threshold, no verdict — because that text lands on the applicant's record,
-- staff read it, and a staff member may repeat it to the applicant on the
-- phone. REAL RENTALS publishes no trip requirement, and a sentence in this
-- column saying otherwise is the requirement, whatever the marketing says.
--
-- The guard runs server-side in runScoring(). Until now the admin UI also
-- wrote these columns straight from the browser on the staff member's own
-- session: the values happened to be guarded ones the server had just
-- persisted, so nothing bad was stored, but the column was writable with
-- arbitrary content by anybody holding a staff session and a PostgREST client.
-- A guard you can go around is a convention, not a control.
--
-- That UI write is gone, and this closes the door behind it. Column-level
-- privileges are checked independently of RLS, so this holds for direct
-- PostgREST calls as well as anything in the app. service_role — which is what
-- runScoring uses — is unaffected.
--
-- Note the shape of the grant: revoking UPDATE on specific columns only works
-- if the role does not also hold table-wide UPDATE, so the table-wide grant is
-- replaced by an explicit column list. Any column added to `applications` in
-- future is therefore NOT updatable by `authenticated` until it is added here.
-- That is deliberate — a new column defaults to closed — but it is a real
-- maintenance obligation and the failure mode is a silent "permission denied
-- for table applications" in the admin UI.
-- =============================================================================

DO $$
DECLARE
  cols text;
BEGIN
  -- Every column except the four the model writes and the timestamp that says
  -- when it last spoke.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'applications'
     AND column_name NOT IN ('ai_summary', 'ai_flags', 'ai_score', 'ai_tier', 'scored_at');

  EXECUTE 'REVOKE UPDATE ON public.applications FROM authenticated';
  EXECUTE format('GRANT UPDATE (%s) ON public.applications TO authenticated', cols);
END $$;

-- anon has no business updating applications at all; this is belt and braces.
REVOKE UPDATE ON public.applications FROM anon;

COMMENT ON COLUMN public.applications.ai_summary IS
  'Model-written prose. SERVICE ROLE ONLY: every write must pass
   sanitizeAssessment() in src/lib/assessment-guard.ts, which strips eligibility
   thresholds and verdicts. Not updatable by `authenticated`.';
COMMENT ON COLUMN public.applications.ai_flags IS
  'Model-written labels. SERVICE ROLE ONLY, same guard as ai_summary.';
