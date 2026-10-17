import { describe, it, expect } from "vitest";
import { LIVE_RENTAL_RELEASE, createRequestGate } from "../src/lib/live-rental-release";
import { readCollectedRevenue } from "../src/lib/collected-revenue";
import { formatRecordNumber } from "../src/lib/record-numbers";
import { evaluateIntake } from "../src/lib/rental-intake";
import { isRetainedAgreement } from "../src/lib/agreement-retention";

describe("Agreement retention", () => {
  it.each([{ category: "agreement" }, { kind: "agreement" }, { storage_bucket: "rental-agreements" }])("protects each original identifier %j", doc =>
    expect(isRetainedAgreement(doc)).toBe(true));
  it("does not classify ordinary license evidence as an agreement", () =>
    expect(isRetainedAgreement({ category: "license_front", kind: "license_front", storage_bucket: "license-uploads" })).toBe(false));
});

describe("Minimum release holds", () => {
  const APPROVED = new Set(["paperAgreements"]); // explicitly approved Oct 17, 2026
  for (const [feature, enabled] of Object.entries(LIVE_RENTAL_RELEASE))
    it(`${feature} is ${APPROVED.has(feature) ? "enabled (approved)" : "disabled"}`, () => expect(enabled).toBe(APPROVED.has(feature)));
  it("does not allocate Customer or Booking numbers", () => {
    expect(formatRecordNumber("customer", undefined)).toBeNull();
    expect(formatRecordNumber("booking", null)).toBeNull();
    expect(formatRecordNumber("customer", 1)).toBe("C-001");
    expect(formatRecordNumber("booking", 1000)).toBe("B-1000");
  });
  it("missing identity fails closed even for Approved", () => {
    const blockers = evaluateIntake({ applicationId: "a", vehicleId: "v", pickupDate: "2026-10-15", pickupMileage: null,
      weeklyRate: 350, depositCollected: 0, stripeCustomerId: null, stripeSubscriptionId: null }, {
      today: "2026-10-17", driver: { id: "a", status: "approved" }, identity: null,
      vehicle: { id: "v", status: "available", archived: false }, rentalReadyMissing: [], activeRentalOnVehicle: false,
      activeRentalForDriver: false, duplicateRental: false, mileageHistoryMax: null, subscription: null,
      stripeChecked: false, stripeLiveBlocked: false, subscriptionLinkedElsewhere: false,
    });
    expect(blockers.map(b => b.code)).toContain("no_driver");
  });
});

describe("Collected reporting", () => {
  it("two verified 350 collections total 700, not projected fees/settlement", () =>
    expect(readCollectedRevenue({ data: [{ net_collected: 350 }, { net_collected: 350 }], error: null })).toBe(700));
  it("unknown or failed reads are not zero", () => {
    expect(readCollectedRevenue({ data: null, error: null })).toBeNull();
    expect(readCollectedRevenue({ data: [], error: "denied" })).toBeNull();
    expect(readCollectedRevenue({ data: [{ net_collected: null }], error: null })).toBeNull();
  });
  it("successful empty reads alone can report zero", () =>
    expect(readCollectedRevenue({ data: [], error: null })).toBe(0));
  it("uses refunded net value without re-subtracting refunds", () =>
    expect(readCollectedRevenue({ data: [{ net_collected: 300 }, { net_collected: 0 }], error: null })).toBe(300));
});

describe("Stale request guard", () => {
  it.each([true, false])("only current deferred completion may update state (old first: %s)", async (oldFirst) => {
    const gate = createRequestGate(); let displayed = ""; let releaseOld: () => void = () => {}; let releaseNew: () => void = () => {};
    const old = gate.begin();
    const first = new Promise<void>(resolve => { releaseOld = resolve; }).then(() => { if (gate.isCurrent(old)) displayed = "old"; });
    const current = gate.begin();
    const second = new Promise<void>(resolve => { releaseNew = resolve; }).then(() => { if (gate.isCurrent(current)) displayed = "current"; });
    if (oldFirst) { releaseOld(); await first; releaseNew(); } else { releaseNew(); await second; releaseOld(); }
    await Promise.all([first, second]); expect(displayed).toBe("current");
  });
  it("close/edit prevents success, error and finalizer", () => {
    const gate = createRequestGate(); const request = gate.begin(); gate.invalidate();
    expect(gate.isCurrent(request)).toBe(false);
  });
});