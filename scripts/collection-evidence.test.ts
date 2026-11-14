import { describe, expect, it } from "vitest";
import { attestationInput, evidenceTone, projectCollectionEvidence, proposeEvidenceEvent } from "../src/lib/checklist-evidence";
const app = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const doc = { applicationId: app, id: "saved-file", category: "insurance", is_current: true, review_status: "uploaded", storage_path: "private/fixture" };
const event = proposeEvidenceEvent({ applicationId: app, field: "insurance", expectedRevision: 0, idempotencyKey: app, state: "collected", source: "text", note: "Received by text" }, [], { id: "event", actorId: other, occurredAt: "2026-11-09T00:00:00Z" });
const base = { applicationId: app, field: "insurance" as const, events: [event], documents: [], itemComplete: false, reviewRequired: true };
describe("File collection separate from verification", () => {
  it("accepts Text receipt and keeps it Yellow until uploaded", () => {
    expect(attestationInput.safeParse({ applicationId: app, field: "insurance", expectedRevision: 0, idempotencyKey: app, state: "collected", source: "text", note: "Received by text" }).success).toBe(true);
    expect(projectCollectionEvidence(base)).toMatchObject({ tone: "yellow", status: "upload_due", complete: false, followUpOpen: true });
  });
  it("Green Insurance means on file, never verified", () => expect(projectCollectionEvidence({ ...base, documents: [doc] })).toMatchObject({ tone: "green", uploaded: true, complete: false, followUpOpen: false }));
  it("wrong renter, rejected, superseded or unsaved file cannot turn Green", () => {
    for (const bad of [{ ...doc, applicationId: other }, { ...doc, review_status: "rejected" }, { ...doc, is_current: false }, { ...doc, storage_path: null }]) expect(projectCollectionEvidence({ ...base, documents: [bad] }).tone).toBe("yellow");
  });
  it("license needs both saved sides for Green", () => {
    const front = projectCollectionEvidence({ ...base, field: "license_front", events: [], documents: [{ ...doc, category: "license_front" }] });
    const back = projectCollectionEvidence({ ...base, field: "license_back", events: [], documents: [{ ...doc, category: "license_front" }] });
    expect(front.tone).toBe("green"); expect(evidenceTone([front, back])).toBe("red");
  });
  it("unsigned agreement upload cannot complete Agreement", () => expect(projectCollectionEvidence({ ...base, field: "agreement", events: [], documents: [{ ...doc, category: "agreement" }] })).toMatchObject({ tone: "yellow", complete: false }));
  it("Not Collected stays Red and keeps follow-up open", () => {
    const correction = proposeEvidenceEvent({ applicationId: app, field: "insurance", expectedRevision: 1, idempotencyKey: other, state: "not_collected", source: null, note: "Wrong file received" }, [event], { id: "correction", actorId: other, occurredAt: "2026-11-09T00:01:00Z" });
    expect(projectCollectionEvidence({ ...base, events: [event, correction] })).toMatchObject({ tone: "red", status: "not_collected", followUpOpen: true });
  });
});