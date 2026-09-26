#!/usr/bin/env bash
# Transpile the readiness modules, then run the assertions against the output.
#
# tsc resolves the "@/lib/..." alias for typechecking but emits it verbatim,
# and Node has no idea what it means, so the one import between the two
# modules is rewritten to a relative path afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .readiness-build
npx tsc -p scripts/readiness-tsconfig.json
sed -i 's|"@/lib/readiness"|"./readiness.js"|g' .readiness-build/*.js
node scripts/readiness.test.mjs
