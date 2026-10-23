#!/usr/bin/env bash
# Transpile the pure modules, then run the assertions against the output.
#
# tsc resolves the "@/lib/..." alias for typechecking but emits it verbatim,
# and Node has no idea what it means, so the one import between the two
# modules is rewritten to a relative path afterwards.
#
# Compilers come from this checkout's node_modules, or from the main
# worktree when this directory is a linked worktree without its own
# install. A package runner is not used: the registry package named tsc
# is not the TypeScript compiler.
set -euo pipefail

resolve_tool() {
  local rel="$1"
  local label="$2"
  local root candidate common
  local -a roots=()
  roots+=("$PWD")
  common=""
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  fi
  if [[ -n "$common" ]]; then
    roots+=("$(dirname "$common")")
  fi
  local seen=" "
  for root in "${roots[@]}"; do
    [[ -n "$root" && "$root" != "/" ]] || continue
    case "$seen" in
      *" $root "*) continue ;;
    esac
    seen+="$root "
    candidate="$root/node_modules/$rel"
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "readiness-test: could not find node_modules/$rel ($label) in this checkout or its main worktree. Link node_modules from a checkout that has dependencies installed." >&2
  return 1
}

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--resolve" ]]; then
  case "${2:-}" in
    tsc) resolve_tool typescript/bin/tsc "TypeScript compiler" ;;
    esbuild) resolve_tool esbuild/bin/esbuild "esbuild" ;;
    *)
      echo "usage: $0 --resolve tsc|esbuild" >&2
      exit 2
      ;;
  esac
  exit 0
fi

tsc_bin="$(resolve_tool typescript/bin/tsc "TypeScript compiler")"
esbuild_bin="$(resolve_tool esbuild/bin/esbuild "esbuild")"

rm -rf .readiness-build .docfn-build
"$tsc_bin" -p scripts/readiness-tsconfig.json
sed -i 's|"@/lib/readiness"|"./readiness.js"|g' .readiness-build/*.js

# documents.functions.ts is a server module: it imports the TanStack server-fn
# factory and the auth middleware at the top level, neither of which Node can
# load on its own. Bundling it with those two stubbed lets the registration
# tests exercise the real code rather than a transcription of it.
mkdir -p .docfn-build/stub/react-start
cat > .docfn-build/stub/react-start/index.js <<'STUB'
export const createServerFn = () => {
  const api = { middleware: () => api, inputValidator: () => api, handler: (fn) => fn };
  return api;
};
STUB
cat > .docfn-build/stub/react-start/server.js <<'STUB'
export const getRequest = () => ({ headers: new Map() });
STUB
cat > .docfn-build/stub/auth-middleware.js <<'STUB'
export const requireSupabaseAuth = {};
STUB
"$esbuild_bin" src/lib/documents.functions.ts --bundle --platform=node --format=esm \
  --alias:@=./src \
  --alias:@tanstack/react-start=./.docfn-build/stub/react-start \
  --alias:@/integrations/supabase/auth-middleware=./.docfn-build/stub/auth-middleware.js \
  --outfile=.docfn-build/documents.functions.mjs --log-level=warning
node scripts/readiness.test.mjs
node scripts/assessment-guard.test.mjs
node scripts/applicant-security.test.mjs
node scripts/resume-payload.test.mjs
node scripts/trip-screenshots.test.mjs
node scripts/agreement-guard.test.mjs
node scripts/document-registration.test.mjs
node scripts/readiness-documents.test.mjs
