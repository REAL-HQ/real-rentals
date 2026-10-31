-- Rollback of Drizzle 0023 inner DDL. Runner owns the transaction.
-- Removes exactly the three functions and the attempts table 0023 created. Resume tokens, applications,
-- identity reviews and audit rows are kept (recovery tokens it issued expire on their own in 30 minutes).
DROP FUNCTION public.resolve_application_identity_review(uuid, text, text);
DROP FUNCTION public.finish_application_recovery(uuid, text, text);
DROP FUNCTION public.reserve_application_recovery(uuid, text);
DROP TABLE public.application_recovery_attempts;
