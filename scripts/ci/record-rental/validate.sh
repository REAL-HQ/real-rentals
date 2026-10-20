#!/usr/bin/env bash
set -euo pipefail
node scripts/ci/record-rental/network-check.mjs
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_offline=true
node scripts/ci/record-rental/guard.test.mjs
node scripts/ci/record-rental/guard.mjs --tests
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/ci/record-rental/guard.mjs
