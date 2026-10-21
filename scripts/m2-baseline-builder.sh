#!/bin/bash
# Build the local rehearsal baseline. Does not contact a hosted database.
# Prerequisite: the database is already loaded from supabase/migrations.
# If application_identity_reviews is missing, apply Drizzle 0014 through 0023.
# Always ensure storage.objects.user_metadata jsonb and version text.
# Does not create private.approval_validate or private.approval_snapshot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGURL="${M2_DATABASE_URL:-postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable}"

case "$PGURL" in
  *127.0.0.1*|*localhost*|*\[::1\]*) ;;
  *) echo "refusing non-local database: $PGURL" >&2; exit 1 ;;
esac
if [[ "$PGURL" == *supabase.co* || "$PGURL" == *amazonaws.com* ]]; then
  echo "refusing hosted database" >&2
  exit 1
fi

psqlq() { psql "$PGURL" -v ON_ERROR_STOP=1 "$@"; }

missing="$(psqlq -At -c "SELECT to_regclass('public.application_identity_reviews') IS NULL")"
if [[ "$missing" == "t" ]]; then
  for f in \
    0014_waitlist_holds_and_safe_promotion.sql \
    0015_waitlist_promotion_identity_review.sql \
    0016_0016_driver_deletion_stage1.sql \
    0017_0017_driver_deletion_security_repair.sql \
    0018_portal_signin_challenges.sql \
    0019_application_identity_reviews.sql \
    0020_identity_reviews_tighten_grants.sql \
    0021_phase_b_active_requires_running_rental.sql \
    0022_waitlist_resolve_phone_conflict.sql \
    0023_application_resume_atomic_security.sql
  do
    echo "APPLY $f"
    psqlq -1 -f "$ROOT/drizzle/migrations/$f"
  done
else
  echo "application_identity_reviews already present; leaving Drizzle 0014-0023 unapplied"
fi

psqlq -c "ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS user_metadata jsonb;"
psqlq -c "ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS version text;"

if [[ "$(psqlq -At -c "SELECT to_regprocedure('private.approval_validate(uuid)') IS NOT NULL OR to_regprocedure('private.approval_snapshot(uuid)') IS NOT NULL")" == "t" ]]; then
  echo "approval_validate or approval_snapshot is already installed; this builder does not create them and will not treat step 0 as the baseline" >&2
  exit 1
fi

echo "baseline ready"
