#!/usr/bin/env bash
# One-command release-candidate verification.
#
# Prints a table of exit codes, then exits non-zero if any gating step failed.
# The default record-rental guard (no --rc) is reported and does not gate:
# it requires the isolated candidate diff, which already fails on live.
#
# Supabase is forced to a closed local port before any step, so nothing here
# can call a hosted project. scripts/workerd-smoke.sh runs only when that
# file is present; on a branch that does not have it, the row is a skip.
#
# maintenance/fleet/pickup/tolls tests run one file per process. Several of
# them call process.exit, which would hide every later file in a shared run.
# marketing-fleet.test.mjs is already inside `bun run test`.
# marketing-fleet-e2e.test.mjs needs a separate dev server and is not part of
# this command.
set -u
cd "$(dirname "$0")/.."

export SUPABASE_URL="http://127.0.0.1:9"
export SUPABASE_ANON_KEY="rc-verify-dummy"
export SUPABASE_PUBLISHABLE_KEY="rc-verify-dummy"
export SUPABASE_SERVICE_ROLE_KEY="rc-verify-dummy"
export VITE_SUPABASE_URL="http://127.0.0.1:9"
export VITE_SUPABASE_PUBLISHABLE_KEY="rc-verify-dummy"
export VITE_SUPABASE_ANON_KEY="rc-verify-dummy"
export CI="true"
export CLOUDFLARE_INCLUDE_PROCESS_ENV="false"

LOGDIR=$(mktemp -d /tmp/rc-verify.XXXXXX)
failed=0
NAMES=()
CODES=()
GATES=()

record() {
  NAMES+=("$1")
  CODES+=("$2")
  GATES+=("$3")
  if [[ "$3" == "yes" && "$2" != "0" ]]; then
    failed=1
  fi
}

step() {
  local name="$1" gate="$2"
  shift 2
  local safe log
  safe=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')
  log="$LOGDIR/$safe.log"
  echo "running $name" >&2
  "$@" >"$log" 2>&1
  local code=$?
  record "$name" "$code" "$gate"
  echo "  exit $code" >&2
}

# node:test files import TypeScript, so they need the tsx loader and the
# test runner. The other files are plain scripts; bun is what their headers
# say to use, and each one stays its own process.
run_one() {
  local file="$1"
  if grep -q 'from "node:test"' "$file"; then
    node --import tsx --test "$file"
  else
    bun "$file"
  fi
}

grep_output() {
  if [[ ! -d .output ]]; then
    echo ".output is missing; the build did not produce it"
    return 1
  fi
  local hits
  # Match a call, not the substring. `new FunctionsClient` is not `new Function(`.
  hits=$(grep -R -n -E \
    -e 'new Function[[:space:]]*\(' \
    -e '(^|[^A-Za-z0-9_.])eval[[:space:]]*\(' \
    --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.html' \
    .output || true)
  if [[ -n "$hits" ]]; then
    printf '%s\n' "$hits"
    return 1
  fi
  echo "no eval( or new Function( under .output"
}

step "tsc --noEmit" yes node node_modules/typescript/bin/tsc --noEmit
step "readiness-test.sh" yes bash scripts/readiness-test.sh
step "bun run test" yes bun run test
step "guard.test.mjs" yes node scripts/ci/record-rental/guard.test.mjs
step "guard.mjs default (pre-existing on live)" no node scripts/ci/record-rental/guard.mjs
step "guard.mjs --rc" yes node scripts/ci/record-rental/guard.mjs --rc
step "stripe-reader vitest" yes node node_modules/vitest/vitest.mjs run --config scripts/stripe-reader.vitest.config.ts
step "expense-categories vitest" yes node node_modules/vitest/vitest.mjs run --config scripts/expense-categories.vitest.config.ts

ONE_AT_A_TIME=(
  scripts/maintenance-due.test.ts
  scripts/maintenance-log.test.ts
  scripts/maintenance-rules.test.ts
  scripts/fleet-availability.test.ts
  scripts/fleet-calendar.test.ts
  scripts/fleet-filters.test.ts
  scripts/fleet-inbox.test.ts
  scripts/pickup-checklist.test.ts
  scripts/portal-pickup-checklist.test.ts
  scripts/tolls-tickets-ledger.test.ts
)
for file in "${ONE_AT_A_TIME[@]}"; do
  step "$file" yes run_one "$file"
done

step "vite build (4GB)" yes env NODE_OPTIONS="--max-old-space-size=4096" node node_modules/vite/bin/vite.js build
step "grep eval/new Function in .output" yes grep_output
step "flag-single-source" yes node scripts/flag-single-source.test.mjs

if [[ -f scripts/workerd-smoke.sh ]]; then
  step "workerd-smoke.sh" yes bash scripts/workerd-smoke.sh
else
  record "workerd-smoke.sh (absent)" "skip" "no"
  echo "workerd-smoke.sh absent; skipped" >&2
fi

echo
printf '%-6s  %-4s  %s\n' "exit" "gate" "step"
printf '%-6s  %-4s  %s\n' "------" "----" "----"
for i in "${!NAMES[@]}"; do
  printf '%-6s  %-4s  %s\n' "${CODES[$i]}" "${GATES[$i]}" "${NAMES[$i]}"
done
echo
echo "logs: $LOGDIR"

if [[ "$failed" -ne 0 ]]; then
  echo
  echo "gating failures (last 40 lines):"
  for i in "${!NAMES[@]}"; do
    if [[ "${GATES[$i]}" == "yes" && "${CODES[$i]}" != "0" ]]; then
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
