#!/usr/bin/env bash
# One-command release-candidate verification.
#
# Prints a pass/fail table, then exits non-zero if any step failed.
# Supabase is forced to a closed local port before the build and every later
# step, so Vite does not inline a hosted URL from .env and nothing here calls
# a hosted project. scripts/workerd-smoke.sh is the #204 smoke: it builds
# again with the same dummy env and checks the worker.
set -u
cd "$(dirname "$0")/.."

# Process env beats .env in Vite. These are the build-time dummies.
export VITE_SUPABASE_URL="http://127.0.0.1:9"
export VITE_SUPABASE_PUBLISHABLE_KEY="x"
export VITE_SUPABASE_PROJECT_ID="x"
export SUPABASE_URL="http://127.0.0.1:9"
export SUPABASE_PUBLISHABLE_KEY="x"
export SUPABASE_ANON_KEY="x"
export SUPABASE_SERVICE_ROLE_KEY="x"
export CI="true"
export CLOUDFLARE_INCLUDE_PROCESS_ENV="false"

LOGDIR=$(mktemp -d /tmp/rc-verify.XXXXXX)
failed=0
NAMES=()
CODES=()

step() {
  local name="$1"
  shift
  local safe log code
  safe=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
  log="$LOGDIR/$safe.log"
  echo "running $name" >&2
  "$@" >"$log" 2>&1
  code=$?
  NAMES+=("$name")
  CODES+=("$code")
  if [[ "$code" -ne 0 ]]; then
    failed=1
  fi
  echo "  exit $code" >&2
}

step "tsc --noEmit" node node_modules/typescript/bin/tsc --noEmit
step "vite build (dummy Supabase env)" env NODE_OPTIONS="--max-old-space-size=4096" node node_modules/vite/bin/vite.js build
step "readiness-test.sh" bash scripts/readiness-test.sh
step "bun run test" bun run test
step "guard.mjs --rc" node scripts/ci/record-rental/guard.mjs --rc
step "flag-single-source" node scripts/flag-single-source.test.mjs
step "enabled-flags-no-env" node scripts/enabled-flags-no-env.test.mjs
step "workerd-smoke.sh" bash scripts/workerd-smoke.sh

echo
printf '%-6s  %-6s  %s\n' "result" "exit" "step"
printf '%-6s  %-6s  %s\n' "------" "------" "----"
for i in "${!NAMES[@]}"; do
  if [[ "${CODES[$i]}" == "0" ]]; then
    result=pass
  else
    result=fail
  fi
  printf '%-6s  %-6s  %s\n' "$result" "${CODES[$i]}" "${NAMES[$i]}"
done
echo
echo "logs: $LOGDIR"

if [[ "$failed" -ne 0 ]]; then
  echo
  echo "failures (last 40 lines):"
  for i in "${!NAMES[@]}"; do
    if [[ "${CODES[$i]}" != "0" ]]; then
      safe=$(printf '%s' "${NAMES[$i]}" | tr -c 'A-Za-z0-9._-' '_')
      echo
      echo "----- ${NAMES[$i]} (exit ${CODES[$i]}) -----"
      tail -n 40 "$LOGDIR/$safe.log"
    fi
  done
  echo
  echo "rc-verify: failed"
  exit 1
fi

echo "rc-verify: ok"
exit 0
