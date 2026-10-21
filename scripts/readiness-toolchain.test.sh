#!/usr/bin/env bash
# The readiness script must find the TypeScript compiler in a linked worktree
# that has no node_modules of its own, and it must not download a compiler.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
fail=0

say() { printf '%s\n' "$*"; }

if grep -q 'npx' scripts/readiness-test.sh; then
  say "FAIL readiness-test.sh still mentions npx"
  fail=1
else
  say "PASS no package runner"
fi

tsc_here="$(bash scripts/readiness-test.sh --resolve tsc)"
esbuild_here="$(bash scripts/readiness-test.sh --resolve esbuild)"
if [[ "$tsc_here" == "$root/node_modules/typescript/bin/tsc" && -f "$tsc_here" ]] && grep -q "require('../lib/tsc.js')" "$tsc_here"; then
  say "PASS checkout tsc is the TypeScript compiler"
else
  say "FAIL checkout tsc: $tsc_here"
  fail=1
fi
if [[ "$esbuild_here" == "$root/node_modules/esbuild/bin/esbuild" && -f "$esbuild_here" ]]; then
  say "PASS checkout esbuild"
else
  say "FAIL checkout esbuild: $esbuild_here"
  fail=1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
main="$tmp/main"
wt="$tmp/wt"
mkdir -p "$main/node_modules/typescript/bin" "$main/node_modules/esbuild/bin"
printf '%s\n' '#!/usr/bin/env node' "require('../lib/tsc.js')" > "$main/node_modules/typescript/bin/tsc"
printf '%s\n' '#!/usr/bin/env node' 'console.log("esbuild")' > "$main/node_modules/esbuild/bin/esbuild"
chmod +x "$main/node_modules/typescript/bin/tsc" "$main/node_modules/esbuild/bin/esbuild"
git -C "$main" init -q
git -C "$main" -c user.email=readiness@example.com -c user.name=readiness commit -q --allow-empty -m init
git -C "$main" worktree add -q "$wt" HEAD
mkdir -p "$wt/scripts"
cp scripts/readiness-test.sh "$wt/scripts/readiness-test.sh"
wt_tsc="$(bash "$wt/scripts/readiness-test.sh" --resolve tsc)"
wt_esbuild="$(bash "$wt/scripts/readiness-test.sh" --resolve esbuild)"
if [[ "$wt_tsc" == "$main/node_modules/typescript/bin/tsc" && "$wt_esbuild" == "$main/node_modules/esbuild/bin/esbuild" ]]; then
  say "PASS worktree uses the main checkout"
else
  say "FAIL worktree tsc=$wt_tsc esbuild=$wt_esbuild"
  fail=1
fi

empty="$tmp/empty"
mkdir -p "$empty/scripts"
git -C "$empty" init -q
cp scripts/readiness-test.sh "$empty/scripts/readiness-test.sh"
if bash "$empty/scripts/readiness-test.sh" --resolve tsc >"$tmp/empty.out" 2>"$tmp/empty.err"; then
  say "FAIL empty checkout should not resolve tsc"
  fail=1
elif grep -q 'could not find node_modules/typescript/bin/tsc' "$tmp/empty.err"; then
  say "PASS missing compiler exits with a local-install message"
else
  say "FAIL missing compiler message"
  cat "$tmp/empty.err"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
say "TOOLCHAIN_EXIT:0"
