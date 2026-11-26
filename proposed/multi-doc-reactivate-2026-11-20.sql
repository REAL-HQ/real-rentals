-- PROPOSED, NOT RUN. Reactivate files the old single-slot rule wrongly
-- superseded. Needs Dolmar's go-ahead before anyone runs it; it is not in
-- supabase/migrations on purpose.
--
-- Why: until the multi-file change, a second upload to income, gig profile,
-- license back and so on marked the first one is_current=false,
-- superseded_by=<new file>. Rosa found it on Virginia's two income documents.
--
-- Scope (read-only counts taken Nov 20 2026 12:50 PM ET):
--   42 driver files were superseded by a newer file in the same section.
--   32 of them are apply-flow retakes (label "... (from application)"): the
--       applicant replaced their own main photo within minutes. That is an
--       intentional replace and is NOT touched.
--   10 are plain vault uploads (no apply-flow label) that were superseded, in
--       two applicants:
--         A. VIRGINIA MARIE EUROPE  (70595ff8-578e-40cf-ae55-2df2851ca0dd)  income x2
--         B. Jonathon Boykins       (802fb55c-d7e8-45ae-9b40-dc5efa74753f)  income x4 + license_back x4
--
-- Part A is clear-cut and is the proposed run. Part B is held back (commented
-- out): the same four file names appear under BOTH income and license_back,
-- which looks like one multi-select landing in two sections. Someone should
-- look at those files before they are reactivated.
--
-- Each UPDATE re-checks the row (still inactive, same driver, same section,
-- has a superseder, not rejected) so running it twice, or after staff changed
-- something, does nothing extra. Rollback: set is_current=false and
-- superseded_by back to the value in the "before" list below.

BEGIN;

-- Before: what will change (read this first).
SELECT d.id, a.full_name, d.category, d.file_name, d.review_status, d.created_at, d.superseded_by
  FROM public.documents d JOIN public.applications a ON a.id = d.driver_id
 WHERE d.id IN (
   '8bbd72d4-cd8f-42e6-bd03-b89082a5d708',  -- Virginia income, Screenshot_20261120-120004
   '8743007c-a51c-4359-a45b-e739c88eb23b'   -- Virginia income, Screenshot_20261120-120756
 );

-- Part A: Virginia's two income documents. Result: 3 active income files
-- (the two below plus fd678e80-f167-43e1-b9fd-efc6c71b31e1, already active).
UPDATE public.documents
   SET is_current = true,
       superseded_by = NULL
 WHERE id IN (
         '8bbd72d4-cd8f-42e6-bd03-b89082a5d708',
         '8743007c-a51c-4359-a45b-e739c88eb23b'
       )
   AND driver_id = '70595ff8-578e-40cf-ae55-2df2851ca0dd'
   AND category = 'income'
   AND is_current = false
   AND superseded_by IS NOT NULL
   AND review_status <> 'rejected';

-- Part B (HELD): Jonathon Boykins. Uncomment only after the files are checked.
-- income:       1e12d102-2fe1-4d63-9af4-aec240567f6d, d97d44e7-9e3b-4f08-9858-638361b34251,
--               4b125be2-30fc-4745-b30c-79afdf685118, 8b9238f9-c286-4028-a886-9685f0b42bd1
-- license_back: fbe51e7a-7575-44ef-a2c4-df15054e963d, d7f513ed-7eab-4768-95e8-34330e56e16e,
--               c3b2e3df-66e0-470c-98cc-3ca6aca104fb, 398541cd-a9f6-4f73-af65-7dd10079b9aa
-- UPDATE public.documents
--    SET is_current = true, superseded_by = NULL
--  WHERE id IN ( ...the ids above that Dolmar approves... )
--    AND driver_id = '802fb55c-d7e8-45ae-9b40-dc5efa74753f'
--    AND is_current = false AND superseded_by IS NOT NULL AND review_status <> 'rejected';

-- After: Virginia should show 3 active income files.
SELECT category, count(*) FILTER (WHERE is_current) AS active, count(*) AS total
  FROM public.documents
 WHERE driver_id = '70595ff8-578e-40cf-ae55-2df2851ca0dd' AND category = 'income'
 GROUP BY category;

COMMIT;
