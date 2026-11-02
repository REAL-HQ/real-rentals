#!/usr/bin/env bash
# LOCAL ONLY: replays the exact staging submissions (sysid swapped) on a fresh local DB prepared like build-baseline.sh.
set -uo pipefail; H="$(cd "$(dirname "$0")" && pwd)"; R="$H/../../.."; DB=postgres
P="psql -h /tmp -p 55499 -U postgres -v ON_ERROR_STOP=1 -qAtX"
sed -n '1,/^\$P -d \$DB -c "ALTER ROLE service_role BYPASSRLS/p' "$R/scripts/staging/local-rehearsal/build-baseline.sh" | sed '$d' > /tmp/prep.sh
echo '$P -d $DB -c "ALTER ROLE service_role BYPASSRLS"' >> /tmp/prep.sh
(cd "$R" && bash /tmp/prep.sh postgres) || exit 1
# local-only pg_cron emulation that records jobs, so the t35 safeguard is exercised (real pg_cron on staging)
$P -d $DB >/dev/null <<'SQL'
DROP FUNCTION cron.schedule(text,text,text); DROP FUNCTION cron.schedule(text,text); DROP FUNCTION cron.unschedule(text); DROP TABLE cron.job;
CREATE TABLE cron.job(jobid bigserial primary key, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES (n,s,c) RETURNING jobid $$;
CREATE FUNCTION cron.schedule(s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(schedule,command) VALUES (s,c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=j RETURNING true $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname=n RETURNING true $$;
SQL
SYS=$($P -d $DB -c "select system_identifier from pg_control_system()")
O=$(mktemp -d); python3 "$H/gen-batches.py" "$SYS" "$O" >/dev/null
for f in "$O"/b*.sql; do if ! $P -d $DB -f "$f" >/tmp/b.log 2>&1; then echo "FAILED $(basename $f): $(grep -m1 ERROR /tmp/b.log)"; exit 2; fi; echo "ok $(basename $f)"; done
echo "cron jobs referencing drivereal.com: $($P -d $DB -c "select count(*) from cron.job where command like '%drivereal.com%'")"; echo "fleet-inbox token rows: $($P -d $DB -c "select count(*) from private.cron_tokens where name='fleet-inbox'")"
