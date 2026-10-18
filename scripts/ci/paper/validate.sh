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
for file in scripts/paper-contract.test.ts scripts/paper-notes.test.ts scripts/paper-notes-ui.test.ts scripts/agreement-authorization.test.mjs scripts/agreement-pdf-access.test.mjs scripts/vehicle-doc-permissions.test.mjs; do
  test -s "$file"
done
node scripts/ci/paper/disabled-check.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
bun scripts/paper-contract.test.ts
bun scripts/paper-notes.test.ts
bun scripts/paper-notes-ui.test.ts
node scripts/agreement-authorization.test.mjs
node scripts/agreement-pdf-access.test.mjs 2>&1 | tee /tmp/paper-esign-ci.log
if grep -Eqi 'SKIPPED|BLOCKER|FAIL' /tmp/paper-esign-ci.log; then
  echo 'eSign regression skipped or failed' >&2; exit 1
fi
node scripts/vehicle-doc-permissions.test.mjs
# Recheck after tests, including tests which mock enabled flags in memory.
node scripts/ci/paper/disabled-check.mjs
