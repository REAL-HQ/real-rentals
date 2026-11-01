#!/usr/bin/env bash
# Refuses unless the env file targets the approved staging project only. Prints names, never values.
# Usage: scripts/staging/guard.sh .env.staging.local
set -euo pipefail
F="${1:?env file}"; PROD_REF=yuyzdsnrbfhkmfzpvhwx; OLD_STAGING=bhpdppyxnkokzhlkgcsc
fail(){ echo "REFUSED: $*" >&2; exit 1; }
set -a; . "$F"; set +a
[[ "${APPROVED_STAGING_REF:-}" =~ ^[a-z]{20}$ ]] || fail "APPROVED_STAGING_REF not set (placeholder)"
[[ "$APPROVED_STAGING_REF" != "$PROD_REF" && "$APPROVED_STAGING_REF" != "$OLD_STAGING" ]] || fail "approved ref is prod/old staging"
for v in SUPABASE_PROJECT_ID VITE_SUPABASE_PROJECT_ID; do [[ "${!v:-}" == "$APPROVED_STAGING_REF" ]] || fail "$v != approved ref"; done
for v in SUPABASE_URL VITE_SUPABASE_URL; do [[ "${!v:-}" == "https://$APPROVED_STAGING_REF.supabase.co" ]] || fail "$v not staging"; done
grep -q "$PROD_REF" "$F" && fail "env file mentions production ref"
[[ "${VITE_PAYMENTS_CLIENT_TOKEN:-}" == pk_test_* ]] || fail "VITE_PAYMENTS_CLIENT_TOKEN not pk_test_"
[[ "${STRIPE_SANDBOX_API_KEY:-}" =~ ^(sk|rk)_test_ ]] || fail "STRIPE_SANDBOX_API_KEY not test"
for v in STRIPE_LIVE_API_KEY PAYMENTS_LIVE_WEBHOOK_SECRET LOVABLE_API_KEY RESEND_API_KEY TWILIO_AUTH_TOKEN; do [[ -z "${!v:-}" ]] || fail "$v must be unset"; done
grep -Eq '(sk|rk)_live_|pk_live_' "$F" && fail "live Stripe value present"
echo "OK: env targets approved staging $APPROVED_STAGING_REF (Stripe test mode only)"
