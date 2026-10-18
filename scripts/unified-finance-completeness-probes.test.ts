import { describe, it, expect } from 'vitest';
import { readFinancePages } from '../src/lib/unified-finance-readers.server';
import { buildMockUnifiedFinanceReport } from '../src/lib/unified-finance-report.server';
import { adaptFinanceSnapshots } from '../src/lib/unified-finance-adapters';
import { FINANCE_SOURCES, type FinanceSnapshots, type FinanceSourceRow } from '../src/lib/unified-finance-contract';
import { sourceRow, mockPlan, request } from './fixtures/unified-finance-phase2';
import { charge, scope } from './fixtures/unified-finance-live-readers';
import { mapFinanceSource } from '../src/lib/unified-finance-live-mapping';
import { reconcileFinance } from '../src/lib/unified-finance-reconciliation';
import { summarizeFinance } from '../src/lib/unified-finance';

const unknown = () => ({ ...sourceRow(), visibility: 'unverified' } as unknown as FinanceSourceRow);
function refund(account = scope.account) {
  return mapFinanceSource('stripe', charge({ id: 'synthetic-refund', kind: 'refund', object: 'refund', amountCents: 5000,
    parentChargeId: 'synthetic-charge', identities: [{ provider: 'stripe', ...scope, account, object: 'refund', id: 'synthetic-refund' }] }), { ...scope, account });
}
describe('Preserved independent completeness probes', () => {
  it.each(['owner', 'manager'] as const)('D1 rejects unknown normalized visibility for %s', async tier => {
    const snapshot = await readFinancePages(async () => ({ rows: [unknown()], nextCursor: null }), tier);
    expect(snapshot.rows).toEqual([]); expect(snapshot.coverage.state).toBe('incomplete');
    const report = await buildMockUnifiedFinanceReport(request, { userId: 'synthetic-staff', roles: [tier === 'owner' ? 'admin' : 'team'] }, mockPlan({ stripe: [unknown()] }));
    expect(report.complete).toBe(false); expect(report.verifiedCollections.grossCollected.value).toBeNull();
    expect(JSON.stringify(report)).not.toContain('35000');
  });
  it.each(['owner', 'manager'] as const)('D1 direct adapter cannot bypass classification for %s', tier => {
    const snapshots = Object.fromEntries(FINANCE_SOURCES.map(source => [source, { rows: source === 'stripe' ? [unknown()] : [], coverage: { state: 'complete', reasons: [], pages: 1 } }])) as FinanceSnapshots;
    const result = adaptFinanceSnapshots(snapshots, request, tier);
    expect(result.complete).toBe(false); expect(result.verified).toEqual([]);
  });
  it('D1 preserves known owner exclusion and verified empty coverage', async () => {
    const report = await buildMockUnifiedFinanceReport(request, { userId: 'synthetic-manager', roles: ['team'] }, mockPlan({ stripe: [sourceRow({ visibility: 'owner_only' })] }));
    expect(report.complete).toBe(true); expect(report.verifiedCollections.grossCollected.value).toBe(0);
  });
  it('D2 resolves refund parent by scoped Charge identity despite a different normalized row ID', () => {
    const parent = mapFinanceSource('stripe', charge({ id: 'synthetic-normalized-row' }), scope), child = refund();
    expect(parent.reasons).toEqual([]); expect(child.reasons).toEqual([]);
    const reconciled = reconcileFinance([parent.row!.representation!, child.row!.representation!]);
    expect(reconciled.complete).toBe(true);
    const report = summarizeFinance({ events: reconciled.events, ...request, coverage: 'complete' });
    expect(report.grossCollected.value).toBe(35000); expect(report.refunds.value).toBe(5000);
    expect(report.netCollections.value).toBe(28955);
  });
  it('D2 refuses a same-ID parent in another account even when the raw event ID matches', () => {
    const parent = mapFinanceSource('stripe', charge(), scope), child = refund('synthetic-other-account');
    const result = reconcileFinance([parent.row!.representation!, child.row!.representation!]);
    expect(result.complete).toBe(false); expect(result.events.some(e => e.kind === 'refund')).toBe(false);
  });
});

function snapshotsFor(rows: FinanceSourceRow[]): FinanceSnapshots {
  return Object.fromEntries(FINANCE_SOURCES.map(source => [source, {
    rows: source === 'stripe' ? rows : [], coverage: { state: 'complete', reasons: [], pages: 1 },
  }])) as FinanceSnapshots;
}
const withheld = (count: number, visibility = 'unverified') => Array.from({ length: count }, (_, i) => ({
  ...sourceRow(), id: `restricted-row-${i}`, visibility,
  representation: { ...sourceRow().representation!, event: {
    ...sourceRow().representation!.event, amountCents: 70000 + i,
    customerId: `restricted-customer-${i}`, vehicleId: `restricted-vehicle-${i}`,
  } },
} as FinanceSourceRow));

describe('D1 full-result cardinality privacy', () => {
  it.each(['owner', 'manager'] as const)('%s adapter result is identical for one or many unknown rows', tier => {
    const one = adaptFinanceSnapshots(snapshotsFor(withheld(1)), request, tier);
    const many = adaptFinanceSnapshots(snapshotsFor(withheld(7)), request, tier);
    expect(many).toEqual(one);
    expect(one.issues).toEqual(['Unknown source visibility']);
    expect(one.complete).toBe(false); expect(one.verified).toEqual([]);
    expect(JSON.stringify(one)).not.toContain('restricted-');
  });
  it.each(['owner', 'manager'] as const)('%s complete report with withheld rows stays null and count invariant', async tier => {
    const identity = { userId: 'synthetic-staff', roles: [tier === 'owner' ? 'admin' : 'team'] };
    const one = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: withheld(1) }));
    const many = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: withheld(7) }));
    expect(many).toEqual(one); expect(one.complete).toBe(false);
    expect(one.sources.stripe.state).toBe('incomplete');
    expect(one.verifiedCollections.grossCollected.value).toBeNull();
    expect(one.verifiedCollections.netCollections.value).toBeNull();
  });
  it.each(['owner', 'manager'] as const)('%s mixed adapter result preserves authorized facts without leaking withheld counts', tier => {
    const one = adaptFinanceSnapshots(snapshotsFor([sourceRow(), ...withheld(1)]), request, tier);
    const many = adaptFinanceSnapshots(snapshotsFor([sourceRow(), ...withheld(7)]), request, tier);
    expect(many).toEqual(one); expect(one.complete).toBe(false);
    expect(one.verified).toHaveLength(1); expect(one.verified[0].event.amountCents).toBe(35000);
    const report = summarizeFinance({ events: reconcileFinance(one.verified).events, ...request, coverage: 'incomplete' });
    expect(report.grossCollected.value).toBeNull();
  });
  it('Manager complete results cannot distinguish zero, one or many known Owner-only rows', async () => {
    const identity = { userId: 'synthetic-manager', roles: ['team'] };
    for (const authorized of [[], [sourceRow()]]) {
      const expected = await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: authorized }));
      const expectedAdapter = adaptFinanceSnapshots(snapshotsFor(authorized), request, 'manager');
      for (const n of [1, 7]) {
        const rows = [...authorized, ...withheld(n, 'owner_only')];
        expect(await buildMockUnifiedFinanceReport(request, identity, mockPlan({ stripe: rows }))).toEqual(expected);
        expect(adaptFinanceSnapshots(snapshotsFor(rows), request, 'manager')).toEqual(expectedAdapter);
      }
    }
  });
  it('authorized collection totals remain unchanged', async () => {
    const r = await buildMockUnifiedFinanceReport(request, { userId: 'synthetic-owner', roles: ['admin'] }, mockPlan({ stripe: [sourceRow()] }));
    expect(r.complete).toBe(true); expect(r.verifiedCollections.grossCollected.value).toBe(35000);
    expect(r.verifiedCollections.processingFees.value).toBe(1045);
    expect(r.verifiedCollections.netCollections.value).toBe(33955);
  });
});
