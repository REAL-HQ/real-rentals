#!/usr/bin/env bash
set -euo pipefail
node scripts/ci/finance/network-check.mjs
node scripts/ci/finance/guard.mjs source
node --test scripts/ci/finance/guard.test.mjs
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_offline=true
node -e 'if(require("./scripts/ci/finance/tooling/node_modules/vitest/package.json").version!=="3.2.4")throw Error("Wrong Vitest")'
for package in vitest @vitest; do
  test ! -e "node_modules/$package" && test ! -L "node_modules/$package"
  ln -s "../scripts/ci/finance/tooling/node_modules/$package" "node_modules/$package"
done
node scripts/ci/finance/tooling/node_modules/vitest/vitest.mjs run --config scripts/unified-finance.vitest.config.ts --reporter=json --outputFile=.finance-ci-results.json
node scripts/ci/finance/guard.mjs results .finance-ci-results.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/ci/finance/guard.mjs source
git diff --exit-code -- package.json bun.lock scripts/ci/finance/tooling/package.json scripts/ci/finance/tooling/package-lock.json
