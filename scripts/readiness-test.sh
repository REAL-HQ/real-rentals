#!/usr/bin/env bash
# Transpile the pure modules, then run the assertions against the output.
#
# tsc resolves the "@/lib/..." alias for typechecking but emits it verbatim,
# and Node has no idea what it means, so the one import between the two
# modules is rewritten to a relative path afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .readiness-build .docfn-build
npx tsc -p scripts/readiness-tsconfig.json
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
npx esbuild src/lib/documents.functions.ts --bundle --platform=node --format=esm \
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
