-- =============================================================================
-- Two corrections found by running the newly deployed onboarding flow.
--
-- 1. Expected duration moves to a month scale, because that is how these
--    rentals actually run. The old week-scale values are KEPT in the check
--    constraint: eighteen applications answered with them and nothing here
--    rewrites an answer somebody gave. They are simply no longer offered.
--
--    This is not a qualification rule and nothing anywhere treats it as one.
--    There is no submission gate on duration, and no applicant is ranked or
--    filtered by their answer.
--
-- 2. Trip screenshots get their own document category. They were filed as
--    'gig_profile', and registerDocument marks same-category currents as
--    superseded — so every trip screenshot knocked out the applicant's actual
--    gig profile, and each other. The live test application ended up with its
--    real gig profile marked not-current and a trip screenshot wearing its
--    label.
--
--    The repair is derived from the application's own columns rather than
--    written by hand: a path that appears in applications.trip_screenshots is
--    trip history, a path in profile_screenshot_url is the gig profile. No
--    document row is created here — only mis-filed ones are corrected — and
--    no storage object is touched.
-- =============================================================================

-- ------------------------------------------------- 1. duration vocabulary
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_expected_duration_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_expected_duration_check
  CHECK (expected_duration IS NULL OR expected_duration IN (
    -- Current, offered to applicants.
    '1_month','2_months','3_months','4plus_months','not_sure',
    -- Historical, preserved. Never offered again, never rewritten.
    '1-2_weeks','3-4_weeks','1-2_months','2plus_months','ongoing'
  ));

COMMENT ON COLUMN public.applications.expected_duration IS
  'Applicant intent at application time, not a contract term and not a qualification rule. Month-scale values are current; week-scale values are historical and preserved as given. The authoritative rental period lives on the rental; see rentals.start_date / end_date.';

-- -------------------------------------------- 2. trip history, its own slot
--
-- Re-file trip screenshots that were registered as gig profiles. Matched by
-- storage_path against the application's own array, so a row is only touched
-- when the application itself says that object is a trip screenshot.
UPDATE public.documents d
   SET category = 'trip_history',
       kind = 'trip_history',
       label = COALESCE(d.label, 'Trip screenshot (from application)')
  FROM public.applications a
 WHERE d.driver_id = a.id
   AND d.category = 'gig_profile'
   AND a.trip_screenshots IS NOT NULL
   AND d.storage_path = ANY (
     SELECT jsonb_array_elements_text(to_jsonb(a.trip_screenshots))
   );

-- Restore a gig profile that a mis-filed trip screenshot had superseded. Only
-- where the application still names that exact object as its gig profile.
UPDATE public.documents d
   SET is_current = true,
       superseded_by = NULL
  FROM public.applications a
 WHERE d.driver_id = a.id
   AND d.category = 'gig_profile'
   AND d.is_current = false
   AND d.storage_path = a.profile_screenshot_url;

-- Every trip screenshot the application still names is current evidence. One
-- did not supersede another; they are a set.
UPDATE public.documents d
   SET is_current = true,
       superseded_by = NULL
  FROM public.applications a
 WHERE d.driver_id = a.id
   AND d.category = 'trip_history'
   AND d.is_current = false
   AND a.trip_screenshots IS NOT NULL
   AND d.storage_path = ANY (
     SELECT jsonb_array_elements_text(to_jsonb(a.trip_screenshots))
   );

COMMENT ON COLUMN public.documents.category IS
  'Vault category. license_front, license_back, insurance, gig_profile, trip_history, agreement, other, verification_recording. trip_history and other hold several current files at once; the rest are single-slot and a new upload supersedes the previous one.';
