#!/usr/bin/env bash
# Disposable eSign test stack: throwaway Postgres (127.0.0.1:55432, db "esign"),
# PostgREST (:55433) and the harness proxy (:55434). Never touches the hosted
# backend. Tear down with scripts/esign-harness/down.sh.
set -euo pipefail
D=/tmp/esign-harness-db; B="postgresql://postgres@127.0.0.1:55432"; U="$B/esign?sslmode=disable"
SECRET=esign-harness-jwt-secret-not-a-real-key-000000
grep -q '^pgtest:' /etc/passwd || { echo "pgtest:x:65534:65534::$D:/bin/sh" >> /etc/passwd; echo "pgtest:x:65534:" >> /etc/group; }
R="setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=$D"
if ! psql "$B/postgres?sslmode=disable" -Atc 'select 1' >/dev/null 2>&1; then
  rm -rf $D; mkdir -p $D; chown 65534:65534 $D
  $R initdb -D $D/data -U postgres -A trust >/dev/null
  $R pg_ctl -D $D/data -o "-p 55432 -k /tmp -c listen_addresses=127.0.0.1" -l $D/log start >/dev/null; sleep 2
fi
psql "$B/postgres?sslmode=disable" -qc "drop database if exists esign with (force)" -c "create database esign"
psql "$U" -q -f scripts/esign-harness/stubs.sql >/dev/null 2>&1
psql "$U" -qc "alter database esign set search_path=public,extensions"
: > $D/replay.log
for f in supabase/migrations/*.sql drizzle/migrations/*.sql; do
  sed -E 's/^\s*create extension[^;]*(pg_net|pg_cron|pg_graphql|supabase_vault|pgsodium)[^;]*;//Ig' "$f" > $D/m.sql
  psql "$U" -q -v ON_ERROR_STOP=1 -1 -f $D/m.sql >/dev/null 2>&1 || echo "skipped $f" >> $D/replay.log
done
# Staged Phase A template migration — applied HERE ONLY, never to the hosted DB.
psql "$U" -q -v ON_ERROR_STOP=1 -1 -f scripts/esign-template-versioning.proposed.sql >/dev/null 2>&1
psql "$U" -qc "grant usage on schema public to anon, authenticated, service_role; notify pgrst, 'reload schema'"
echo "replay: $(ls supabase/migrations drizzle/migrations | grep -c sql) files, $(wc -l < $D/replay.log) skipped (see $D/replay.log)"
pkill -f "postgrest $D" 2>/dev/null || true; pkill -f "bun scripts/esign-harness/[p]roxy.ts" 2>/dev/null || true
cat > $D/pgrst.conf <<C
db-uri = "postgresql://authenticator@127.0.0.1:55432/esign?sslmode=disable"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 55433
C
psql "$U" -qc "alter role authenticator with login; grant connect on database esign to authenticator"
PGRST=$(nix run nixpkgs#postgrest -- --help >/dev/null 2>&1; nix eval --raw nixpkgs#postgrest.outPath 2>/dev/null)/bin/postgrest
(setsid nohup $PGRST $D/pgrst.conf > $D/pgrst.log 2>&1 < /dev/null &)
(HARNESS_DB_URL="$U" setsid nohup bun scripts/esign-harness/proxy.ts > $D/proxy.log 2>&1 < /dev/null &)
for i in $(seq 30); do curl -sf http://127.0.0.1:55433/ >/dev/null 2>&1 && curl -s http://127.0.0.1:55434/x >/dev/null 2>&1 && break; sleep 1; done
echo "stack up"
