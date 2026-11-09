#!/usr/bin/env bash
# Standing Cloudflare Workers smoke for PRs that touch the root shell or SSR.
#
# Builds the production worker and boots .output/server/wrangler.json under
# `wrangler dev --local`. The build exports dummy Supabase settings first
# (process env beats .env in Vite) and fails if supabase.co shows up outside
# the supabase-js library chunks. Listed routes must return HTTP 200. The
# unknown path must return HTTP 404. Also fails on `EvalError` /
# `Code generation from strings` in the workerd log (what `new Function` and
# `eval` at module scope produce). Prints whether each route's body contains
# googletagmanager. Always kills the wrangler/workerd process tree and removes
# temp dirs, including on failure.
#
# Reuses an existing wrangler when `wrangler --version` is 4.x. Otherwise
# installs wrangler@4.151.3 (newest published on 2026-10-21, engines node >= 22).
# Its newest *feature* compatibility date is 2026-10-19. Nitro writes
# compatibility_date "latest", the build day's UTC date. `--no-latest` keeps
# the date from wrangler.json. workerd accepts that date when it is not after
# today. A newer date than 2026-10-19 is still this pin: no published wrangler
# knows a later feature date.
#
# Node below 22: download Node 22.23.3 into the temp dir and run the pin with
# it. If that download fails, install wrangler@3.114.17 (engines node >= 16.17)
# and pass --compatibility-date 2024-09-23 with a loud warning. That is not
# the production compatibility date.
#
# Not part of the default readiness run. Opt in with WORKERD_SMOKE=1.
set -euo pipefail
cd "$(dirname "$0")/.."

PINNED_WRANGLER=4.151.3
PINNED_FEATURE_DATE=2026-10-19
NODE22_VERSION=v22.23.3
FALLBACK_WRANGLER=3.114.17
FALLBACK_COMPAT_DATE=2024-09-23
DUMMY_SUPABASE_URL=http://127.0.0.1:9
DUMMY_PUBLISHABLE=smoke-dummy-publishable-key
DUMMY_SERVICE=smoke-dummy-service-role-key

SMOKE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/workerd-smoke.XXXXXX")
case "$SMOKE_TMP" in
  /|/tmp|/var/tmp|"")
    echo "workerd-smoke: refusing to use temp dir '$SMOKE_TMP'" >&2
    exit 1
    ;;
esac
LOG="$SMOKE_TMP/wrangler.log"
FAILS="$SMOKE_TMP/fails"
: >"$FAILS"
DEV_VARS=""
WRANGLER_PID=""
STARTED=0

kill_descendants() {
  local pid=$1 sig=$2 child
  for child in $(ps -o pid= --ppid "$pid" 2>/dev/null || true); do
    kill_descendants "$child" "$sig"
  done
  kill -s "$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  set +e
  if [[ -n "$WRANGLER_PID" ]]; then
    local pgid
    pgid=$(ps -o pgid= -p "$WRANGLER_PID" 2>/dev/null | tr -d ' ' || true)
    if [[ -n "$pgid" && "$pgid" != "1" && "$pgid" != "0" ]]; then
      kill -TERM -- "-$pgid" 2>/dev/null || true
    fi
    kill_descendants "$WRANGLER_PID" TERM
    sleep 0.5
    if [[ -n "$pgid" && "$pgid" != "1" && "$pgid" != "0" ]]; then
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    kill_descendants "$WRANGLER_PID" KILL
    wait "$WRANGLER_PID" 2>/dev/null || true
  fi
  # workerd sometimes double-forks out of the process group. Only kill
  # processes whose command line is this smoke's temp dir or the built worker.
  local pid cmd
  for pid in $(pgrep -x workerd 2>/dev/null || true); do
    cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)
    if [[ "$cmd" == *"$SMOKE_TMP"* || "$cmd" == *".output/server"* ]]; then
      kill_descendants "$pid" TERM
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  if [[ "$STARTED" == 1 && -n "${PORT:-}" ]] && command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
  fi
  if [[ -n "$DEV_VARS" ]]; then
    rm -f "$DEV_VARS"
  fi
  rm -rf "$SMOKE_TMP"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

note() { printf 'workerd-smoke: %s\n' "$*"; }

fetch_node22() {
  local dest=$1 raw arch url extracted
  raw=$(uname -m)
  case "$raw" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *)
      echo "no Node 22 tarball for $raw" >&2
      return 1
      ;;
  esac
  url="https://nodejs.org/dist/${NODE22_VERSION}/node-${NODE22_VERSION}-linux-${arch}.tar.xz"
  note "fetching $url"
  mkdir -p "$SMOKE_TMP/node-src"
  if ! curl -fsSL --retry 3 --max-time 180 "$url" | tar -xJ -C "$SMOKE_TMP/node-src"; then
    return 1
  fi
  extracted="$SMOKE_TMP/node-src/node-${NODE22_VERSION}-linux-${arch}"
  if [[ ! -x "$extracted/bin/node" ]]; then
    return 1
  fi
  mv "$extracted" "$dest"
}

node_major() {
  node -p 'process.versions.node.split(".")[0]'
}

# Process env beats .env. These dummies are what Vite inlines into the SSR bundle.
export VITE_SUPABASE_URL="${DUMMY_SUPABASE_URL}"
export VITE_SUPABASE_PUBLISHABLE_KEY=x
export VITE_SUPABASE_PROJECT_ID=x
export SUPABASE_URL="${DUMMY_SUPABASE_URL}"
export SUPABASE_PUBLISHABLE_KEY=x
note "building with dummy Supabase env and NODE_OPTIONS=--max-old-space-size=4096"
if ! NODE_OPTIONS=--max-old-space-size=4096 node node_modules/vite/bin/vite.js build >"$SMOKE_TMP/build.log" 2>&1; then
  echo "workerd-smoke: build failed" >&2
  tail -n 80 "$SMOKE_TMP/build.log" >&2 || true
  exit 1
fi
note "build finished"

# supabase-js ships example hosts (xyzcompany.supabase.co, example.supabase.co)
# inside .output/server/_libs/supabase__*.mjs. Those are not this app's project.
# Vite inlines VITE_SUPABASE_URL into the SSR chunks, which are still scanned.
hosted=$(rg -n supabase.co .output/server || true)
if [[ -n "$hosted" ]]; then
  app_hosted=$(printf '%s\n' "$hosted" | grep -v '/_libs/supabase__' || true)
  if [[ -n "$app_hosted" ]]; then
    echo "workerd-smoke: supabase.co baked into .output/server outside the supabase-js library chunks" >&2
    printf '%s\n' "$app_hosted" | head -40 >&2
    exit 1
  fi
fi
if [[ -f .env ]]; then
  env_host=$(sed -n 's/^SUPABASE_URL=//p' .env | head -1 | tr -d "\"'" )
  env_host=${env_host#https://}
  env_host=${env_host#http://}
  env_host=${env_host%%/*}
  if [[ -n "$env_host" && "$env_host" == *.supabase.co ]]; then
    env_files=$(rg -l -F "$env_host" .output/server || true)
    if [[ -n "$env_files" ]]; then
      echo "workerd-smoke: .env SUPABASE_URL host is still in the server bundle" >&2
      printf '%s\n' "$env_files" >&2
      exit 1
    fi
  fi
fi
note "server bundle has no hosted Supabase URL"

if [[ ! -f .output/server/wrangler.json ]]; then
  echo "workerd-smoke: build did not write .output/server/wrangler.json" >&2
  exit 1
fi

WORKER_DATE=$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(".output/server/wrangler.json","utf8")); if(!j.compatibility_date) process.exit(2); process.stdout.write(String(j.compatibility_date));')
TODAY=$(node -e 'process.stdout.write(new Date().toISOString().slice(0,10))')
note "worker compatibility_date=${WORKER_DATE} today=${TODAY}"

USE_FALLBACK=0
NODE_MAJOR=$(node_major)
RUN_NODE=""
if (( NODE_MAJOR < 22 )); then
  note "Node $(node -v) is below 22. wrangler@${PINNED_WRANGLER} needs Node >= 22."
  if fetch_node22 "$SMOKE_TMP/node22"; then
    RUN_NODE="$SMOKE_TMP/node22/bin/node"
    export PATH="$SMOKE_TMP/node22/bin:$PATH"
    note "using fetched $($RUN_NODE -v) at $RUN_NODE"
  else
    USE_FALLBACK=1
    cat >&2 <<EOF

********************************************************************************
WARNING: Could not fetch Node ${NODE22_VERSION}. This machine is Node $(node -v).
WARNING: Falling back to wrangler@${FALLBACK_WRANGLER} with
WARNING:   --compatibility-date ${FALLBACK_COMPAT_DATE}
WARNING: The production worker date is ${WORKER_DATE}. This run does NOT use it.
WARNING: Install Node 22 or allow https://nodejs.org and re-run for a real result.
********************************************************************************

EOF
  fi
else
  note "using box Node $(node -v)"
fi

wrangler_is_4() {
  local text
  text=$("$1" --version 2>/dev/null || true)
  [[ "$text" =~ ([0-9]+)\.[0-9]+\.[0-9]+ && "${BASH_REMATCH[1]}" == "4" ]]
}

find_wrangler_4() {
  local candidate seen="|" global_bin
  local candidates=()
  if [[ -x node_modules/.bin/wrangler ]]; then
    candidates+=(node_modules/.bin/wrangler)
  fi
  if command -v wrangler >/dev/null 2>&1; then
    candidates+=("$(command -v wrangler)")
  fi
  global_bin=$(npm prefix -g 2>/dev/null || true)
  if [[ -n "$global_bin" && -x "$global_bin/bin/wrangler" ]]; then
    candidates+=("$global_bin/bin/wrangler")
  fi
  for candidate in "${candidates[@]}"; do
    [[ "$seen" == *"|$candidate|"* ]] && continue
    seen+="$candidate|"
    if wrangler_is_4 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

WRANGLER=""
if [[ "$USE_FALLBACK" == 1 ]]; then
  WRANGLER_VERSION=$FALLBACK_WRANGLER
else
  WRANGLER_VERSION=$PINNED_WRANGLER
  if WRANGLER=$(find_wrangler_4); then
    note "reusing wrangler $($WRANGLER --version 2>/dev/null || true) at $WRANGLER"
  fi
fi

if [[ -z "$WRANGLER" ]]; then
  note "installing wrangler@${WRANGLER_VERSION}"
  npm install --prefix "$SMOKE_TMP/pkg" --no-fund --no-audit --loglevel=error "wrangler@${WRANGLER_VERSION}"
  WRANGLER="$SMOKE_TMP/pkg/node_modules/.bin/wrangler"
fi
if [[ ! -x "$WRANGLER" ]]; then
  echo "workerd-smoke: wrangler binary missing at $WRANGLER" >&2
  exit 1
fi
note "wrangler $($WRANGLER --version 2>/dev/null || echo "$WRANGLER_VERSION")"

if [[ "$USE_FALLBACK" == 0 && "$WORKER_DATE" > "$TODAY" ]]; then
  echo "workerd-smoke: compatibility_date ${WORKER_DATE} is after today ${TODAY}. wrangler@${PINNED_WRANGLER} rejects a future date." >&2
  exit 1
fi
if [[ "$USE_FALLBACK" == 0 && "$WORKER_DATE" > "$PINNED_FEATURE_DATE" ]]; then
  note "worker date ${WORKER_DATE} is newer than wrangler@${PINNED_WRANGLER} feature date ${PINNED_FEATURE_DATE}; --no-latest still boots it because it is not after today"
fi

PORT=$(node -e 'const n=require("net"); const s=n.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')
INSPECTOR=$(node -e 'const n=require("net"); const s=n.createServer(); s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)); s.close();});')

DEV_VARS=.output/server/.dev.vars
cat >"$DEV_VARS" <<EOF
SUPABASE_URL=${DUMMY_SUPABASE_URL}
SUPABASE_PUBLISHABLE_KEY=${DUMMY_PUBLISHABLE}
SUPABASE_SERVICE_ROLE_KEY=${DUMMY_SERVICE}
VITE_SUPABASE_URL=${DUMMY_SUPABASE_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${DUMMY_PUBLISHABLE}
EOF
note "dummy Supabase env -> ${DUMMY_SUPABASE_URL} (closed local port)"

export CI=true
export WRANGLER_SEND_METRICS=false
export CLOUDFLARE_INCLUDE_PROCESS_ENV=false
export NO_COLOR=1

ARGS=(
  dev
  --config .output/server/wrangler.json
  --ip 127.0.0.1
  --port "$PORT"
  --inspector-port "$INSPECTOR"
  --persist-to "$SMOKE_TMP/state"
  --no-show-interactive-dev-session
  --var "SUPABASE_URL:${DUMMY_SUPABASE_URL}"
  --var "SUPABASE_PUBLISHABLE_KEY:${DUMMY_PUBLISHABLE}"
  --var "SUPABASE_SERVICE_ROLE_KEY:${DUMMY_SERVICE}"
  --var "VITE_SUPABASE_URL:${DUMMY_SUPABASE_URL}"
  --var "VITE_SUPABASE_PUBLISHABLE_KEY:${DUMMY_PUBLISHABLE}"
)
if [[ "$USE_FALLBACK" == 1 ]]; then
  ARGS+=(--no-latest --compatibility-date "$FALLBACK_COMPAT_DATE")
else
  # --local is the v4 flag. --no-latest keeps wrangler.json's compatibility_date
  # instead of substituting the pin's feature date.
  ARGS+=(--local --no-latest)
fi

note "wrangler ${ARGS[*]}"
setsid "$WRANGLER" "${ARGS[@]}" >"$LOG" 2>&1 &
WRANGLER_PID=$!
STARTED=1

deadline=$((SECONDS + 180))
ready=0
while (( SECONDS < deadline )); do
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo "workerd-smoke: wrangler exited before it was ready" >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  if grep -E -q 'EvalError|Code generation from strings' "$LOG"; then
    echo "workerd-smoke: log contains EvalError or Code generation from strings during startup" >&2
    grep -n -E 'EvalError|Code generation from strings' "$LOG" | head -40 >&2 || true
    exit 1
  fi
  if grep -q "Ready on " "$LOG"; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then
  echo "workerd-smoke: timed out waiting for wrangler (port ${PORT})" >&2
  tail -n 80 "$LOG" >&2 || true
  exit 1
fi
note "ready on http://127.0.0.1:${PORT}"

UNKNOWN="/workerd-smoke-no-such-route"
ROUTES=(
  "/"
  "/apply"
  "/apply?t=x"
  "/thank-you?t=x"
  "/sign/abc"
  "/card/abc?t=x"
  "/card/00000000-0000-4000-8000-000000000000?t=x"
  "/login"
  "/invite"
  "/admin"
  "/fleet"
  "/portal"
  "/faq"
  "/sitemap.xml"
  "$UNKNOWN"
)

mkdir -p "$SMOKE_TMP/bodies"
printf '%-56s %-6s %s\n' "route" "status" "googletagmanager"
for route in "${ROUTES[@]}"; do
  body="$SMOKE_TMP/bodies/body"
  code="000"
  if ! code=$(curl -sS -L --max-redirs 5 --max-time 45 --connect-timeout 10 \
    -o "$body" -w '%{http_code}' \
    "http://127.0.0.1:${PORT}${route}"); then
    if [[ ! "$code" =~ ^[0-9]{3}$ ]]; then
      code=000
    fi
  fi
  gtm=no
  if [[ -f "$body" ]] && grep -a -i -q 'googletagmanager' "$body"; then
    gtm=yes
  fi
  printf '%-56s %-6s %s\n' "$route" "$code" "$gtm"
  if [[ "$route" == "$UNKNOWN" ]]; then
    expect=404
  else
    expect=200
  fi
  if [[ "$code" != "$expect" ]]; then
    printf '%s %s expected %s\n' "$route" "$code" "$expect" >>"$FAILS"
  fi
done

if grep -E -q 'EvalError|Code generation from strings' "$LOG"; then
  echo "log EvalError or Code generation from strings" >>"$FAILS"
  echo "workerd-smoke: log contains EvalError or Code generation from strings" >&2
  grep -n -E 'EvalError|Code generation from strings' "$LOG" | head -40 >&2 || true
fi

if [[ -s "$FAILS" ]]; then
  echo "workerd-smoke: failed" >&2
  sed 's/^/  /' "$FAILS" >&2
  exit 1
fi

note "ok"
