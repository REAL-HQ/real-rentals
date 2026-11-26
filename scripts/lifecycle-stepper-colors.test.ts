import { describe, expect, it } from "bun:test";
import { documentCollection, type EvidenceEvent } from "../src/lib/checklist-evidence";
import { driverLifecycle, reservationStageDone } from "../src/lib/driver-lifecycle";

const applicationId = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
// What the browser actually receives: the vault list never carries storage_path.
const vaultDocs = [
  { id: "a", category: "license_front", is_current: true, review_status: "verified" },
  { id: "b", category: "gig_profile", is_current: true, review_status: "verified" },
  { id: "c", category: "trip_history", is_current: true, review_status: "verified" },
  { id: "d", category: "license_back", is_current: true, review_status: "verified" },
].map((d) => ({ ...d, applicationId }));
const base = { contacted: true, screening: false, approved: false, inspection: false, agreement: false, rentalActive: false };
const state = (l: ReturnType<typeof driverLifecycle>, k: string) => l.stages.find((s) => s.key === k)?.state;

describe("Documents step", () => {
  it("is received when all required files are on file, without storage_path and without staff check-offs", () => {
    expect(documentCollection({ applicationId, events: [], documents: vaultDocs }).collected).toBe(true);
  });
  it("is not received when a required file is missing, rejected or not current", () => {
    expect(documentCollection({ applicationId, events: [], documents: vaultDocs.slice(0, 2) }).collected).toBe(false);
    const rejected = vaultDocs.map((d) => (d.id === "c" ? { ...d, review_status: "rejected" } : d));
    expect(documentCollection({ applicationId, events: [], documents: rejected }).collected).toBe(false);
    const old = vaultDocs.map((d) => (d.id === "a" ? { ...d, is_current: false } : d));
    expect(documentCollection({ applicationId, events: [], documents: old }).collected).toBe(false);
    expect(documentCollection({ applicationId, events: [] as EvidenceEvent[], documents: [] }).collected).toBe(false);
  });
});

describe("Screening step", () => {
  it("is done once staff or FLEET approved, with no screening files", () => {
    const l = driverLifecycle({ ...base, documentsReceived: true, approved: true });
    expect(state(l, "screening")).toBe("done");
    expect(l.open.map((s) => s.key)).not.toContain("screening");
  });
  it("is not done before approval", () => {
    expect(state(driverLifecycle({ ...base, documentsReceived: true }), "screening")).not.toBe("done");
  });
  it("approval never completes insurance, inspection, pickup or active", () => {
    const l = driverLifecycle({ ...base, documentsReceived: true, approved: true, agreement: true });
    for (const k of ["insurance", "inspection", "pickup", "active"]) expect(state(l, k)).not.toBe("done");
  });
});

describe("Reserved step", () => {
  it("is green only when the fee is paid or the rental is active", () => {
    expect(reservationStageDone({ feeStatus: "paid", hasReservation: false })).toBe(true);
    expect(reservationStageDone({ feeStatus: null, hasReservation: false })).toBe(false);
    expect(reservationStageDone({ feeStatus: "pending", hasReservation: true, feeRequired: true })).toBe(false);
    expect(reservationStageDone({ feeStatus: "unpaid", hasReservation: true })).toBe(false);
    expect(reservationStageDone({ feeStatus: "refunded:insurance_declined", hasReservation: true })).toBe(false);
    expect(reservationStageDone({ feeStatus: null, hasReservation: true, feeRequired: true })).toBe(false);
    expect(reservationStageDone({ feeStatus: null, hasReservation: false, rentalActive: true })).toBe(true);
  });
  it("a staff reservation with no fee required still counts", () => {
    expect(reservationStageDone({ feeStatus: null, hasReservation: true, feeRequired: false })).toBe(true);
    expect(reservationStageDone({ feeStatus: "waived", hasReservation: true })).toBe(true);
  });
  it("Jonathon's record: signed, not yet paid -> Reserved current; paid -> Reserved done, Insurance current", () => {
    const facts = { ...base, documentsReceived: true, approved: true, agreement: true };
    const before = driverLifecycle({ ...facts, reserved: reservationStageDone({ feeStatus: "pending", hasReservation: false }) });
    expect(before.current.key).toBe("reserved");
    expect(["documents", "screening", "approved", "agreement"].map((k) => state(before, k))).toEqual(["done", "done", "done", "done"]);
    expect(before.open).toHaveLength(0);
    const after = driverLifecycle({ ...facts, reserved: reservationStageDone({ feeStatus: "paid", hasReservation: false }) });
    expect(state(after, "reserved")).toBe("done");
    expect(after.current.key).toBe("insurance");
    expect(after.percent).toBeGreaterThan(before.percent);
  });
});
