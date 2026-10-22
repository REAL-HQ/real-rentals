import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertStripeCiResults, assertStripeRelease } from './static-check.mjs';

const root = new URL('../../../', import.meta.url);
const realRead = p => fs.readFileSync(new URL(p, root), 'utf8');

test('current tree matches the RC15 Stripe flag model', () => {
  const result = assertStripeRelease(realRead);
  assert.equal(result.stripeCalls.length, 7);
  assert.ok(result.messages.includes('collections release flag enabled'));
  assert.ok(result.messages.includes('STRIPE_RISK_MONITOR_ENABLED refused before auth'));
});

test('a Stripe write through a non-read-only client still fails', () => {
  const read = p => {
    const text = realRead(p);
    if (p !== 'src/lib/stripe-collections.server.ts') return text;
    return text.replace(
      'const stripe = createReadOnlyStripe(environment);',
      'const stripe = createStripeClient(environment);\n  await stripe.customers.create({});',
    );
  };
  assert.throws(() => assertStripeRelease(read), /exact seven Stripe list\/retrieve call sites/);
});

test('a read-only collections loader swapped for createStripeClient still fails', () => {
  const read = p => {
    const text = realRead(p);
    if (p !== 'src/lib/stripe-collections.server.ts') return text;
    return text.replace('createReadOnlyStripe(environment)', 'createStripeClient(environment)');
  };
  assert.throws(() => assertStripeRelease(read), /stripe-collections\.server\.ts uses the read-only Stripe client/);
});

test('a dark Stripe flag set true still fails', () => {
  const read = p => {
    const text = realRead(p);
    if (p !== 'src/lib/stripe-risk-monitor-flag.ts') return text;
    return text.replace(
      'export const STRIPE_RISK_MONITOR_ENABLED = false;',
      'export const STRIPE_RISK_MONITOR_ENABLED = true;',
    );
  };
  assert.throws(() => assertStripeRelease(read), /STRIPE_RISK_MONITOR_ENABLED dark flag false/);
});

function passedSuite(name, count) {
  return {
    name: '/repo/scripts/' + name,
    status: 'passed',
    assertionResults: Array.from({ length: count }, (_, i) => ({ fullName: name + ' ' + i, status: 'passed' })),
  };
}

function resultsFrom(suites) {
  const assertions = suites.flatMap(suite => suite.assertionResults);
  const failed = assertions.filter(t => t.status === 'failed').length;
  const pending = assertions.filter(t => t.status === 'pending' || t.status === 'skipped').length;
  const todo = assertions.filter(t => t.status === 'todo').length;
  const passed = assertions.filter(t => t.status === 'passed').length;
  return {
    success: failed === 0 && pending === 0 && todo === 0 && suites.every(suite => suite.status !== 'failed'),
    numTotalTests: assertions.length,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
    testResults: suites,
  };
}

function requiredSuites() {
  return [
    passedSuite('stripe-collections.test.ts', 29),
    passedSuite('stripe-collections-server.test.ts', 30),
    passedSuite('stripe-collections-auth.test.ts', 8),
  ];
}

test('the original 67 tests are a required subset and a passing extra suite is allowed', () => {
  const extra = passedSuite('stripe-collections-recovery.test.ts', 12);
  const messages = assertStripeCiResults(resultsFrom([...requiredSuites(), extra]));
  assert.ok(messages.includes('all 67 required tests executed without skip/todo'));
  assert.ok(messages.includes('stripe-collections.test.ts required test coverage'));
  assert.ok(messages.includes('no failed, skipped, or todo Stripe test in stripe-collections-recovery.test.ts'));
});

test('a failed test in an extra suite still fails', () => {
  const extra = passedSuite('stripe-collections-revenue.test.ts', 4);
  extra.status = 'failed';
  extra.assertionResults[0].status = 'failed';
  assert.throws(() => assertStripeCiResults(resultsFrom([...requiredSuites(), extra])), /no failed, skipped, or todo Stripe test in stripe-collections-revenue\.test\.ts/);
});

test('one added passing test in a required file still covers the original subset', () => {
  const suites = requiredSuites();
  suites[1] = passedSuite('stripe-collections-server.test.ts', 31);
  const messages = assertStripeCiResults(resultsFrom(suites));
  assert.ok(messages.includes('all 67 required tests executed without skip/todo'));
  assert.ok(messages.includes('stripe-collections-server.test.ts required test coverage'));
});

test('a short required file still fails', () => {
  const suites = requiredSuites();
  suites[0] = passedSuite('stripe-collections.test.ts', 28);
  assert.throws(() => assertStripeCiResults(resultsFrom(suites)), /stripe-collections\.test\.ts required test coverage/);
});

test('a skipped or todo result still fails', () => {
  const extra = passedSuite('stripe-collections-paid-row.test.ts', 2);
  extra.assertionResults[1].status = 'todo';
  assert.throws(() => assertStripeCiResults(resultsFrom([...requiredSuites(), extra])), /no failed, skipped, or todo Stripe test in stripe-collections-paid-row\.test\.ts/);
});
