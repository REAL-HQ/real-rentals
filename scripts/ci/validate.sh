#!/usr/bin/env bash
set -euo pipefail
# Invoked only inside a fresh network namespace after privilege drop.
node scripts/ci/network-check.mjs
# Tests import these tools by package name. Do not overwrite runtime dependencies.
for tool in tsx playwright esbuild; do
  if [ ! -e "node_modules/$tool" ]; then
    ln -s "../scripts/ci/tooling/node_modules/$tool" "node_modules/$tool"
  fi
done
./node_modules/.bin/tsc --noEmit
npm run build
node scripts/ci/lint-correspondence.test.mjs
node scripts/ci/lint-baseline.mjs "$BASE_SHA"
node scripts/ci/tooling/node_modules/tsx/dist/cli.mjs scripts/maintenance-rules.test.ts
node scripts/bookings-actions.test.mjs
node scripts/closeout-readiness.test.mjs
node scripts/closeout-readiness-ui.test.mjs
node scripts/safe-vehicle-release/ui.test.mjs
# Missing mileage tests are a failure, never a successful skip. PR #42 supplies them.
test -f scripts/mileage-correction/parity.test.mjs
test -f scripts/mileage-correction/package.test.mjs
node scripts/mileage-correction/parity.test.mjs
node scripts/mileage-correction/package.test.mjs
