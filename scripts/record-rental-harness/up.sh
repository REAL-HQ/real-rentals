#!/usr/bin/env bash
# Disposable Record Rental stack. Never touches a hosted backend.
#   Postgres 127.0.0.1:55462 (db rr), PostgREST :55463, gateway proxy :55464.
# Builds the production-order baseline and installs the M2 packet with the hosted
# amendments from the rehearsal manifest at $M2_PACKET_REF, then provisions the
# rr_evidence_transport login. Tear down with scripts/record-rental-harness/down.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
REF="${M2_PACKET_REF:-origin/review/m2-packet-29d47ee3}"
D=/tmp/rr-harness; B="postgresql://postgres@127.0.0.1:55462"; U="$B/rr?sslmode=disable"
SECRET=record-rental-harness-jwt-secret-not-a-real-key-0000
R="setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$D"
PGBIN=/usr/lib/postgresql/16/bin
pkill -f "postgrest $D" 2>/dev/null || true; pkill -f "record-rental-harness/[p]roxy.ts" 2>/dev/null || true
if ! psql "$B/postgres?sslmode=disable" -Atc 'select 1' >/dev/null 2>&1; then
  rm -rf $D; mkdir -p $D; chown 65534:65534 $D
  $R $PGBIN/initdb -D $D/data -U postgres -A trust >/dev/null
  setsid $R $PGBIN/pg_ctl -D $D/data -o "-p 55462 -k /tmp -c listen_addresses=127.0.0.1" -l $D/log start >/dev/null < /dev/null; sleep 2
fi
psql "$B/postgres?sslmode=disable" -qc "drop database if exists rr with (force)" -c "create database rr"
for r in anon authenticated service_role authenticator supabase_admin supabase_storage_admin supabase_auth_admin rr_evidence_transport rr_evidence_issuer rr_approval_executor rr_record_executor; do
  psql "$B/postgres?sslmode=disable" -qc "drop role if exists $r" >/dev/null 2>&1 || true
done
psql "$U" -q -v ON_ERROR_STOP=1 -f scripts/record-rental-harness/stubs.sql >/dev/null
psql "$U" -qc "alter database rr set search_path=public,extensions"

# The packet, its manifest and generators come from the review ref, unmodified.
rm -rf $D/packet; mkdir -p $D/packet
git archive "$REF" proposed scripts supabase/migrations drizzle/migrations | tar -x -C $D/packet
ln -sfn "$ROOT/node_modules" $D/packet/node_modules
cp scripts/record-rental-harness/apply.mjs $D/packet/rr-apply.mjs
# Production order: the baseline (ords 1-143), then Security 0031 (installed in production on
# 2026-10-24, before M2), then the M2 preflight, packet steps and verifies up to LAST_ORD.
if [ "${RR_HARNESS_0031:-1}" = "1" ]; then
  (cd $D/packet && RR_HARNESS_DB_URL="$U" node rr-apply.mjs 143)
  psql "$U" -q -v ON_ERROR_STOP=1 -f scripts/record-rental-harness/security-0031-policies.sql >/dev/null
  (cd $D/packet && RR_HARNESS_DB_URL="$U" node rr-apply.mjs "${RR_HARNESS_LAST_ORD:-206}" 144)
else
  (cd $D/packet && RR_HARNESS_DB_URL="$U" node rr-apply.mjs "${RR_HARNESS_LAST_ORD:-206}")
fi

# Transport login as proposed/record-rental-transport: issuer and approval-executor memberships, SET ROLE only, never inherited.
psql "$U" -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE rr_evidence_transport LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'harness-transport-only';
-- Grants only the roles the installed steps have created (a partial install stops early).
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['rr_evidence_issuer','rr_approval_executor'] LOOP
  IF to_regrole(r) IS NOT NULL THEN EXECUTE format('GRANT %I TO rr_evidence_transport WITH INHERIT FALSE, SET TRUE', r); END IF;
 END LOOP; END $$;
GRANT CONNECT ON DATABASE rr TO rr_evidence_transport;
GRANT CONNECT ON DATABASE rr TO authenticator;
INSERT INTO storage.buckets(id, name, public) VALUES ('rental-agreements','rental-agreements',false),('driver-docs','driver-docs',false) ON CONFLICT DO NOTHING;
SQL

# Historical agreements (proposed/record-rental-historical) on top of the full packet and
# the paper-agreements proposal it reuses. RR_HARNESS_HISTORICAL=0 leaves them out.
if [ "${RR_HARNESS_LAST_ORD:-206}" = 206 ] && [ "${RR_HARNESS_HISTORICAL:-1}" != 0 ]; then
  psql "$U" -q -v ON_ERROR_STOP=1 -f $D/packet/proposed/paper-agreements-v1.sql >/dev/null
  for f in proposed/record-rental-historical/0*.sql; do case "$f" in *rollback*) continue;; esac
    psql "$U" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
  echo "historical agreements installed"
  # The signed evidence gateway (proposed/record-rental-gateway) with a harness-only key.
  psql "$U" -q -v ON_ERROR_STOP=1 -f proposed/record-rental-gateway/01-evidence-gateway-v1.sql >/dev/null
  psql "$U" -q -v ON_ERROR_STOP=1 -v gateway_key_hex=$(printf 'record-rental-harness-gateway-key-not-real' | sha256sum | cut -c1-64) \
    -f proposed/record-rental-gateway/02-set-gateway-key.sql >/dev/null
  echo "evidence gateway installed"
fi

cat > $D/pgrst.conf <<C
db-uri = "postgresql://authenticator:harness-authenticator@127.0.0.1:55462/rr?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 55463
C
PGRST="${PGRST_BIN:-/tmp/pgrst/postgrest}"
[ -x "$PGRST" ] || { mkdir -p /tmp/pgrst; curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C /tmp/pgrst; }
(setsid nohup "$PGRST" $D/pgrst.conf > $D/pgrst.log 2>&1 < /dev/null &)
(HARNESS_DB_URL="$U" HARNESS_PGRST=http://127.0.0.1:55463 HARNESS_JWT_SECRET="$SECRET" HARNESS_PORT=55464 setsid nohup bun scripts/record-rental-harness/proxy.ts > $D/proxy.log 2>&1 < /dev/null &)
for i in $(seq 30); do curl -sf http://127.0.0.1:55463/ >/dev/null 2>&1 && curl -s http://127.0.0.1:55464/x >/dev/null 2>&1 && break; sleep 1; done
echo "record rental harness up"
