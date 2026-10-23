#!/usr/bin/env bash
# Seeds one approved synthetic driver, vehicle and signed agreement into the harness.
# The approval path is the M2 SQL proof's own sequence (from the packet ref),
# committed here instead of rolled back. Local harness database only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
D=/tmp/rr-harness; U="postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable"
P=$D/packet/scripts/m2-functional-proof.sql
start=$(grep -n '^BEGIN;$' $P | head -1 | cut -d: -f1)
cut=$(grep -n '^-- Evidence path. The issuer binds' $P | cut -d: -f1)
# The proof writes effectiveAt as "+00"; the app requires an RFC 3339 offset ("+00:00").
{ sed -n "${start},$((cut-1))p" $P | sed "s/'effectiveAt','2026-10-01T15:00:00+00'/'effectiveAt','2026-10-01T15:00:00+00:00'/"; cat scripts/record-rental-harness/seed-tail.sql; } > $D/seed.sql
psql "$U" -q -v ON_ERROR_STOP=1 -f $D/seed.sql > $D/seed.log 2>&1 || { tail -20 $D/seed.log; exit 1; }
psql "$U" -Atc "select 'seeded application status=' || status from public.applications where id='44444444-4444-4444-8444-444444444444'"
