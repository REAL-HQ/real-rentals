import { tierAllows, type StaffTier } from "./roles";
import { OWNER_FINANCE_SNAPSHOT_OFF } from "./owner-finance-snapshot-flag";
import { collectionSummary } from "./revenue-report";
import { lastFullWeek, weekBounds, type RentWeek } from "./rent-reconciliation";
import type { RentReconciliationResponse } from "./rent-reconciliation.server";
import {
  buildOwnerFinanceSnapshot,
  reconciliationExceptionCount,
  type OwnerFinanceSnapshotReport,
} from "./owner-finance-snapshot";

/**
 * Owners only. The flag is checked here again so a direct call still throws
 * before any read. This file does not query or call Stripe. The caller passes
 * the existing collections read and the existing reconciliation runner.
 */

export type OwnerFinanceSnapshotResponse = { status: "ready"; report: OwnerFinanceSnapshotReport };

export async function runOwnerFinanceSnapshot(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  weekStart: string | null;
  rentCollected: (week: RentWeek) => Promise<number>;
  reconciliation: (week: RentWeek) => Promise<RentReconciliationResponse>;
}): Promise<OwnerFinanceSnapshotResponse> {
  if (!input.enabled) throw new Error(OWNER_FINANCE_SNAPSHOT_OFF);
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const week = input.weekStart ? weekBounds(input.weekStart) : lastFullWeek(input.now);
  if (!week) return { status: "ready", report: buildOwnerFinanceSnapshot({ week: null, rentCollectedCents: null, exceptionCount: null }) };
  const [rentCollectedCents, reconciliation] = await Promise.all([
    capture(() => input.rentCollected(week)),
    capture(() => input.reconciliation(week)),
  ]);
  const exceptionCount = reconciliation?.status === "ready" ? reconciliationExceptionCount(reconciliation.report) : null;
  return { status: "ready", report: buildOwnerFinanceSnapshot({ week, rentCollectedCents, exceptionCount }) };
}

/** Collections revenue for paid_date inside the week. Deposits stay in collectionSummary's deposit total. */
export function rentCollectedCents(rows: readonly Record<string, unknown>[], week: { from: string; through: string }): number {
  const inWeek = rows.filter((row) => {
    const paid = dateOnly(row.paid_date);
    return paid !== null && paid >= week.from && paid <= week.through;
  });
  const summary = collectionSummary(inWeek);
  const cents = Math.round(Number(summary.revenue.toFixed(2)) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid collection record");
  return cents;
}

async function capture<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}
