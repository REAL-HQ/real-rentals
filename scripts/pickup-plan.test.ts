import { describe, expect, it } from "vitest";
import { handoffEvidenceIssues, pickupPacket, pickupPlanInput, proposePickupPlan, PICKUP_HANDOFF_ENABLED, PICKUP_PACKET_ENABLED, PICKUP_PLAN_ENABLED } from "../src/lib/pickup-plan";
const app = "11111111-1111-4111-8111-111111111111", car = "22222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333";
const input = { applicationId: app, expectedRevision: 0, idempotencyKey: app, vehicleId: car, appointmentAt: "2026-11-10T15:00:00Z", timeZone: "America/New_York", location: "Invented fixture pickup location", reason: "Confirmed appointment with renter" };
const plan = proposePickupPlan(input, null, { actorId: other, confirmedAt: "2026-11-09T00:00:00Z" });
const packet = { applicationId: app, plan, vehicle: { id: car, label: "Invented Fixture Car", vin: "1HGCM82633A004352", plate: "TEST123", registration: "Fixture registration on file" }, portalUrl: "https://drivereal.com/portal", agreementUrl: "https://drivereal.com/portal?tab=documents", paymentUrl: "https://drivereal.com/portal?pay=balance", photoPackageUrl: null };
const evidence = { applicationId: app, plan, expectedPlanRevision: 1, finalVehicleId: car, signedAgreement: { applicationId: app, vehicleId: car, signed: true, voided: false }, payment: { applicationId: app, vehicleId: car, obligationId: other, status: "paid", netCollectedCents: 35000, requiredCents: 35000, kind: "rent" as const } };
describe("Isolated pickup contract", () => {
  it("keeps every live capability disabled", () => expect([PICKUP_PLAN_ENABLED, PICKUP_PACKET_ENABLED, PICKUP_HANDOFF_ENABLED]).toEqual([false, false, false]));
  it("requires a confirmed timestamp, valid timezone/location and no injected actor", () => {
    for (const bad of [{ ...input, appointmentAt: "2026-11-10" }, { ...input, timeZone: "Invalid/Zone" }, { ...input, location: "" }, { ...input, actorId: other }]) expect(pickupPlanInput.safeParse(bad).success).toBe(false);
  });
  it("refuses stale revision and another renter's plan", () => {
    expect(() => proposePickupPlan(input, plan, { actorId: other, confirmedAt: "2026-11-09T00:00:00Z" })).toThrow("Changed");
    expect(() => proposePickupPlan({ ...input, applicationId: other, expectedRevision: 1 }, plan, { actorId: other, confirmedAt: "2026-11-09T00:00:00Z" })).toThrow("Another");
  });
  it("does not turn a requested date or missing facts into a sendable snapshot", () => {
    expect(pickupPacket({ ...packet, plan: null }).packet).toBeNull();
    for (const field of ["vin", "plate", "registration"] as const) expect(pickupPacket({ ...packet, vehicle: { ...packet.vehicle, [field]: null } }).packet).toBeNull();
    expect(pickupPacket({ ...packet, vehicle: { ...packet.vehicle, id: other } }).packet).toBeNull();
  });
  it("refuses local, preview, external, credentialed or insecure links", () => {
    for (const url of ["http://localhost:8080/portal", "https://preview.lovable.app/portal", "https://evil.example/portal", "http://drivereal.com/portal", "https://password@drivereal.com/portal"]) expect(pickupPacket({ ...packet, portalUrl: url }).packet).toBeNull();
  });
  it("allows a copied reviewed snapshot without mutating the saved fixture", () => {
    const p = pickupPacket(packet).packet; expect(p?.planRevision).toBe(1); expect(p?.vehicle.vin).toBe("1HGCM82633A004352");
    if (p) p.vehicle.label = "Changed copy";
    expect(packet.vehicle.label).toBe("Invented Fixture Car");
  });
  it("accepts scoped actual payment and signature only in a mock diagnostic", () => expect(handoffEvidenceIssues(evidence)).toEqual([]));
  it("refuses wrong, voided, unsigned or old-vehicle agreements", () => {
    for (const agreement of [null, { ...evidence.signedAgreement, applicationId: other }, { ...evidence.signedAgreement, vehicleId: other }, { ...evidence.signedAgreement, signed: false }, { ...evidence.signedAgreement, voided: true }]) expect(handoffEvidenceIssues({ ...evidence, signedAgreement: agreement })).toContain("Signed Agreement For Final Vehicle Required");
  });
  it("refuses held-deposit-only, unrelated, incomplete, failed and refunded payments", () => {
    for (const payment of [null, { ...evidence.payment, kind: "deposit" as const }, { ...evidence.payment, applicationId: other }, { ...evidence.payment, vehicleId: other }, { ...evidence.payment, obligationId: null }, { ...evidence.payment, status: "pending" }, { ...evidence.payment, status: "refunded" }, { ...evidence.payment, netCollectedCents: 34999 }, { ...evidence.payment, netCollectedCents: null }]) expect(handoffEvidenceIssues({ ...evidence, payment })).toContain("Verified Applicable Payment Required");
  });
  it("rechecks final car and plan version", () => {
    expect(handoffEvidenceIssues({ ...evidence, expectedPlanRevision: 0 })).toContain("Pickup Plan Changed");
    expect(handoffEvidenceIssues({ ...evidence, finalVehicleId: other })).toContain("Pickup Plan Changed");
  });
});