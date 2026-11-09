import { describe, expect, it } from "vitest";
import { assessEvidenceException, attestationInput, CHECKLIST_EVIDENCE_ENABLED, evidenceTone, latestEvidenceEvent, projectEvidence, proposeEvidenceEvent, requirementEvidence, type EvidenceEvent } from "../src/lib/checklist-evidence";
import { decideActivation, driverRequirementBlockers, activationRequirements, type DriverReadinessFacts } from "../src/lib/activation-readiness";

const app = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const input = { applicationId: app, field: "license_front" as const, expectedRevision: 0, idempotencyKey: app, state: "collected" as const, source: "email" as const, note: "Received by email" };
const first = proposeEvidenceEvent(input, [], { id: "event1", actorId: other, occurredAt: "2026-11-09T00:00:00Z" });
const corrected = proposeEvidenceEvent({ ...input, expectedRevision: 1, idempotencyKey: other, state: "not_collected", source: null, note: "Wrong file received" }, [first], { id: "event2", actorId: other, occurredAt: "2026-11-09T00:01:00Z" });
const project = (events: EvidenceEvent[] = [first], documents: Parameters<typeof projectEvidence>[0]["documents"] = [], more: Partial<Parameters<typeof projectEvidence>[0]> = {}) => projectEvidence({ applicationId: app, field: "license_front", events, documents, itemComplete: false, ...more });
const doc = { id: "file", category: "license_front", is_current: true, review_status: "uploaded", storage_path: "private/file" };
const yellow = project(), red = project([first, corrected]);
const exception = { tier: "manager" as const, support: { storageReady: true, atomicActivationReady: true }, items: [yellow, { ...red, field: "license_back" as const }], selectedFields: ["license_front" as const, "license_back" as const], reason: "Manager accepts temporary evidence gaps", separateBlockers: [] };

describe("Confirmed evidence states (isolated rules only)", () => {
  it("checked with no upload remains yellow with an upload follow-up and no verified completion", () => {
    expect(yellow.tone).toBe("yellow"); expect(yellow.status).toBe("upload_due"); expect(yellow.followUpOpen).toBe(true); expect(yellow.complete).toBe(false); expect(yellow.uploaded).toBe(false);
  });
  it("explicit Not Collected changes yellow to red without editing the previous event", () => {
    expect(red.tone).toBe("red"); expect(red.status).toBe("not_collected"); expect(red.collected).toBe(false); expect(red.followUpOpen).toBe(true);
    expect(first.state).toBe("collected"); expect(corrected.supersedesId).toBe(first.id); expect(corrected.revision).toBe(2);
  });
  it("only a saved current matching file resolves the upload follow-up", () => {
    expect(project([first], [{ ...doc, category: "license_back" }]).tone).toBe("yellow");
    for (const file of [{ ...doc, review_status: "rejected" }, { ...doc, is_current: false }, { ...doc, storage_path: null }]) expect(project([first], [file]).followUpOpen).toBe(true);
    const uploaded = project([first], [doc]); expect(uploaded.tone).toBe("green"); expect(uploaded.followUpOpen).toBe(false); expect(uploaded.complete).toBe(false); expect(uploaded.collected).toBe(true);
  });
  it("upload does not invent insurance review or a signature", () => {
    for (const field of ["insurance", "agreement"] as const) {
      const p = project([], [{ ...doc, category: field }], { field, reviewRequired: true });
      expect(p.status).toBe("review_due"); expect(p.tone).toBe("yellow"); expect(p.complete).toBe(false); expect(p.followUpOpen).toBe(false);
    }
  });
  it("canonical complete evidence needs no additional upload", () => {
    const p = project([], [], { field: "agreement", itemComplete: true }); expect(p.tone).toBe("green"); expect(p.followUpOpen).toBe(false);
  });
  it("a correction cannot silently discard uploaded or completed evidence", () => {
    for (const p of [project([first, corrected], [doc]), project([first, corrected], [], { itemComplete: true })]) { expect(p.status).toBe("conflict"); expect(p.tone).toBe("red"); }
  });
  it("aggregates red over yellow over green without changing requirements", () => {
    expect(evidenceTone([yellow, red])).toBe("red"); expect(evidenceTone([yellow, project([first], [doc])])).toBe("yellow"); expect(evidenceTone([])).toBeNull();
    expect(requirementEvidence("license_documents", [yellow, { ...red, field: "license_back" }])?.tone).toBe("red");
    expect(requirementEvidence("interview", [yellow])).toBeUndefined();
  });
  it("does not use another driver or sibling category's attestation", () => {
    expect(project([first], [], { applicationId: other }).status).toBe("missing"); expect(project([first], [], { field: "license_back" }).status).toBe("missing");
  });
  it("refuses stale correction and incomplete or forked history", () => {
    expect(() => proposeEvidenceEvent(input, [first], { id: "event3", actorId: other, occurredAt: "2026-11-09T00:00:00Z" })).toThrow("Refresh");
    expect(() => latestEvidenceEvent([corrected], app, "license_front")).toThrow("Review");
    expect(() => latestEvidenceEvent([first, { ...corrected, supersedesId: null }], app, "license_front")).toThrow("Review");
    expect(() => latestEvidenceEvent([first, first], app, "license_front")).toThrow("Review");
  });
  it("accepts one-click check-offs with no note but rejects client actor/verification injection", () => {
    expect(attestationInput.safeParse(input).success).toBe(true);
    expect(attestationInput.safeParse({ ...input, note: "" }).success).toBe(true);
    for (const bad of [{ ...input, actorId: other }, { ...input, verified: true }, { ...input, field: "approved" }, { ...input, state: "not_collected" }]) expect(attestationInput.safeParse(bad).success).toBe(false);
  });
});

describe("Mock-only exception contract; production exceptions stay unavailable", () => {
  for (const tier of ["owner", "manager"] as const) it(`${tier} may waive both yellow and red with a written reason in the proposed contract`, () => {
    const decision = assessEvidenceException({ ...exception, tier }); expect(decision.eligible).toBe(true); expect(decision.exceptions.map((i) => i.tone)).toEqual(["yellow", "red"]); expect(decision.exceptions.every((i) => i.complete === false && i.followUpOpen)).toBe(true);
    expect(exception.items.map((i) => i.tone)).toEqual(["yellow", "red"]);
  });
  for (const tier of ["coordinator", null] as const) it(`refuses ${tier ?? "non-staff"} even with a reason and supported transaction`, () => expect(assessEvidenceException({ ...exception, tier }).eligible).toBe(false));
  it("requires explicit selection of every waived item and a nonblank five-character reason", () => {
    expect(assessEvidenceException({ ...exception, selectedFields: ["license_front"] }).eligible).toBe(false);
    for (const reason of ["", "   ", "four", "x".repeat(501)]) expect(assessEvidenceException({ ...exception, reason }).eligible).toBe(false);
    expect(assessEvidenceException({ ...exception, reason: "Valid" }).eligible).toBe(true);
  });
  for (const separateBlocker of ["account_conflict", "invalid_license", "expired_license", "vehicle_busy", "vehicle_not_ready", "invalid_dates", "mileage_invalid", "not_approved"]) it(`does not waive separate ${separateBlocker}`, () => expect(assessEvidenceException({ ...exception, separateBlockers: [separateBlocker] }).eligible).toBe(false));
  it("refuses missing durable storage or missing atomic support with no legacy fallback", () => {
    for (const support of [{ storageReady: false, atomicActivationReady: true }, { storageReady: true, atomicActivationReady: false }]) expect(assessEvidenceException({ ...exception, support }).eligible).toBe(false);
  });
  it("refuses duplicate, unknown and conflicted exception selections", () => {
    expect(assessEvidenceException({ ...exception, selectedFields: ["license_front", "license_front", "license_back"] }).eligible).toBe(false);
    expect(assessEvidenceException({ ...exception, selectedFields: [...exception.selectedFields, "agreement"] }).eligible).toBe(false);
    expect(assessEvidenceException({ ...exception, items: [project([first, corrected], [doc])] }).eligible).toBe(false);
  });
});
describe("Saved check-offs in activation (Dolmar's rule)", () => {
  const facts = (evidence: DriverReadinessFacts["evidence"] = {}): DriverReadinessFacts => ({
    status: "approved", agreements: [], documents: [], interviewCompletedAt: "2026-11-01T00:00:00Z", hasPassedInspection: true, evidence,
    insurance: { status: "verified", exceptionAllowed: false, settingPresent: true, settingReadable: true } as any,
  });
  const decide = (f: DriverReadinessFacts, reason?: string) => decideActivation({ blockers: driverRequirementBlockers(f), insurance: f.insurance }, reason ? { overrideBlockers: true, overrideReason: reason } : {});
  it("is enabled", () => expect(CHECKLIST_EVIDENCE_ENABLED).toBe(true));
  it("Yellow (checked off, no file) never blocks activation for license and agreement", () => {
    const f = facts({ license_front: "collected", license_back: "collected", agreement: "collected" });
    expect(decide(f).ok).toBe(true);
    expect(activationRequirements(f).find((r) => r.key === "license_documents")).toMatchObject({ met: true, detail: "Upload Due" });
  });
  it("Red (Not Collected) needs a written reason, then allows activation", () => {
    const f = facts({ license_front: "not_collected", license_back: "collected", agreement: "not_collected" });
    expect(decide(f).ok).toBe(false);
    expect(decide(f, "four").ok).toBe(false);
    const ok = decide(f, "Renter emailing license tonight");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.overridden.map((b) => b.code).sort()).toEqual(["agreement_not_collected", "license_not_collected"]);
  });
  it("an untouched item (no file, no check-off) still blocks, even with a reason", () => {
    expect(decide(facts({}), "Owner says go ahead").ok).toBe(false);
    expect(decide(facts({ license_front: "collected" }), "Owner says go ahead").ok).toBe(false);
  });
});
