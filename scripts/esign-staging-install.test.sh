#!/usr/bin/env bash
# ===========================================================================
# THE RULES THIS FILE EXISTS FOR:
#
#   THE STAGING SEQUENCE INSTALLS CLEANLY, ROLLS BACK WHOLE, REFUSES TO
#   REPLAY, AND LEAVES THE NINE EXISTING RECEIPTS ALONE. RLS LETS A
#   MANAGER READ AN AGREEMENT AND A DRIVER READ ONLY THEIR OWN. SIGNED
#   PDFs ARE NOT READABLE FROM STORAGE. NUMBERS ARE UNIQUE AND IMMUTABLE.
#
# Everything runs against a DISPOSABLE PostgreSQL cluster created in a temp
# directory and destroyed at the end. No hosted database is touched, no
# network is used, and no production object is referenced.
#
# Run: bash scripts/esign-staging-install.test.sh   (npm run test:esign-staging)
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$HERE/scripts/esign-staging"
REL="$HERE/scripts/esign-release"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$PGBIN/initdb" ] || { echo "no local PostgreSQL found under /usr/lib/postgresql"; exit 1; }

# PostgreSQL refuses to run as root, so the disposable cluster runs as the
# unprivileged postgres user. AS_PG wraps every server-side command; psql
# itself is a client and runs as whoever invoked the script.
D="$(mktemp -d)"; PORT=55439
chmod 777 "$D"
AS_PG=""
if [ "$(id -u)" = 0 ] && id postgres >/dev/null 2>&1; then
  AS_PG="runuser -u postgres --"
  command -v runuser >/dev/null 2>&1 || AS_PG="su postgres -c"
fi
pg() { if [ -n "$AS_PG" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
fail=0
ok() { if [ "$1" = 0 ]; then echo "  PASS  $2"; else fail=$((fail+1)); echo "  BLOCKER  $2"; fi; }
cleanup() { pg "$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1; rm -rf "$D"; }
trap cleanup EXIT

pg "$PGBIN/initdb" -D "$D/data" -U postgres -A trust >/dev/null 2>&1
pg "$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null 2>&1 \
  || { echo "could not start the disposable cluster"; cat "$D/log"; exit 1; }
PSQL="$PGBIN/psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
Q() { $PGBIN/psql -h "$D" -p "$PORT" -U postgres -Atc "$1" esign 2>&1; }

$PSQL -d postgres -c "create database esign" >/dev/null

# --------------------------------------------------- the stand-in backend
# Just enough of the hosted shape for the package to install against: the
# roles, the schemas, the prerequisite tables the baseline references, the
# private helpers, and the staging ledger carrying its nine existing
# receipts. These are PREREQUISITES, not part of the package under test.
$PSQL -d esign >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA private; CREATE SCHEMA storage; CREATE SCHEMA auth;
-- Supabase installs pgcrypto into the extensions schema, and 0023 calls
-- extensions.digest() to hash template bodies. Same shape here.
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TYPE app_role AS ENUM ('admin','user','partner','driver','team','coordinator');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role app_role NOT NULL);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, full_name text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.rentals (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket text, storage_path text, visibility text[], partner_id uuid);

-- auth.uid() is set per-test with a session GUC.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('admin','team','coordinator')) $$;
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text IN ('admin','team')) $$;
CREATE FUNCTION private.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION private.is_partner_owner(_p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO authenticated;

-- The staging ledger, with the nine receipts through Stage 09 that must
-- survive untouched.
-- Hosted Supabase grants `authenticated` SELECT on these; the driver policy
-- subqueries applications and the partner storage policy subqueries
-- documents, and a policy is evaluated with the CALLER's privileges on the
-- tables it reads. Without these the policies fail closed for the wrong
-- reason and the RLS results below would be meaningless.
GRANT SELECT ON public.applications, public.documents, public.user_roles TO authenticated;

CREATE TABLE private.staging_install_receipts (
  stage text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO private.staging_install_receipts (stage, sha256)
SELECT 'stage0'||g, repeat('0',64) FROM generate_series(1,9) g;
SQL

PRE_RECEIPTS="$(Q "select count(*) from private.staging_install_receipts")"
PRE_DIGEST="$(Q "select md5(string_agg(stage||sha256, '|' order by stage)) from private.staging_install_receipts")"

echo
echo "================= the sequence installs cleanly"
# install.sh drives psql over TCP; here the cluster is socket-only, so the
# stages are replayed the same way install.sh composes them. The payloads,
# preflight and postflight are the real package files.
stage() {
  local name="$1" expect="$2" sha="$3"; shift 3
  { echo "\\set ON_ERROR_STOP on"
    echo "\\set stage_name '$name'"; echo "\\set payload_sha '$sha'"
    echo "\\set expect_receipt $expect"; echo "BEGIN;"
    echo "\\i $PKG/preflight.sql"
    for f in "$@"; do echo "\\i $f"; done
    echo "INSERT INTO private.staging_install_receipts (stage, sha256, applied_at) VALUES (:'stage_name', :'payload_sha', now());"
    echo "\\set expect_receipt_after $((expect+1))"
    echo "\\i $PKG/postflight.sql"
    echo "COMMIT;"
  } | $PGBIN/psql -h "$D" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q esign 2>&1
}

OUT="$(stage stage10_agreements_baseline 9 "basesha:storsha" "$PKG/01_agreements_baseline.sql" "$PKG/02_private_storage.sql")"
ok $? "stage10 (baseline + private storage) commits${OUT:+ — $OUT}"
OUT="$(stage stage11_esign_0023 10 "675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7" "$REL/0023_esign_template_versioning_library.sql")"
ok $? "stage11 (0023) commits${OUT:+ — $OUT}"
OUT="$(stage stage12_esign_0024 11 "199f57eda905ef73f9d531f813abc8b2f16759a8b0e89b6920f2985ba55d9aa8" "$REL/0024_esign_agreement_numbering.sql")"
ok $? "stage12 (0024) commits${OUT:+ — $OUT}"

echo
echo "================= the existing nine receipts are untouched"
NOW_DIGEST="$(Q "select md5(string_agg(stage||sha256,'|' order by stage)) from private.staging_install_receipts where stage like 'stage0%'")"
[ "$NOW_DIGEST" = "$PRE_DIGEST" ]; ok $? "the nine Stage 01-09 receipts are byte-identical"
[ "$(Q "select count(*) from private.staging_install_receipts")" = "12" ]; ok $? "the ledger holds 12 receipts (9 + 3)"
[ "$(Q "select sha256 from private.staging_install_receipts where stage='stage11_esign_0023'")" = "675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7" ]
ok $? "the reviewed 0023 checksum is what was recorded"

echo
echo "================= replay is refused"
OUT="$(stage stage11_esign_0023 12 "675bff0e8cba301581209c6c2a4f4cd7d485676c47a9e3920de87622c129acc7" "$REL/0023_esign_template_versioning_library.sql" 2>&1)"
[ $? -ne 0 ] && echo "$OUT" | grep -qi "already recorded"; ok $? "a second run of stage11 is refused by name"
[ "$(Q "select count(*) from private.staging_install_receipts")" = "12" ]; ok $? "  and the ledger is unchanged by the refusal"

echo
echo "================= a failing stage rolls back whole"
# A payload that does real work and then fails. Nothing it did may survive,
# and no receipt may be written for it.
cat > "$D/bad.sql" <<'SQL'
CREATE TABLE public.rollback_canary (id int);
INSERT INTO public.agreement_templates (name, body) VALUES ('canary','x');
SELECT 1/0;
SQL
OUT="$(stage stage13_rollback_probe 12 "deadbeef" "$D/bad.sql" 2>&1)"
[ $? -ne 0 ]; ok $? "a stage whose payload fails does not commit"
[ "$(Q "select to_regclass('public.rollback_canary') is null")" = "t" ]; ok $? "  the table it created is gone"
[ "$(Q "select count(*) from public.agreement_templates where name='canary'")" = "0" ]; ok $? "  the row it inserted is gone"
[ "$(Q "select count(*) from private.staging_install_receipts where stage='stage13_rollback_probe'")" = "0" ]; ok $? "  and no receipt was left behind"
[ "$(Q "select count(*) from private.staging_install_receipts")" = "12" ]; ok $? "  the ledger still holds exactly 12"

echo
echo "================= RLS: who may read an agreement"
$PSQL -d esign >/dev/null <<'SQL'
INSERT INTO public.user_roles VALUES
  ('11111111-1111-4111-8111-111111111111','admin'),
  ('22222222-2222-4222-8222-222222222222','team'),
  ('33333333-3333-4333-8333-333333333333','coordinator'),
  ('44444444-4444-4444-8444-444444444444','driver');
INSERT INTO public.applications (id, user_id, full_name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444','Dana Reyes');
INSERT INTO public.agreements (application_id, body, status, title)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','BODY','sent','Vehicle Rental Agreement');
INSERT INTO public.applications (id, user_id, full_name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000002','55555555-5555-4555-8555-555555555555','Someone Else');
INSERT INTO public.agreements (application_id, body, status, title)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000002','OTHER','sent','Vehicle Rental Agreement');
SQL
# psql prints a command tag for every statement in a -c batch, so the two
# SETs come back ahead of the answer. Take the last line.
asrole() { $PGBIN/psql -h "$D" -p "$PORT" -U postgres -Atc \
  "begin; set local role authenticated; set local test.uid='$1'; $2; commit;" esign 2>&1 \
  | grep -v '^\(SET\|BEGIN\|COMMIT\)$' | tail -1; }

[ "$(asrole 11111111-1111-4111-8111-111111111111 'select count(*) from public.agreements')" = "2" ]
ok $? "an Owner reads every agreement"
[ "$(asrole 22222222-2222-4222-8222-222222222222 'select count(*) from public.agreements')" = "2" ]
ok $? "a Manager reads every agreement"
# 0023's restrictive boundary is installed, so staff means Manager from here.
[ "$(asrole 33333333-3333-4333-8333-333333333333 'select count(*) from public.agreements')" = "0" ]
ok $? "a Coordinator reads NO agreement body (0023's restrictive boundary)"
[ "$(asrole 44444444-4444-4444-8444-444444444444 'select count(*) from public.agreements')" = "1" ]
ok $? "a driver reads exactly their own"
[ "$(asrole 44444444-4444-4444-8444-444444444444 "select body from public.agreements")" = "BODY" ]
ok $? "  and it is theirs, not somebody else's"
# RLS blocks the write by matching no row, so the honest evidence is that
# nothing came back and the command reports zero rows — not an error.
R="$(asrole 44444444-4444-4444-8444-444444444444 "update public.agreements set status='voided' returning id")"
{ [ "$R" = "UPDATE 0" ] || [ -z "$R" ] || echo "$R" | grep -qi 'denied\|violates'; }
ok $? "a driver cannot write an agreement (got: ${R:-<nothing>})"
[ "$(Q "select count(*) from public.agreements where status='voided'")" = "0" ]
ok $? "  and no agreement was voided"

echo
echo "================= signer authorization: the atomic claim"
AG="$(Q "select id from public.agreements where body='BODY'")"
[ "$(Q "select public.esign_claim('$AG'::uuid, null)")" = "won" ]; ok $? "the first claim wins"
[ "$(Q "select public.esign_claim('$AG'::uuid, null)")" = "in_progress" ]; ok $? "a second, concurrent claim is told in_progress"
$PSQL -d esign -c "update public.agreements set status='signed' where id='$AG'" >/dev/null
[ "$(Q "select public.esign_claim('$AG'::uuid, null)")" = "already_signed" ]; ok $? "a signed agreement cannot be claimed again"
[ "$(Q "select public.esign_void('$AG'::uuid)")" = "signed" ]; ok $? "and void refuses a signed agreement, reporting its state"
[ "$(Q "select count(*) from public.agreements where id='$AG' and status='signed' and body='BODY'")" = "1" ]
ok $? "  the signed agreement still has the body it was signed with"

echo
echo "================= private storage"
[ "$(Q "select public from storage.buckets where id='rental-agreements'")" = "f" ]; ok $? "the bucket is private"
[ "$(Q "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname<>'Partners read their driver documents' and (coalesce(qual,'')||coalesce(with_check,'')) like '%rental-agreements%'")" = "0" ]
ok $? "no policy beyond the partner read reaches rental-agreements"
$PSQL -d esign -c "insert into storage.objects (bucket_id, name) values ('rental-agreements','$AG/signed.pdf')" >/dev/null
[ "$(asrole 22222222-2222-4222-8222-222222222222 "select count(*) from storage.objects where bucket_id='rental-agreements'")" = "0" ]
ok $? "a Manager cannot read a signed PDF straight from storage (service role only)"
[ "$(asrole 44444444-4444-4444-8444-444444444444 "select count(*) from storage.objects where bucket_id='rental-agreements'")" = "0" ]
ok $? "neither can the driver it belongs to"

echo
echo "================= agreement numbering"
[ "$(Q "select public.next_agreement_number()")" = "RRA-000001" ]; ok $? "the first number is RRA-000001"
[ "$(Q "select public.next_agreement_number()")" = "RRA-000002" ]; ok $? "and they advance"
$PSQL -d esign -c "update public.agreements set agreement_number='RRA-000009' where id='$AG'" >/dev/null 2>&1
R="$(Q "update public.agreements set agreement_number='RRA-000010' where id='$AG' returning agreement_number")"
echo "$R" | grep -qi 'immutable'; ok $? "a number, once set, cannot be changed"
R="$(Q "insert into public.agreements (application_id, body, agreement_number) values ('aaaaaaaa-0000-4000-8000-000000000001','B','RRA-000009') returning id")"
echo "$R" | grep -qi 'duplicate\|unique'; ok $? "and no two agreements share one"
[ "$(asrole 11111111-1111-4111-8111-111111111111 "select public.next_agreement_number()")" != "RRA-000003" ]
ok $? "a browser session cannot mint a number"

echo
echo "================= no production cron or destination in the package"
# Executable lines only. The baseline's header says which production
# catalogue it was extracted from, which is provenance worth keeping; what
# must not exist is a production ref in anything that RUNS.
cat "$PKG"/*.sql "$PKG"/install.sh "$PKG"/worker/wrangler.staging.jsonc \
  | sed -e 's/--.*$//' -e 's#//.*$##' | grep -qiE 'yuyzdsnrbfhkmfzpvhwx|drivereal\.com'
[ $? -ne 0 ]
ok $? "no production project ref or host in any executable line of the package"
grep -rqi 'bhpdppyxnkokzhlkgcsc' "$PKG/worker/wrangler.staging.jsonc"
ok $? "the Worker config names the staging backend"
grep -rqiE '^\s*(crons?|triggers)\s*[:=]' "$PKG" 2>/dev/null; [ $? -ne 0 ]
ok $? "no cron schedule in the staging package"
grep -rqiE 'resend|twilio|stripe\.com|api\.anthropic' "$PKG"/*.sql 2>/dev/null; [ $? -ne 0 ]
ok $? "the SQL reaches no communication or payment provider"

echo
[ "$fail" = 0 ] && echo "all eSign staging installation checks pass" || echo "$fail BLOCKER(S)"
exit $([ "$fail" = 0 ] && echo 0 || echo 1)
