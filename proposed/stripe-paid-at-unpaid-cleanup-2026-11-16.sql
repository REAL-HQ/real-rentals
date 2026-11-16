-- PREPARED, NOT RUN. Needs Dolmar's approval. Do not apply from a bot.
--
-- Read-only prod audit on 2026-11-16 (America/New_York):
--   2 payments rows have stripe_paid_at set but status is not 'paid'
--   (and not 'refunded'). paid_date is already null on both. net_collected is 0.
--
--   39affb68-56ad-4af6-99fb-fcdb879b5b6a  Regina
--     rental d8fbb519-db84-4b33-8669-7c62474d6bfd
--     invoice in_1UcS37GsNNO50lXbmWqL9CBh  BUKZ1ZXD-0006
--     status failed, amount 350.00, stripe_paid_at 2026-11-16 15:42:28+00
--
--   3fa3f400-4297-4d4b-ae15-04dafdcea6a7  Damon T Sykes
--     rental 83668a8d-1868-45c5-bb20-38f54491ab6c
--     invoice in_1UYZLOGsNNO50lXbh7cqIPbS  WTQPN3BV-0003
--     status failed, amount 350.00, stripe_paid_at 2026-11-05 22:41:18+00
--
-- Cause: extractPaymentReceiptFields fell back to invoice.created when
-- status_transitions.paid_at was null, so a failed or open invoice looked paid.
-- This statement only nulls stripe_paid_at on those unpaid rows. It does not
-- change status, amount, paid_date, balance_due, or send any notice.
-- Refunded rows are left alone (they were collected).
-- Idempotent: a second run updates 0 rows after the first commit.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payments_stripe_paid_at_unpaid_backup_20261116 (
  LIKE public.payments INCLUDING ALL
);

INSERT INTO public.payments_stripe_paid_at_unpaid_backup_20261116
SELECT p.*
FROM public.payments p
WHERE p.stripe_paid_at IS NOT NULL
  AND p.status IS DISTINCT FROM 'paid'
  AND p.status IS DISTINCT FROM 'refunded'
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments_stripe_paid_at_unpaid_backup_20261116 b
    WHERE b.id = p.id
  );

UPDATE public.payments
SET stripe_paid_at = NULL
WHERE stripe_paid_at IS NOT NULL
  AND status IS DISTINCT FROM 'paid'
  AND status IS DISTINCT FROM 'refunded';

-- Review the update count (expected 2 on 2026-11-16), then COMMIT;
-- Leave the transaction open until that review is done.
-- COMMIT;

-- Rollback after COMMIT, if needed:
-- BEGIN;
-- UPDATE public.payments p
-- SET stripe_paid_at = b.stripe_paid_at
-- FROM public.payments_stripe_paid_at_unpaid_backup_20261116 b
-- WHERE p.id = b.id;
-- COMMIT;
