#!/usr/bin/env bash
set -euo pipefail
node scripts/ci/paper/network-check.mjs
export PATH="$PWD/node_modules/.bin:$PATH"
export npm_config_offline=true
# Existing eSign regression compares a historical security source and origin/main.
# Pin both fixtures so mutable remote branches cannot silently change evidence.
git cat-file -e dff2e494a42daa18260d0fcd97aefcf8fa311b1f^{commit}
git cat-file -e 28b6b773da28afc553c12cdc57397499a11ad745^{commit}
git update-ref refs/remotes/origin/hotfix/security-identity dff2e494a42daa18260d0fcd97aefcf8fa311b1f
git update-ref refs/remotes/origin/main 28b6b773da28afc553c12cdc57397499a11ad745
echo 'BEGIN baseline typecheck'
node node_modules/typescript/bin/tsc --noEmit
echo 'PASS baseline typecheck'
echo 'BEGIN baseline production build'
node node_modules/vite/bin/vite.js build
echo 'PASS baseline production build'
# Capability detection is limited to baseline regressions. Existing tests must run.
for file in scripts/agreement-authorization.test.mjs scripts/agreement-pdf-access.test.mjs scripts/vehicle-doc-permissions.test.mjs scripts/agreement-guard.test.mjs scripts/file-upload-guard.test.mjs; do
  if [ ! -e "$file" ]; then
    echo "NOT AVAILABLE on historical baseline: $file"
    continue
  fi
  test -s "$file"
  echo "BEGIN $file"
  node "$file" 2>&1 | tee /tmp/paper-baseline-test.log
  if grep -Eqi 'SKIPPED|BLOCKER|FAIL' /tmp/paper-baseline-test.log; then
    echo "Regression skipped or failed: $file" >&2; exit 1
  fi
  echo "PASS $file"
done
if [ -e src/lib/paper-release.ts ]; then
  node scripts/ci/paper/disabled-check.mjs
else
  echo 'NOT AVAILABLE on historical baseline: Paper activation/cleanup guards'
fi
# This remains mandatory, even if every available baseline check passed.
missing=0
for file in scripts/paper-contract.test.ts scripts/paper-notes.test.ts scripts/paper-notes-ui.test.ts; do
  if [ ! -s "$file" ]; then
    echo "MISSING REQUIRED PAPER TEST: $file" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then exit 1; fi
# No capability skip here: a complete Paper candidate must include every guard.
node scripts/ci/paper/disabled-check.mjs
bun scripts/paper-contract.test.ts
bun scripts/paper-notes.test.ts
bun scripts/paper-notes-ui.test.ts
node scripts/ci/paper/disabled-check.mjs
