#!/usr/bin/env bash
set -euo pipefail
node scripts/ci/stripe/network-check.mjs
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_offline=true
# Required inputs are never capability-skipped.
for file in scripts/stripe-collections.test.ts scripts/stripe-collections-server.test.ts scripts/stripe-collections-auth.test.ts scripts/stripe-collections.vitest.config.ts; do
  test -s "$file" || { echo "MISSING REQUIRED STRIPE TEST: $file" >&2; exit 1; }
done
node -e 'if(require("./scripts/ci/stripe/tooling/node_modules/vitest/package.json").version!=="3.2.4")throw Error("Wrong Vitest")'
# Vitest is test-only: never change application package.json/bun.lock.
for package in vitest @vitest; do
  test ! -e "node_modules/$package" && test ! -L "node_modules/$package"
  ln -s "../scripts/ci/stripe/tooling/node_modules/$package" "node_modules/$package"
done
node scripts/ci/stripe/tooling/node_modules/vitest/vitest.mjs run --config scripts/stripe-collections.vitest.config.ts --reporter=json --outputFile=.stripe-ci-results.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/ci/stripe/static-check.mjs
node scripts/ci/stripe/regressions.mjs
git diff --exit-code -- package.json bun.lock
