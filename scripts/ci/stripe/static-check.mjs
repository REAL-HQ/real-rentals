import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const repoRoot = new URL('../../../', import.meta.url);

/** Source assertions for the RC15 Stripe flag model. Artifact checks stay in the CLI. */
export function assertStripeRelease(read) {
  const messages = [];
  const check = (v, m) => { assert.ok(v, m); messages.push(m); };
  const source = read('src/lib/stripe-collections.server.ts');
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
  const calls = [];
  const visit = n => {
    if (ts.isCallExpression(n)) {
      const e = n.expression.getText(ast);
      if (e.startsWith('stripe.')) calls.push(e);
    }
    ts.forEachChild(n, visit);
  };
  visit(ast);
  const allowed = ['stripe.subscriptions.list', 'stripe.invoices.list', 'stripe.invoicePayments.list', 'stripe.charges.list', 'stripe.charges.retrieve', 'stripe.refunds.list', 'stripe.payouts.list'];
  check(calls.length === 7 && calls.every(c => allowed.includes(c)), 'exact seven Stripe list/retrieve call sites');
  for (const f of ['src/lib/stripe-collections.server.ts', 'src/lib/stripe-collections.functions.ts']) {
    check(!/\.(insert|update|upsert|delete|rpc|create|capture|cancel|refund)\s*\(/.test(read(f)), f + ' contains no mutation/RPC calls');
  }
  const fn = read('src/lib/stripe-collections.functions.ts');
  check(fn.includes('.middleware([requireSupabaseAuth])') && fn.includes('.eq("user_id", context.userId)'), 'authenticated identity scopes current role lookup');
  check(fn.indexOf('assertCollectionsAccess(roles.map') < fn.indexOf('await loadStripeCollections'), 'authorization before Stripe loader');
  check(/^export const STRIPE_COLLECTIONS_ENABLED = true;$/m.test(read('src/lib/stripe-collections.ts')), 'collections release flag enabled');
  const gate = fn.indexOf('if (!STRIPE_COLLECTIONS_ENABLED)');
  const disabledReturn = fn.indexOf('return { error: "Stripe reporting is disabled" }');
  const load = fn.indexOf('await loadStripeCollections');
  check(gate > -1 && disabledReturn > gate && disabledReturn < load && fn.includes('import.meta.env.DEV && STRIPE_COLLECTIONS_TEST_MODE'), 'server disabled gate');
  check(read('src/lib/stripe-collections.test-mode.ts').includes('export const STRIPE_COLLECTIONS_TEST_MODE = false;'), 'collections test mode off');
  const ui = read('src/components/admin/StripeCollections.tsx');
  check(ui.includes('const featureVisible = STRIPE_COLLECTIONS_ENABLED || (import.meta.env.DEV && STRIPE_COLLECTIONS_TEST_MODE);'), 'collections visibility follows the release flag');
  check(ui.includes('stripeCollectionsQuery(load, environment, from, to, featureVisible)') && ui.includes('if (!featureVisible) return null'), 'hidden collections render no refresh control');
  check(read('src/lib/stripe-collections-query.ts').includes('enabled: enabled && request !== null'), 'disabled component neither auto-fetches nor renders refresh control');
  const readers = [
    'src/lib/stripe-collections.server.ts',
    'src/lib/stripe-match-read.server.ts',
    'src/lib/stripe-risk-monitor-read.server.ts',
    'src/lib/stripe-payout-recon-read.server.ts',
  ];
  for (const f of readers) {
    const text = read(f);
    check(text.includes('createReadOnlyStripe(') && !text.includes('createStripeClient('), f + ' uses the read-only Stripe client');
  }
  const dark = [
    ['src/lib/stripe-match-flag.ts', 'src/lib/stripe-match.functions.ts', 'STRIPE_MATCH_REPORT_ENABLED', 'if (!STRIPE_MATCH_REPORT_ENABLED)', 'from("user_roles")', 'readLiveStripeMatch('],
    ['src/lib/stripe-risk-monitor-flag.ts', 'src/lib/stripe-risk-monitor.functions.ts', 'STRIPE_RISK_MONITOR_ENABLED', 'if (!STRIPE_RISK_MONITOR_ENABLED)', 'requireManager(', 'readLiveStripeRisk('],
    ['src/lib/stripe-payout-recon-flag.ts', 'src/lib/stripe-payout-recon.functions.ts', 'STRIPE_PAYOUT_RECON_ENABLED', 'if (!STRIPE_PAYOUT_RECON_ENABLED)', 'requireManager(', 'readLivePayoutRecon('],
  ];
  for (const [flagFile, fnFile, name, refusal, auth, stripe] of dark) {
    check(read(flagFile).includes(`export const ${name} = false;`), name + ' dark flag false');
    const body = read(fnFile);
    const handler = body.slice(body.indexOf('.handler'));
    const flagAt = handler.indexOf(refusal);
    const authAt = handler.indexOf(auth);
    const stripeAt = handler.indexOf(stripe);
    check(body.includes('.middleware([requireSupabaseAuth])') && flagAt > -1 && authAt > flagAt && stripeAt > flagAt, name + ' refused before auth');
  }
  return { messages, stripeCalls: calls };
}

function main() {
  const read = p => fs.readFileSync(new URL(p, repoRoot), 'utf8');
  let checks = 0;
  const check = (v, m) => { assert.ok(v, m); checks++; console.log('PASS ' + m); };
  const release = assertStripeRelease(read);
  for (const message of release.messages) check(true, message);
  const assets = new URL('.output/public/assets/', repoRoot);
  if (!fs.existsSync(assets)) {
    console.error('run the build first');
    process.exit(1);
  }
  const files = fs.readdirSync(assets).filter(f => f.endsWith('.js'));
  check(files.length > 0, 'actual client bundles exist');
  const bundles = files.map(f => fs.readFileSync(new URL(f, assets), 'utf8')).join('\n');
  for (const key of ['STRIPE_LIVE_API_KEY', 'STRIPE_SANDBOX_API_KEY', 'LOVABLE_API_KEY', 'X-Connection-Api-Key', 'connector-gateway.lovable.dev/stripe', 'loadStripeCollections']) {
    check(!bundles.includes(key), 'no server identifier in browser: ' + key);
  }
  check(!/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}/.test(bundles), 'no Stripe secret-key-shaped literal in browser');
  console.log(JSON.stringify({ passed: checks, failed: 0, stripeCalls: release.stripeCalls }));
  const results = JSON.parse(read('.stripe-ci-results.json'));
  check(results.success === true && results.numTotalTests === 67 && results.numPassedTests === 67 && results.numFailedTests === 0 && results.numPendingTests === 0 && (results.numTodoTests ?? 0) === 0, 'all 67 required tests executed without skip/todo');
  for (const [name, count] of [['stripe-collections.test.ts', 29], ['stripe-collections-server.test.ts', 30], ['stripe-collections-auth.test.ts', 8]]) {
    const suites = results.testResults.filter(t => t.name.endsWith('/' + name));
    check(suites.length === 1 && suites[0].assertionResults.length === count && suites[0].assertionResults.every(t => t.status === 'passed'), name + ' exact test coverage');
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invoked === import.meta.url) main();
