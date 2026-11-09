#!/usr/bin/env bash
# One-command release-candidate verification.
#
# Prints a pass/fail table, then exits non-zero if any step failed.
# scripts/enabled-flags-no-env.test.mjs is optional: when that file is not
# on this tree the row is "skip (not on this tree)" with exit 0 and a warning.
# Any other missing check is a failure. Pass --json for a JSON summary on stdout.
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

JSON=0
if [[ "${1:-}" == "--json" ]]; then
  JSON=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: bash scripts/rc-verify.sh [--json]" >&2
  exit 2
fi

LOGDIR=$(mktemp -d /tmp/rc-verify.XXXXXX)
failed=0
NAMES=()
CODES=()
RESULTS=()

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
  if [[ "$code" -eq 0 ]]; then
    RESULTS+=("pass")
  else
    RESULTS+=("fail")
    failed=1
  fi
  echo "  exit $code" >&2
}

# Only this one check may be absent. A missing file is a skip, not a failure.
step_enabled_flags() {
  if [[ ! -f scripts/enabled-flags-no-env.test.mjs ]]; then
    echo "warning: scripts/enabled-flags-no-env.test.mjs is not on this tree; skipped" >&2
    NAMES+=("enabled-flags-no-env")
    CODES+=("0")
    RESULTS+=("skip (not on this tree)")
    echo "  exit 0" >&2
    return 0
  fi
  step "enabled-flags-no-env" node scripts/enabled-flags-no-env.test.mjs
}

step "tsc --noEmit" node node_modules/typescript/bin/tsc --noEmit
step "vite build (dummy Supabase env)" env NODE_OPTIONS="--max-old-space-size=4096" node node_modules/vite/bin/vite.js build
step "readiness-test.sh" bash scripts/readiness-test.sh
step "bun run test" bun run test
step "guard.mjs --rc" node scripts/ci/record-rental/guard.mjs --rc
step "flag-single-source" node scripts/flag-single-source.test.mjs
step_enabled_flags
step "workerd-smoke.sh" bash scripts/workerd-smoke.sh

print_table() {
  printf '%-24s  %-6s  %s\n' "result" "exit" "step"
  printf '%-24s  %-6s  %s\n' "------------------------" "------" "----"
  local i
  for i in "${!NAMES[@]}"; do
    printf '%-24s  %-6s  %s\n' "${RESULTS[$i]}" "${CODES[$i]}" "${NAMES[$i]}"
  done
}

print_json() {
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8").trim();
    const steps = raw ? raw.split("\n").map((line) => {
      const [step, result, exit] = line.split("\t");
      return { step, result, exit: Number(exit) };
    }) : [];
    const ok = steps.every((step) => step.exit === 0);
    process.stdout.write(JSON.stringify({ ok, steps }, null, 2) + "\n");
  ' <<EOF
$(
  local i
  for i in "${!NAMES[@]}"; do
    printf '%s\t%s\t%s\n' "${NAMES[$i]}" "${RESULTS[$i]}" "${CODES[$i]}"
  done
)
EOF
}

if [[ "$JSON" == 1 ]]; then
  print_table >&2
  echo >&2
  echo "logs: $LOGDIR" >&2
else
  echo
  print_table
  echo
  echo "logs: $LOGDIR"
fi

if [[ "$failed" -ne 0 ]]; then
  {
    echo
    echo "failures (last 40 lines):"
    for i in "${!NAMES[@]}"; do
      if [[ "${RESULTS[$i]}" == "fail" ]]; then
        safe=$(printf '%s' "${NAMES[$i]}" | tr -c 'A-Za-z0-9._-' '_')
        echo
        echo "----- ${NAMES[$i]} (exit ${CODES[$i]}) -----"
        tail -n 40 "$LOGDIR/$safe.log"
      fi
    done
    echo
    echo "rc-verify: failed"
  } >&2
  if [[ "$JSON" == 1 ]]; then
    print_json
  fi
  exit 1
fi

if [[ "$JSON" == 1 ]]; then
  print_json
  echo "rc-verify: ok" >&2
else
  echo "rc-verify: ok"
fi
exit 0
