import { describe, expect, it } from "vitest";
import { documentCollection, proposeEvidenceEvent, type EvidenceEvent } from "../src/lib/checklist-evidence";
import { driverLifecycle } from "../src/lib/driver-lifecycle";

const applicationId = "11111111-1111-4111-8111-111111111111";
const categories = ["license_front", "license_back", "insurance", "gig_profile"] as const;
const documents = categories.map((category) => ({
  applicationId, id: category, category, is_current: true, review_status: "uploaded",
  storage_path: `synthetic/${category}`,
}));
const project = (events: EvidenceEvent[] = [], docs = documents) => documentCollection({ applicationId, events, documents: docs });
const attest = () => categories.map((field) => proposeEvidenceEvent({
  applicationId, field, expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
  state: "collected", source: "other", note: "",
}, [], { id: field, actorId: applicationId, occurredAt: "2026-11-09T05:42:00Z" }));

describe("Documents receipt", () => {
  it("automatically turns Green only when all four required files exist, even before review", () => {
    expect(project()).toMatchObject({ tone: "green", uploaded: true, collected: true });
    expect(project([], documents.slice(0, 3))).toMatchObject({ tone: "red", uploaded: false, collected: false });
    expect(project().fields.every((field) => field.complete === false)).toBe(true);
  });
  it("staff confirmation without files is Yellow and survives projecting saved history again", () => {
    const saved = attest();
    expect(project(saved, [])).toMatchObject({ tone: "yellow", uploaded: false, collected: true });
    expect(project(JSON.parse(JSON.stringify(saved)), []).tone).toBe("yellow");
  });
  it("matching uploads resolve Yellow to Green without more confirmation", () => {
    expect(project(attest(), documents.slice(0, 2))).toMatchObject({ tone: "yellow", uploaded: false, collected: true });
    expect(project(attest())).toMatchObject({ tone: "green", uploaded: true });
  });
  it("rejected, replaced, missing-path and another applicant's files do not count", () => {
    for (const patch of [{ review_status: "rejected" }, { is_current: false }, { storage_path: "" }, { applicationId: "22222222-2222-4222-8222-222222222222" }]) {
      expect(project([], documents.map((doc, i) => i === 0 ? { ...doc, ...patch } : doc)).uploaded).toBe(false);
    }
  });
  it("a Not Collected correction stays Red without hiding actual files", () => {
    const events = attest();
    events.push(proposeEvidenceEvent({ applicationId, field: "gig_profile", expectedRevision: 1, idempotencyKey: crypto.randomUUID(), state: "not_collected", source: null, note: "" }, events,
      { id: "correction", actorId: applicationId, occurredAt: "2026-11-09T05:43:00Z" }));
    expect(project(events)).toMatchObject({ tone: "red", uploaded: true, collected: false });
  });
  it("document receipt does not complete screening, approval, inspection, agreement or Active", () => {
    const life = driverLifecycle({ contacted: true, documentsReceived: true, screening: false, documents: false, profile: false, approved: false, inspection: false, agreement: false, rentalActive: false });
    expect(life.stages.find((stage) => stage.key === "documents")?.state).toBe("done");
    for (const key of ["screening", "approved", "inspection", "agreement", "active"]) expect(life.stages.find((stage) => stage.key === key)?.state).not.toBe("done");
  });
});