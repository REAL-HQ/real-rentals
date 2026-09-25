-- lovable-cron-fallback-reviewed: automation steps are time-delayed sends (5 min / 1 day / 3 days after enrollment) with no provider-side scheduling, so a 5-minute sweep of due enrollments is the only way to hit the promised first-message window; 288 runs/day.

-- ---------------------------------------------------------- 9. cron plumbing

INSERT INTO private.cron_tokens (name, token)
VALUES ('automations', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'automations-every-5-min';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'automations-every-5-min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://drivereal.com/api/public/cron/automations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'automations')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);

-- ------------------------------------------- 10. storage access for new areas

DROP POLICY IF EXISTS "Staff manage condition media objects" ON storage.objects;
CREATE POLICY "Staff manage condition media objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'condition-media' AND private.is_staff())
  WITH CHECK (bucket_id = 'condition-media' AND private.is_staff());

DROP POLICY IF EXISTS "Staff manage vehicle doc objects" ON storage.objects;
CREATE POLICY "Staff manage vehicle doc objects" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-docs' AND private.is_staff())
  WITH CHECK (bucket_id = 'vehicle-docs' AND private.is_staff());

-- ---------------------------------------------- 11. default seed content

INSERT INTO public.inspection_templates (name, inspection_type, description, is_default)
SELECT 'Pre-Delivery Inspection', 'pre_delivery',
       'Run before every vehicle leaves the lot. Critical items block release.', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.inspection_templates WHERE inspection_type = 'pre_delivery' AND is_default
);

INSERT INTO public.inspection_template_items (template_id, section, label, requires_photo, is_critical, sort_order)
SELECT t.id, v.section, v.label, v.requires_photo, v.is_critical, v.sort_order
FROM public.inspection_templates t
CROSS JOIN (VALUES
  ('Exterior', 'Body free of new dents, dings or scratches', true,  false, 10),
  ('Exterior', 'Windshield free of cracks and chips',        false, true,  20),
  ('Exterior', 'All lights working (head, tail, brake, turn)', false, true,  30),
  ('Exterior', 'Mirrors intact and adjustable',              false, false, 40),
  ('Tires',    'Tread depth above 4/32" on all four tires',  true,  true,  50),
  ('Tires',    'Tire pressure set to door-jamb spec',        false, true,  60),
  ('Tires',    'Spare tire / inflation kit present',         false, false, 70),
  ('Fluids',   'Oil level and life within range',            false, true,  80),
  ('Fluids',   'Coolant, brake and washer fluid topped off', false, false, 90),
  ('Brakes',   'No grinding or pulling on test drive',       false, true,  100),
  ('Interior', 'Interior cleaned and detailed',              true,  false, 110),
  ('Interior', 'A/C and heat blow cold and hot',             false, true,  120),
  ('Interior', 'Seat belts latch and retract',               false, true,  130),
  ('Interior', 'No active dashboard warning lights',         true,  true,  140),
  ('Docs',     'Registration in glovebox and unexpired',     true,  true,  150),
  ('Docs',     'Insurance card in glovebox and unexpired',   true,  true,  160),
  ('Tech',     'GPS tracker online and reporting',           false, true,  170),
  ('Tech',     'Toll transponder present and mounted',       false, false, 180),
  ('Handover', 'Both key fobs present and working',          false, true,  190),
  ('Handover', 'Fuel level recorded and photographed',       true,  false, 200),
  ('Handover', 'Odometer recorded and photographed',         true,  true,  210)
) AS v(section, label, requires_photo, is_critical, sort_order)
WHERE t.inspection_type = 'pre_delivery' AND t.is_default
  AND NOT EXISTS (SELECT 1 FROM public.inspection_template_items i WHERE i.template_id = t.id);

INSERT INTO public.inspection_templates (name, inspection_type, description, is_default)
SELECT 'Return Inspection', 'return',
       'Run when a vehicle comes back. Compare against the checkout photos.', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.inspection_templates WHERE inspection_type = 'return' AND is_default
);

INSERT INTO public.inspection_template_items (template_id, section, label, requires_photo, is_critical, sort_order)
SELECT t.id, v.section, v.label, v.requires_photo, v.is_critical, v.sort_order
FROM public.inspection_templates t
CROSS JOIN (VALUES
  ('Exterior', 'New damage compared to checkout photos', true,  true,  10),
  ('Tires',    'Tread and pressure still within spec',   false, true,  20),
  ('Interior', 'Interior condition and cleanliness',     true,  false, 30),
  ('Interior', 'No new dashboard warning lights',        false, true,  40),
  ('Handover', 'Odometer recorded and photographed',     true,  true,  50),
  ('Handover', 'Fuel level recorded and photographed',   true,  false, 60),
  ('Handover', 'Both key fobs returned',                 false, true,  70),
  ('Handover', 'Toll transponder returned',              false, false, 80),
  ('Handover', 'Personal belongings removed',            false, false, 90)
) AS v(section, label, requires_photo, is_critical, sort_order)
WHERE t.inspection_type = 'return' AND t.is_default
  AND NOT EXISTS (SELECT 1 FROM public.inspection_template_items i WHERE i.template_id = t.id);

INSERT INTO public.automation_workflows
  (name, description, trigger_event, is_active, stop_on_statuses)
SELECT 'New Applicant Follow-Up',
       'Texts a new applicant within minutes, then nudges at 1 day and 3 days if they have not been approved.',
       'application_submitted', false, ARRAY['approved','rejected','active']
WHERE NOT EXISTS (
  SELECT 1 FROM public.automation_workflows WHERE trigger_event = 'application_submitted'
);

INSERT INTO public.automation_steps (workflow_id, step_order, delay_minutes, channel, body)
SELECT w.id, v.step_order, v.delay_minutes, 'sms', v.body
FROM public.automation_workflows w
CROSS JOIN (VALUES
  (1, 5,    'Hi {{first_name}}, it''s REAL RENTALS — thanks for applying! We''re reviewing your application now and will reach out shortly. Questions? Just reply here. Reply STOP to opt out.'),
  (2, 1440, 'Hi {{first_name}}, REAL RENTALS here. Your application is still open — we just need a few details to get you approved. Reply here or call us at (813) 699-9118. Reply STOP to opt out.'),
  (3, 4320, 'Hi {{first_name}}, last check-in from REAL RENTALS — we still have vehicles available in {{city}}. Want us to hold one for you? Reply YES. Reply STOP to opt out.')
) AS v(step_order, delay_minutes, body)
WHERE w.trigger_event = 'application_submitted'
  AND NOT EXISTS (SELECT 1 FROM public.automation_steps s WHERE s.workflow_id = w.id);