-- Add Declined to Contact Status without changing any existing row or the
-- separate applications.status lifecycle. The server function already derives
-- its allowed values from the shared Contact Status vocabulary.
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_contact_status_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_contact_status_check
  CHECK (contact_status IN (
    'new', 'attempted', 'voicemail', 'contacted', 'interested',
    'follow_up', 'documents', 'unqualified', 'declined', 'unresponsive'
  ));