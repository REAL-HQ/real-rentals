#!/usr/bin/env bash
# ===========================================================================
# Verify a BUILT staging Worker artifact before it is deployed.
#
#   bash scripts/esign-staging/verify-artifact.sh [.output]
#
# THE FINDING THIS EXISTS FOR.
#
# src/integrations/supabase/client.ts reads
#
#     import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
#
# and `import.meta.env.*` is a BUILD-TIME REPLACEMENT. Vite substitutes the
# literal value into the bundle while compiling. It is not read from the
# Worker's environment at runtime.
#
# So setting VITE_SUPABASE_URL in wrangler.staging.jsonc does NOTHING for the
# browser client: whatever VITE_SUPABASE_URL was set when `vite build` ran is
# already baked into .output/public/assets/index-*.js and into the SSR client
# chunk. Build this repo with the ordinary .env present and the staging Worker
# serves a browser that talks to PRODUCTION Supabase, with the staging URL
# used only on the server — the worst possible split, because the browser
# half would be reading and writing real customer records.
#
# The artifact therefore has to be BUILT with the staging values in the
# environment:
#
#   VITE_SUPABASE_URL=https://bhpdppyxnkokzhlkgcsc.supabase.co \
#   VITE_SUPABASE_PROJECT_ID=bhpdppyxnkokzhlkgcsc \
#   VITE_SUPABASE_PUBLISHABLE_KEY=<staging publishable key> \
#   npx vite build
#
# and this script is what proves it afterwards. Run it on the exact directory
# that will be deployed, every time, before `wrangler deploy`.
# ===========================================================================
set -uo pipefail

OUT="${1:-.output}"
PROD_REF="yuyzdsnrbfhkmfzpvhwx"
STAGING_REF="bhpdppyxnkokzhlkgcsc"

fail=0
ok() { if [ "$1" = 0 ]; then echo "  PASS  $2"; else fail=$((fail+1)); echo "  BLOCKER  $2"; fi; }

[ -d "$OUT" ] || { echo "no build directory at $OUT — run the staging build first"; exit 1; }

echo
echo "================= the built client talks to staging, not production"
N_PROD="$(grep -rho "$PROD_REF" "$OUT" 2>/dev/null | wc -l | tr -d ' ')"
[ "$N_PROD" = "0" ]
ok $? "the production project ref appears 0 times in the artifact (found $N_PROD)"
if [ "$N_PROD" != "0" ]; then
  echo "           files carrying it:"
  grep -rl "$PROD_REF" "$OUT" 2>/dev/null | sed 's/^/             /'
  echo "           This artifact was built WITHOUT the staging VITE_* values."
  echo "           Rebuild as described at the top of this script."
fi

N_STAGING="$(grep -rho "$STAGING_REF" "$OUT" 2>/dev/null | wc -l | tr -d ' ')"
[ "$N_STAGING" != "0" ]
ok $? "the staging project ref IS baked into the artifact (found $N_STAGING)"

echo
echo "================= the deployed config is the staging one"
CFG="$OUT/server/wrangler.json"
[ -f "$CFG" ]; ok $? "server/wrangler.json is present"
if [ -f "$CFG" ]; then
  # Comments stripped first: the config explains in prose that it has no
  # triggers block, and a naive grep matches that sentence rather than a
  # setting. Only what wrangler would actually read is checked.
  CFG_CODE="$(sed 's#//.*$##' "$CFG")"
  grep -q "$STAGING_REF" "$CFG"; ok $? "  it names the staging backend"
  ! echo "$CFG_CODE" | grep -q "$PROD_REF"; ok $? "  and not the production one"
  echo "$CFG_CODE" | grep -q '"workers_dev"[[:space:]]*:[[:space:]]*false'; ok $? "  workers_dev is false"
  echo "$CFG_CODE" | grep -q '"routes"[[:space:]]*:[[:space:]]*\[\]'; ok $? "  routes is empty"
  ! echo "$CFG_CODE" | grep -qiE '"(triggers|crons)"[[:space:]]*:'; ok $? "  no cron triggers"
  ! echo "$CFG_CODE" | grep -qiE '(sb_secret_|re_[A-Za-z0-9]{20}|sk_live_|SK[0-9a-f]{30})'; ok $? "  no credential in the config"
fi

echo
echo "================= what the bundle can still reach"
# These are compiled-in code paths, not configured destinations. They are
# reported, not failed: the provider keys are deliberately unset on the
# staging Worker, so each path fails closed and records its failure on the
# agreement row. That is the capture-only behaviour acceptance observes.
for h in api.resend.com api.twilio.com api.stripe.com api.anthropic.com; do
  printf '  note  %-20s compiled in %s time(s) — unreachable without its key\n' \
    "$h" "$(grep -rho "$h" "$OUT" 2>/dev/null | wc -l | tr -d ' ')"
done
printf '  note  %-20s compiled in %s time(s) — the SITE_URL fallback and copy;\n' \
  "drivereal.com" "$(grep -rho 'drivereal\.com' "$OUT" 2>/dev/null | wc -l | tr -d ' ')"
echo "        PUBLIC_SITE_URL/SITE_URL are set in the Worker config, so minted"
echo "        links use the gated staging host, not this fallback."

echo
[ "$fail" = 0 ] && echo "artifact is safe to deploy to staging" || echo "$fail BLOCKER(S) — do not deploy"
exit $([ "$fail" = 0 ] && echo 0 || echo 1)
