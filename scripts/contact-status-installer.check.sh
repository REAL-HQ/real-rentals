#!/usr/bin/env bash
# Does the installer do what it says — on a throwaway Postgres, never the
# hosted backend.
#
# Replays every migration EXCEPT the Contact Status one, builds the pieces of
# production the installer talks to (the supabase migration ledger), seeds
# synthetic applicants, and then runs the installer six ways:
#
#   1. clean install (STATE A)  -> commits, receipts written, verify all PASS
#   2. second run               -> STOPS, and changes nothing
#   3. unexpected drift         -> STOPS. There is no override to reach for.
#   4. a 0031-shaped change     -> STOPS while STATE B is undefined
#   5. STATE B defined          -> installs, on a COPY carrying a stand-in
#                                  fingerprint, to prove the slot works
#   6. a body that fails        -> rolls back whole, leaving no trace
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
SCRATCH=/tmp/ccs-scratch; mkdir -p $SCRATCH
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
print(("PASS     " if h == sha else "BLOCKER  ") + f"and hashes to the approved sha256 ({h[:16]}...)")
print(("PASS     " if hashlib.sha256(mig.encode()).hexdigest() == sha else "BLOCKER  ") + "as does the reviewed file itself")
PY

grep -q '^\\' "$INS" && { echo "BLOCKER  the installer uses a psql meta-command"; fail=$((fail+1)); } || echo "PASS     pure SQL: it runs through any client, not only psql"
# Comments are stripped first: the file TALKS about policies and drops at
# length, and a grep that reads prose cannot tell the difference between
# "no policy is created" and CREATE POLICY.
sed -E 's/--.*$//' "$INS" > $SCRATCH/code.sql
if grep -oiE '\bDROP[[:space:]]+[A-Z]+[[:space:]]+(IF[[:space:]]+EXISTS[[:space:]]+)?[a-z_."]+' $SCRATCH/code.sql | grep -viq 'applications_contact_status_check'; then
  echo "BLOCKER  the installer drops something other than its own constraint"; fail=$((fail+1))
else
  echo "PASS     the only DROP is its own constraint, dropped IF EXISTS before being added"
fi
if grep -qiE '\b(DELETE[[:space:]]+FROM|TRUNCATE|UPDATE[[:space:]]+public\.)' $SCRATCH/code.sql; then
  echo "BLOCKER  the installer writes to existing rows"; fail=$((fail+1))
else
  echo "PASS     no DELETE, TRUNCATE or UPDATE of any existing row"
fi
if grep -qiE '\b(CREATE|DROP|ALTER)[[:space:]]+POLICY|\bGRANT[[:space:]]|\bREVOKE[[:space:]]|\bALTER[[:space:]]+ROLE' $SCRATCH/code.sql; then
  echo "BLOCKER  the installer touches policies, grants or roles"; fail=$((fail+1))
else
  echo "PASS     no policy, grant or role change — nothing 0031 governs"
fi
if grep -qiE '\b(CREATE|DROP|ALTER)[[:space:]]+TRIGGER' $SCRATCH/code.sql; then
  echo "BLOCKER  the installer adds or removes a trigger"; fail=$((fail+1))
else
  echo "PASS     and no trigger on the lifecycle"
fi
if grep -q 'allow_drift' "$INS"; then
  echo "BLOCKER  the general drift override is still there"; fail=$((fail+1))
else
  echo "PASS     no general drift override: a reviewed state, or it stops"
fi
if grep -q 'c_state_b  CONSTANT text := NULL;' "$INS"; then
  echo "PASS     STATE B is undefined, as it must be until 0031 is reviewed"
else
  echo "BLOCKER  STATE B carries a value nobody reviewed"; fail=$((fail+1))
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

# The local replay cannot reproduce production's exact column count or policy
# set, so STATE A is rewritten to whatever this throwaway database actually
# is. The SHAPE of the check — one reviewed fingerprint, or it stops — is what
# is under test, and every other run below uses the installer unmodified.
local_state_a() {
  local print
  print=$(q "$(cat scripts/contact-status-fingerprint.sql)")
  python3 - "$INS" "$1" "$print" <<'PY'
import sys, io, re
ins = io.open(sys.argv[1], encoding="utf8").read()
out, n = re.subn(r"(c_state_a  CONSTANT text :=\n    ')[^']*(')", lambda m: m.group(1) + sys.argv[3] + m.group(2), ins, count=1)
assert n == 1, "could not find the STATE A slot to rewrite"
# out == ins is the GOOD case: it means this throwaway database reproduces
# production's fingerprint exactly, so the installer runs here unmodified.
# Treating that as a failure is what made every step below look broken.
io.open(sys.argv[2], "w", encoding="utf8").write(out)
print("local STATE A " + ("matches production verbatim" if out == ins else "rewritten for this database"), file=sys.stderr)
PY
}

echo
echo "1. a clean install, in STATE A"
build_db
local_state_a $D/localA.sql
if diff -q "$INS" $D/localA.sql >/dev/null; then
  echo "PASS     the throwaway database reproduces production's STATE A fingerprint, so the installer runs here UNMODIFIED"
else
  echo "NOTE     the throwaway database differs from production; STATE A was rewritten to match it, and the SHAPE of the check is what is under test"
fi
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/localA.sql > $D/run1.log 2>&1; then
  echo "PASS     it commits"
else
  echo "BLOCKER  it failed:"; sed 's/^/           /' $D/run1.log | head -20; fail=$((fail+1))
fi
chk "the five columns are there" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name in ('contact_status','contact_status_note','contact_follow_up_on','contact_status_at','contact_status_by')")" "5"
chk "every applicant reads New" "$(q "select count(*) from public.applications where contact_status='new'")" "$(q "select count(*) from public.applications")"
chk "the ledger receipt is written" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "1"
chk "  carrying the reviewed checksum" "$(q "select idempotency_key from supabase_migrations.schema_migrations where version='20261011180000'")" "sha256:$SHA"
chk "the audit receipt is written" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "1"
chk "  naming the file it installed" "$(q "select metadata->>'sha256' from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "$SHA"
chk "  and the state it recognised" "$(q "select metadata->>'preflight_state' from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "A"
chk "  with the applicant count unchanged across the install" "$(q "select (metadata->>'rows_before') = (metadata->>'rows_after') from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "t"
chk "no applicant row was altered" "$(q "select string_agg(full_name || ':' || status, ', ' order by full_name) from public.applications")" "Dana Reyes:reviewing, Marcus Hall:approved"
# Counting FAIL lines alone is not a check: a verify script that ERRORS
# prints no lines at all and reads as "no FAIL". Production found exactly
# that — `check` is a reserved word and the outer SELECT would not parse —
# so the run must produce PASS lines before their absence means anything.
VEROUT=$(psql "$U" -Atc "$(cat $VER)" 2>&1)
VERPASS=$(printf '%s\n' "$VEROUT" | grep -c '^PASS')
VERFAIL=$(printf '%s\n' "$VEROUT" | grep -c '^FAIL')
if [ "$VERPASS" -lt 15 ]; then
  echo "BLOCKER  the verification script produced only $VERPASS PASS lines — it did not run:"
  printf '%s\n' "$VEROUT" | head -3 | sed 's/^/           /'
  fail=$((fail+1))
else
  echo "PASS     the verification script ran, with $VERPASS checks"
fi
chk "  and reports no FAIL" "$VERFAIL" "0"

echo
echo "2. running it twice"
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/localA.sql > $D/run2.log 2>&1; then
  echo "BLOCKER  the second run succeeded — it must stop"; fail=$((fail+1))
else
  grep -q "STOP:" $D/run2.log && echo "PASS     the second run stops, and says why" || { echo "BLOCKER  it failed without a STOP message"; fail=$((fail+1)); }
fi
chk "  and nothing was written twice" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "1"
chk "  the ledger still holds one row" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "1"

echo
echo "3. unexpected drift — and there is no override to reach for"
build_db
local_state_a $D/localA.sql
psql "$U" -qc "alter table public.applications add column surprise_column text" >/dev/null 2>&1
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/localA.sql > $D/run3.log 2>&1; then
  echo "BLOCKER  it installed over drift"; fail=$((fail+1))
else
  grep -q "not in a recognised state" $D/run3.log && echo "PASS     it stops, naming what it found and what it accepts" || { echo "BLOCKER  it stopped for the wrong reason"; sed 's/^/           /' $D/run3.log|head -5; fail=$((fail+1)); }
fi
chk "  and added nothing" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name='contact_status'")" "0"
chk "  and wrote no receipt" "$(q "select count(*) from public.audit_log where action='migration.applied'")" "0"

echo
echo "4. a 0031-shaped policy change, while STATE B is undefined"
build_db
local_state_a $D/localA.sql
psql "$U" -q >/dev/null 2>&1 <<SQL
DROP POLICY IF EXISTS "Staff view applications" ON public.applications;
CREATE POLICY "Staff view applications" ON public.applications FOR SELECT TO authenticated USING (private.is_manager());
SQL
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/localA.sql > $D/run4.log 2>&1; then
  echo "BLOCKER  it installed into an unreviewed post-0031 state"; fail=$((fail+1))
else
  grep -q "not in a recognised state" $D/run4.log && echo "PASS     it stops: post-0031 is not an approved state until STATE B is defined" || { echo "BLOCKER  wrong refusal"; sed 's/^/           /' $D/run4.log|head -5; fail=$((fail+1)); }
fi
grep -q "0031 package was not available" $D/run4.log && echo "PASS     and says why STATE B is missing, rather than implying the database is broken" || { echo "BLOCKER  the message does not explain STATE B"; fail=$((fail+1)); }
chk "  nothing installed" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name='contact_status'")" "0"
chk "  and 0031's policy is untouched" "$(q "select qual from pg_policies where tablename='applications' and policyname='Staff view applications'")" "private.is_manager()"

echo
echo "5. the STATE B slot works once a reviewed inventory is supplied"
echo "   (a COPY carrying the fingerprint of the state built in step 4 — a"
echo "    stand-in for Codex's reviewed inventory, NOT a claim about 0031)"
PRINT=$(q "$(cat scripts/contact-status-fingerprint.sql)")
python3 - $D/localA.sql $D/stateb.sql "$PRINT" <<'PY'
import sys, io
ins = io.open(sys.argv[1], encoding="utf8").read()
out = ins.replace("  c_state_b  CONSTANT text := NULL;",
                  "  c_state_b  CONSTANT text := '" + sys.argv[3] + "';")
assert out != ins, "could not fill the STATE B slot"
io.open(sys.argv[2], "w", encoding="utf8").write(out)
PY
if psql "$U" -q -v ON_ERROR_STOP=1 -f $D/stateb.sql > $D/run5.log 2>&1; then
  echo "PASS     with STATE B defined, it installs"
else
  echo "BLOCKER  it would not install even with STATE B defined:"; sed 's/^/           /' $D/run5.log|head -10; fail=$((fail+1))
fi
chk "  recording STATE B in the receipt" "$(q "select metadata->>'preflight_state' from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "B"
chk "  leaving the policy exactly as it found it" "$(q "select qual from pg_policies where tablename='applications' and policyname='Staff view applications'")" "private.is_manager()"
chk "  and every applicant still reading New" "$(q "select count(*) from public.applications where contact_status <> 'new'")" "0"

echo
echo "6. a failing body rolls the whole thing back"
build_db
local_state_a $D/localA.sql
sed "s/ADD CONSTRAINT applications_contact_status_check/ADD CONSTRAINT applications_contact_status_check NOT A VALID THING/" $D/localA.sql > $D/broken.sql
psql "$U" -q -v ON_ERROR_STOP=1 -f $D/broken.sql > $D/run6.log 2>&1
chk "no column survived the failure" "$(q "select count(*) from information_schema.columns where table_name='applications' and column_name='contact_status'")" "0"
chk "no ledger row survived it" "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261011180000'")" "0"
chk "no audit row survived it" "$(q "select count(*) from public.audit_log where action='migration.applied' and entity_id='20261011180000'")" "0"
chk "and both applicants are still exactly as they were" "$(q "select string_agg(full_name || ':' || status, ', ' order by full_name) from public.applications")" "Dana Reyes:reviewing, Marcus Hall:approved"

pg_ctl -D $D/data stop >/dev/null 2>&1 || $R pg_ctl -D $D/data stop >/dev/null 2>&1
echo
if [ "$fail" = "0" ]; then echo "all installer checks pass"; else echo "$fail blocker(s)"; fi
exit $([ "$fail" = "0" ] && echo 0 || echo 1)
