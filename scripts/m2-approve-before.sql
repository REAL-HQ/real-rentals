-- Baseline Approve. The approval triggers are not installed, so the legacy
-- service-role write succeeds. One transaction, then ROLLBACK.
-- Run this before the packet. After the packet, the same write is refused
-- and scripts/m2-functional-proof.sql records that refusal.
BEGIN;
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('11111111-1111-4111-8111-111111111111','manager-before@example.test', now());
INSERT INTO public.applications (id, full_name, email, phone, status)
VALUES (
 '44444444-4444-4444-8444-444444444444',
 'Before Driver','before@example.test','5551234567','reviewing'
);
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
UPDATE public.applications SET status = 'approved'
 WHERE id = '44444444-4444-4444-8444-444444444444';
INSERT INTO public.audit_log (actor_user_id, action, entity_type, entity_id, summary)
VALUES (
 '11111111-1111-4111-8111-111111111111',
 'application.approved','application',
 '44444444-4444-4444-8444-444444444444',
 'Approved before the packet');
DO $$
BEGIN
 IF (SELECT status FROM public.applications WHERE id='44444444-4444-4444-8444-444444444444')
  IS DISTINCT FROM 'approved' THEN
  RAISE EXCEPTION 'baseline approve did not write status';
 END IF;
 IF (SELECT count(*) FROM public.audit_log
     WHERE action='application.approved'
       AND entity_id='44444444-4444-4444-8444-444444444444') <> 1 THEN
  RAISE EXCEPTION 'baseline approve did not write the audit';
 END IF;
 RAISE NOTICE 'RESULT approve before install pass';
END $$;
ROLLBACK;
