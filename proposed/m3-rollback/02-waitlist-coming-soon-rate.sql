-- Rollback for HOSTED-INSTALL step 2: proposed/m3-packet/02-waitlist-coming-soon-rate.sql
-- Drops the rate trigger, function, and index. It does not change
-- waitlist grants, and it does not drop claim_token_hash.

BEGIN;
SET LOCAL lock_timeout = '2s';

DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit ON public.waitlist;
DROP FUNCTION IF EXISTS public.waitlist_coming_soon_email_limit();
DROP INDEX IF EXISTS public.waitlist_coming_soon_email_created_idx;

COMMIT;
