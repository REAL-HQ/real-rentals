-- Negative sample (harness only): touches audit history. Must be refused by the lint.
CREATE OR REPLACE FUNCTION private.approval_actor_label() RETURNS text LANGUAGE sql AS $f$ SELECT 'x' $f$;
UPDATE public.audit_log SET summary = 'rewritten' WHERE action = 'application.approved';
