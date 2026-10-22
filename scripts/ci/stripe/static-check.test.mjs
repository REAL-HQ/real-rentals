import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertStripeRelease } from './static-check.mjs';

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
