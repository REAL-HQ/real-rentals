#!/usr/bin/env bash
# Is 20261011180000_contact_status.sql safe to apply to the real applications
# table?
#
# Replays EVERY migration into a throwaway Postgres — the hosted backend is
# never touched and nothing here can reach it — stops just before the new one,
# writes synthetic applicant rows that stand in for production data, and then
# applies it and checks what moved. Run: bash scripts/contact-status-migration.check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NEW=supabase/migrations/20261011180000_contact_status.sql
D=/tmp/contact-migration-db; PORT=55532
B="postgresql://postgres@127.0.0.1:$PORT"; U="$B/contactcheck?sslmode=disable"
export PATH="$PATH:$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
grep -q '^pgtest:' /etc/passwd || { echo "pgtest:x:65534:65534::$D:/bin/sh" >> /etc/passwd; echo "pgtest:x:65534:" >> /etc/group; }
R="setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$D PATH=$PATH"

if ! psql "$B/postgres?sslmode=disable" -Atc 'select 1' >/dev/null 2>&1; then
  rm -rf $D; mkdir -p $D; chown 65534:65534 $D
  $R initdb -D $D/data -U postgres -A trust >/dev/null
  $R pg_ctl -D $D/data -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l $D/log start >/dev/null
  sleep 2
fi
psql "$B/postgres?sslmode=disable" -qc "drop database if exists contactcheck with (force)" -c "create database contactcheck" || exit 1
psql "$U" -q -f scripts/esign-harness/stubs.sql >/dev/null 2>&1
psql "$U" -qc "alter database contactcheck set search_path=public,extensions"

: > $D/replay.log
COUNT=0
for f in supabase/migrations/*.sql drizzle/migrations/*.sql; do
  [ "$f" = "$NEW" ] && continue          # the one under test goes on at the end
  sed -E 's/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;//Ig' "$f" > $D/m.sql
  if psql "$U" -q -v ON_ERROR_STOP=1 -1 -f $D/m.sql >/dev/null 2>&1; then COUNT=$((COUNT+1)); else echo "skipped $f" >> $D/replay.log; fi
done
echo "replayed $COUNT migration(s) before the one under test, $(wc -l < $D/replay.log) skipped"
psql "$U" -Atc "select to_regclass('public.applications') is not null" | grep -q t || { echo "BLOCKER  applications does not exist after the replay"; exit 1; }

# Synthetic production data: rows that exist BEFORE the migration runs.
psql "$U" -q >/dev/null <<SQL
insert into public.applications (id, full_name, email, phone, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Dana Reyes','dana@example.com','8135550142','reviewing'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Marcus Hall','marcus@example.com','8135550143','approved'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','Priya Shah','priya@example.com','8135550144','new');
SQL
BEFORE_ROWS=$(psql "$U" -Atc "select count(*) from public.applications")
BEFORE_STATUS=$(psql "$U" -Atc "select string_agg(status, ',' order by full_name) from public.applications")
BEFORE_POLICIES=$(psql "$U" -Atc "select string_agg(policyname||':'||cmd, '|' order by policyname) from pg_policies where tablename='applications'")
BEFORE_TRIGGERS=$(psql "$U" -Atc "select coalesce(string_agg(tgname, ',' order by tgname),'') from pg_trigger where tgrelid='public.applications'::regclass and not tgisinternal")
BEFORE_COLS=$(psql "$U" -Atc "select count(*) from information_schema.columns where table_schema='public' and table_name='applications'")
echo "before: $BEFORE_ROWS rows, $BEFORE_COLS columns"

# ---------------------------------------------------------------- apply it
if psql "$U" -q -v ON_ERROR_STOP=1 -1 -f "$NEW" > $D/apply.log 2>&1; then
  echo "PASS     the migration applies in one transaction"
else
  echo "BLOCKER  the migration failed to apply:"; cat $D/apply.log; exit 1
fi

fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS     $1"; else echo "BLOCKER  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }
q() { psql "$U" -Atc "$1"; }

echo
echo "the five columns, with the intended types and defaults"
chk "contact_status is text, not null, default 'new'" \
  "$(q "select data_type||'/'||is_nullable||'/'||coalesce(column_default,'-') from information_schema.columns where table_name='applications' and column_name='contact_status'")" \
  "text/NO/'new'::text"
chk "contact_status_note is nullable text" \
  "$(q "select data_type||'/'||is_nullable from information_schema.columns where table_name='applications' and column_name='contact_status_note'")" "text/YES"
chk "contact_follow_up_on is a DATE" \
  "$(q "select data_type from information_schema.columns where table_name='applications' and column_name='contact_follow_up_on'")" "date"
chk "contact_status_at is timestamptz" \
  "$(q "select data_type from information_schema.columns where table_name='applications' and column_name='contact_status_at'")" "timestamp with time zone"
chk "contact_status_by is uuid with no foreign key" \
  "$(q "select data_type from information_schema.columns where table_name='applications' and column_name='contact_status_by'")" "uuid"
chk "  and nothing references auth.users, so removing a staff account cannot delete the record" \
  "$(q "select count(*) from information_schema.key_column_usage k join information_schema.table_constraints c using (constraint_name) where k.table_name='applications' and k.column_name='contact_status_by' and c.constraint_type='FOREIGN KEY'")" "0"
chk "exactly five columns were added" "$(q "select count(*)-$BEFORE_COLS from information_schema.columns where table_schema='public' and table_name='applications'")" "5"

echo
echo "existing data is preserved"
chk "every row is still there" "$(q "select count(*) from public.applications")" "$BEFORE_ROWS"
chk "no application status changed" "$(q "select string_agg(status, ',' order by full_name) from public.applications")" "$BEFORE_STATUS"
chk "every pre-existing applicant reads as New, with no back-fill" \
  "$(q "select count(*) from public.applications where contact_status='new'")" "$BEFORE_ROWS"
chk "  and carries no invented note, date, time or author" \
  "$(q "select count(*) from public.applications where contact_status_note is null and contact_follow_up_on is null and contact_status_at is null and contact_status_by is null")" "$BEFORE_ROWS"

echo
echo "the CHECK constraint"
for s in new attempted voicemail contacted interested follow_up documents unqualified unresponsive; do
  r=$(psql "$U" -Atc "update public.applications set contact_status='$s' where full_name='Dana Reyes'" 2>&1)
  chk "$s is accepted" "$r" "UPDATE 1"
done
r=$(psql "$U" -Atc "update public.applications set contact_status='nope' where full_name='Dana Reyes'" 2>&1 | grep -c "violates check constraint")
chk "a status nobody defined is refused by the database" "$r" "1"
r=$(psql "$U" -Atc "update public.applications set contact_status='approved' where full_name='Dana Reyes'" 2>&1 | grep -c "violates check constraint")
chk "  and so is an APPLICATION status" "$r" "1"

echo
echo "nothing else about the table moved"
chk "the policies on applications are unchanged" "$(q "select string_agg(policyname||':'||cmd, '|' order by policyname) from pg_policies where tablename='applications'")" "$BEFORE_POLICIES"
chk "no trigger was added or removed" "$(q "select coalesce(string_agg(tgname, ',' order by tgname),'') from pg_trigger where tgrelid='public.applications'::regclass and not tgisinternal")" "$BEFORE_TRIGGERS"
chk "row level security is still on" "$(q "select relrowsecurity from pg_class where oid='public.applications'::regclass")" "t"
chk "staff still read and update applications" \
  "$(q "select count(*) from pg_policies where tablename='applications' and policyname in ('Staff view applications','Staff update applications') and qual like '%is_staff%'")" "2"
chk "a driver still has SELECT on their own row and nothing more" \
  "$(q "select cmd from pg_policies where tablename='applications' and policyname='Users can view their own application'")" "SELECT"
chk "  with no UPDATE policy for an applicant anywhere" \
  "$(q "select count(*) from pg_policies where tablename='applications' and cmd='UPDATE' and qual not like '%is_staff%'")" "0"
chk "the two indexes exist" \
  "$(q "select count(*) from pg_indexes where tablename='applications' and indexname in ('applications_contact_status_idx','applications_contact_follow_up_idx')")" "2"

echo
echo "Application Resume still works across the new columns"
r=$(psql "$U" -Atc "insert into public.applications (full_name,email,phone) values ('Jo Fresh','jo@example.com','8135550199')" 2>&1)
chk "a new applicant can still be created without naming a contact column" "$r" "INSERT 0 1"
chk "  and defaults to New" "$(q "select contact_status from public.applications where full_name='Jo Fresh'")" "new"
r=$(psql "$U" -Atc "update public.applications set current_step='part2', city='Tampa', state='FL' where full_name='Jo Fresh'" 2>&1)
chk "a resumed application can still be updated step by step" "$r" "UPDATE 1"
chk "  without disturbing its contact status" "$(q "select contact_status from public.applications where full_name='Jo Fresh'")" "new"

echo
echo "roll-forward: applying it twice is a no-op"
if psql "$U" -q -v ON_ERROR_STOP=1 -1 -f "$NEW" > $D/again.log 2>&1; then
  echo "PASS     a second run succeeds, so a failed install can simply be re-run"
else
  echo "BLOCKER  the second run failed:"; cat $D/again.log; fail=$((fail+1))
fi
chk "  and changes nothing: still five added columns" "$(q "select count(*)-$BEFORE_COLS from information_schema.columns where table_schema='public' and table_name='applications'")" "5"
chk "  one CHECK constraint, not two" "$(q "select count(*) from pg_constraint where conrelid='public.applications'::regclass and conname='applications_contact_status_check'")" "1"
chk "  and the data staff entered in between survives" "$(q "select contact_status from public.applications where full_name='Dana Reyes'")" "unresponsive"

echo
echo "and the rollback, if it is ever wanted"
r=$(psql "$U" -Atc "alter table public.applications drop constraint applications_contact_status_check, drop column contact_status, drop column contact_status_note, drop column contact_follow_up_on, drop column contact_status_at, drop column contact_status_by" 2>&1)
chk "the five columns and the constraint drop cleanly" "$r" "ALTER TABLE"
chk "  leaving the table exactly as it was" "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='applications'")" "$BEFORE_COLS"
chk "  with every applicant and status intact" "$(q "select string_agg(status, ',' order by full_name) from public.applications where full_name <> 'Jo Fresh'")" "$BEFORE_STATUS"

pg_ctl -D $D/data stop >/dev/null 2>&1 || $R pg_ctl -D $D/data stop >/dev/null 2>&1
echo
if [ "$fail" = "0" ]; then echo "all migration compatibility checks pass"; else echo "$fail blocker(s)"; fi
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
