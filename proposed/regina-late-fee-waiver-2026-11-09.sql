-- PREPARED, NOT RUN. Needs Dolmar's approval, after
-- supabase/migrations/20261109210000_rent_reminders.sql is applied.
-- Per Dolmar (11/9/2026): Regina's current late fees are waived. Waives the
-- whole week due Mon 11/9/2026 (her open invoice in_1UZuiAGsNNO50lXb92JBA4KO,
-- created 11/9). waived_through NULL = the whole week. Re-running changes nothing.
-- If he meant only "through today", set waived_through = '2026-11-09' instead.
INSERT INTO public.rent_late_fee_waivers (rental_id, due_date, waived_through, reason, waived_by, waived_by_email)
VALUES ('d8fbb519-db84-4b33-8669-7c62474d6bfd', '2026-11-09', NULL,
        'Waived per Dolmar 11/9/2026.',
        (SELECT id FROM auth.users WHERE lower(email) = 'dolmarcross@gmail.com' LIMIT 1), 'dolmarcross@gmail.com')
ON CONFLICT (rental_id, due_date) DO NOTHING;
SELECT rental_id, due_date, waived_through, reason, waived_by_email, created_at FROM public.rent_late_fee_waivers
 WHERE rental_id = 'd8fbb519-db84-4b33-8669-7c62474d6bfd';
