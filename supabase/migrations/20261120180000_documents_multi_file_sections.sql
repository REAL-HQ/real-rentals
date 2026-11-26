-- Multiple active files per document section.
--
-- No table, column, index or policy changes. Every document category except
-- agreements and rental applications now keeps all of its files active:
-- uploading a second income proof, gig profile, license side, insurance card,
-- registration or other document no longer supersedes the first. A file leaves
-- the active list only when staff archive it (is_current=false,
-- superseded_by NULL) or replace it on purpose (is_current=false,
-- superseded_by=<the new file>). Both are reversible; nothing is deleted.
--
-- This migration only updates the documentation on the columns. It does not
-- touch any row. The proposed one-time reactivation of files that the old
-- behaviour wrongly superseded is NOT a migration: it is
-- proposed/multi-doc-reactivate-2026-11-20.sql, reviewed and run separately.

COMMENT ON COLUMN public.documents.is_current IS
  'True while the file is on the active list. A section can hold several active files. Cleared when staff archive the file or replace it on purpose; never cleared just because a newer file was uploaded (agreements and rental applications excepted, which keep one current record).';

COMMENT ON COLUMN public.documents.superseded_by IS
  'Set when the file was replaced on purpose by the named newer file. NULL on an inactive file means staff archived it. Restore sets is_current back to true and clears this.';

COMMENT ON COLUMN public.documents.category IS
  'Vault category. license_front, license_back, insurance, insurance_quote, income, gig_profile, trip_history, screening, other and verification_recording keep every file active; agreement and rental_application are single-record and a new upload supersedes the previous one.';
