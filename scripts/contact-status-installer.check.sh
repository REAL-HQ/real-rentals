#!/usr/bin/env bash
# Does the installer do what it says — on a throwaway Postgres, never the
# hosted backend.
#
# Replays every migration EXCEPT the Contact Status one, builds the pieces of
# production the installer talks to (the supabase migration ledger), seeds
# synthetic applicants, and then runs the installer four ways:
#
#   1. clean install          -> commits, receipts written, verify all PASS
#   2. second run             -> STOPS, and changes nothing
#   3. drift (an extra column)-> STOPS by default, proceeds when allowed
#   4. a body that fails      -> rolls back whole, leaving no trace
#
# Run: bash scripts/contact-status-installer.check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
MIG=supabase/migrations/20261011180000_contact_status.sql
INS=supabase/install/20261011180000_contact_status.install.sql
VER=supabase/install/20261011180000_contact_status.verify.sql
SHA=400e1071856e7c4e62fc2a13822afd14ee98b31525b1ebf999f6bf486d6c710e
D=/tmp/contact-installer-db; PORT=55533
B="postgresql://postgres@127.0.0.1:$PORT"; U="$B/installcheck?sslmode=disable"
export PATH="$PATH:$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
fail=0
D_SCRATCH=/tmp/ccs-scratch; mkdir -p $D_SCRATCH
chk() { if [ "$2" = "$3" ]; then echo "PASS     $1"; else echo "BLOCKER  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }
q() { psql "$U" -Atc "$1" 2>/dev/null; }

echo "the installer embeds the reviewed migration, unchanged"
python3 - "$INS" "$MIG" "$SHA" <<'PY'
import sys, hashlib, io
ins = io.open(sys.argv[1], encoding="utf8").read()
mig = io.open(sys.argv[2], encoding="utf8").read()
sha = sys.argv[3]
start = ins.index(">>> BEGIN 20261011180000_contact_status.sql")
start = ins.index("\n", start) + 1
end = ins.index("-- <<< END 20261011180000_contact_status.sql")
body = ins[start:end]
print(("PASS     " if body == mig else "BLOCKER  ") + "the embedded body is byte-identical to the reviewed file")
h = hashlib.sha256(body.encode()).hexdigest()
print(("PASS     " if h == sha else "BLOCKER  ") + f"and hashes to the approved sha256 ({h[:16]}…)")
print(("PASS     " if hashlib.sha256(mig.encode()).hexdigest() == sha else "BLOCKER  ") + "as does the reviewed file itself")
PY

grep -q '\\\\i\|^\\\\' "$INS" && { echo "BLOCKER  the installer uses a psql meta-command"; fail=$((fail+1)); } || echo "PASS     pure SQL: it runs through any client, not only psql"
# Comments are stripped first: the file TALKS about policies and drops at
# length, and a grep that reads prose cannot tell the difference between
# "no policy is created" and CREATE POLICY.
sed -E 's/--.*$//' "$INS" > $D_SCRATCH/code.sql 2>/dev/null || { mkdir -p /tmp/ccs-scratch; D_SCRATCH=/tmp/ccs-scratch; sed -E 's/--.*$//' "$INS" > $D_SCRATCH/code.sql; }
# The one DROP the reviewed migration legitimately contains is its own
# constraint, dropped IF EXISTS immediately before being added — that is what
# makes it re-runnable. Anything else is a stop.
if grep -oiE '\bDROP[[:space:]]+[A-Z]+[[:space:]]+(IF[[:space:]]+EXISTS[[:space:]]+)?[a-z_."]+' $D_SCRATCH/code.sql | grep -viq 'applications_contact_status_check'; then
  echo "BLOCKER  the installer drops something other than its own constraint"; fail=$((fail+1))
else
  echo "PASS     the only DROP is its own constraint, dropped IF EXISTS before being added"
fi
if grep -qiE '\b(DELETE[[:space:]]+FROM|TRUNCATE|UPDATE[[:space:]]+public\.)' $D_SCRATCH/code.sql; then
  echo "BLOCKER  the installer writes to existing rows"; fail=$((fail+1))
else
  echo "PASS     no DELETE, TRUNCATE or UPDATE of any existing row"
fi
if grep -qiE '\b(CREATE|DROP|ALTER)[[:space:]]+POLICY|\bGRANT[[:space:]]|\bREVOKE[[:space:]]|\bALTER[[:space:]]+ROLE' $D_SCRATCH/code.sql; then
  echo "BLOCKER  the installer touches policies, grants or roles"; fail=$((fail+1))
else
  echo "PASS     no policy, grant or role change — nothing 0031 governs"
fi
if grep -qiE '\b(CREATE|DROP|ALTER)[[:space:]]+TRIGGER' $D_SCRATCH/code.sql; then
  echo "BLOCKER  the installer adds or removes a trigger"; fail=$((fail+1))
else
  echo "PASS     and no trigger on the lifecycle"
fi

# ------------------------------------------------------------------ the database
grep -q '^pgtest:' /etc/passwd || { echo "pgtest:x:65534:65534::$D:/bin/sh" >> /etc/passwd; echo "pgtest:x:65534:" >> /etc/group; }
R="setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$D PATH=$PATH"
if ! psql "$B/postgres?sslmode=disable" -Atc 'select 1' >/dev/null 2>&1; then
  rm -rf $D; mkdir -p $D; chown 65534:65534 $D
  $R initdb -D $D/data -U postgres -A trust >/dev/null
  $R pg_ctl -D $D/data -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l $D/log start >/dev/null
  sleep 2
fi

build_db() {
  psql "$B/postgres?sslmode=disable" -qc "drop database if exists installcheck with (force)" -c "create database installcheck" >/dev/null 2>&1
  psql "$U" -q -f scripts/esign-harness/stubs.sql >/dev/null 2>&1
  psql "$U" -qc "alter database installcheck set search_path=public,extensions" >/dev/null 2>&1
  for f in supabase/migrations/*.sql drizzle/migrations/*.sql; do
    [ "$f" = "$MIG" ] && continue
    sed -E 's/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;//Ig' "$f" > $D/m.sql
    psql "$U" -q -v ON_ERROR_STOP=1 -1 -f $D/m.sql >/dev/null 2>&1
  done
  # The migration ledger, in the shape production has it.
  psql "$U" -q >/dev/null 2>&1 <<SQL
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text,
  created_by text, idempotency_key text UNIQUE, rollback text[]);
INSERT INTO public.applications (id, full_name, email, phone, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Dana Reyes','dana@example.com','8135550142','reviewing'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','Marcus Hall','marcus@example.com','8135550143','approved')
ON CONFLICT DO NOTHING;
SQL
}

echo
echo "1. a clean install"
build_db
if psql "$U" -q -v ON_ERROR_STOP=1 -f "$INS" > $D/run1.log 2>&1; then
  echo "PASS     it commits"
else
  echo "BLOCKER  it failed:"; sed 's/^/           /' $D/run1.log | head -20; fail=$((fail+1))
fi
chk "the five columns are there" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name like 'contact\_status%' or table_name='applications' and column_name='contact_follow_up_on'")" "5"
chk "every applicant reads New" "$(q "select count(*) from public.applications where contact_status='new'")" "$(q "select count(*) from public.applications")"
chk "the ledger receipt is written" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "1"
chk "  carrying the reviewed checksum" "$(q "select idempotency_key from supabase_migrations.schema_migrations where version='20261011180000'")" "sha256:$SHA"
chk "the audit receipt is written" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "1"
chk "  naming the file it installed" "$(q "select metadata->>'sha256' from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "$SHA"
chk "  and the applicant count it did not change" "$(q "select (metadata->>'rows_before') = (metadata->>'rows_after') from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "t"
VERFAIL=$(psql "$U" -Atc "$(cat $VER)" 2>/dev/null | grep -c '^FAIL')
chk "the verification script reports no FAIL" "$VERFAIL" "0"

echo
echo "2. running it twice"
if psql "$U" -q -v ON_ERROR_STOP=1 -f "$INS" > $D/run2.log 2>&1; then
  echo "BLOCKER  the second run succeeded — it must stop"; fail=$((fail+1))
else
  grep -q "STOP:" $D/run2.log && echo "PASS     the second run stops, and says why" || { echo "BLOCKER  it failed without a STOP message"; fail=$((fail+1)); }
fi
chk "  and nothing was written twice" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "1"
chk "  the ledger still holds one row" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "1"

echo
echo "3. drift: the table is not the shape that was reviewed"
build_db
psql "$U" -qc "alter table public.applications add column surprise_column text" >/dev/null 2>&1
if psql "$U" -q -v ON_ERROR_STOP=1 -f "$INS" > $D/run3.log 2>&1; then
  echo "BLOCKER  it installed over drift"; fail=$((fail+1))
else
  grep -q "STOP ON DRIFT" $D/run3.log && echo "PASS     it stops on drift by default" || { echo "BLOCKER  it stopped for the wrong reason"; sed 's/^/           /' $D/run3.log|head -5; fail=$((fail+1)); }
fi
chk "  and added nothing" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name='contact_status'")" "0"
sed "s/SET LOCAL ccs.allow_drift = '0';/SET LOCAL ccs.allow_drift = '1';/" "$INS" > $D/allow.sql
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/allow.sql > $D/run4.log 2>&1; then
  echo "PASS     and proceeds when the drift is explicitly allowed"
else
  echo "BLOCKER  it would not proceed even when allowed:"; sed 's/^/           /' $D/run4.log|head -10; fail=$((fail+1))
fi
chk "  recording the drift in the receipt" "$(q "select metadata->>'recorded_drift' <> '' from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "t"

echo
echo "4. a failing body rolls the whole thing back"
build_db
sed "s/ADD CONSTRAINT applications_contact_status_check/ADD CONSTRAINT applications_contact_status_check NOT A VALID THING/" "$INS" > $D/broken.sql
psql "$U" -q -v ON_ERROR_STOP=1 -f $D/broken.sql > $D/run5.log 2>&1
chk "no column survived the failure" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name='contact_status'")" "0"
chk "no ledger row survived it" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "0"
chk "no audit row survived it" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "0"

echo
echo "5. and it is independent of 0031"
build_db
# 0031's shape, as described: a Coordinator loses the direct read. Whatever
# it does to the policy set, the installer must still work.
psql "$U" -q >/dev/null 2>&1 <<SQL
DROP POLICY IF EXISTS "Staff view applications" ON public.applications;
CREATE POLICY "Staff view applications" ON public.applications FOR SELECT TO authenticated USING (private.is_manager());
SQL
sed "s/SET LOCAL ccs.allow_drift = '0';/SET LOCAL ccs.allow_drift = '1';/" "$INS" > $D/after31.sql
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/after31.sql > $D/run6.log 2>&1; then
  echo "PASS     it installs cleanly after a 0031-shaped policy change"
else
  echo "BLOCKER  it could not install after 0031:"; sed 's/^/           /' $D/run6.log|head -10; fail=$((fail+1))
fi
chk "  and left that policy exactly as 0031 set it" "$(q "select qual from pg_policies where tablename='applications' and policyname='Staff view applications'")" "private.is_manager()"

pg_ctl -D $D/data stop >/dev/null 2>&1 || $R pg_ctl -D $D/data stop >/dev/null 2>&1
echo
if [ "$fail" = "0" ]; then echo "all installer checks pass"; else echo "$fail blocker(s)"; fi
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
