insert into private.cron_tokens(name, token)
values ('ops-reminders', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

select cron.schedule(
  'ops-reminders-daily',
  '30 13 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://drivereal.com/api/public/cron/ops-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM private.cron_tokens WHERE name = 'ops-reminders')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);