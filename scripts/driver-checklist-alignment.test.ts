import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activationRequirements,
  NEXT_STEP_REQUIREMENT_KEYS,
  screeningRequirementsComplete,
  type DriverReadinessFacts,
} from "../src/lib/activation-readiness";
import { attestationInput, projectEvidence, requirementEvidence } from "../src/lib/checklist-evidence";
import { driverLifecycle } from "../src/lib/driver-lifecycle";
import { driverNextStepRequirements } from "../src/lib/driver-next-step-requirements";

const facts: DriverReadinessFacts = {
  status: "approved",
  agreements: [],
  documents: [],
  interviewCompletedAt: null,
  hasPassedInspection: false,
  rentalActive: false,
  insurance: { status: "missing", exceptionAllowed: false, settingPresent: true, settingReadable: true },
};

const doc = (category: string) => ({
  id: `${category}-1`, category, is_current: true, review_status: "uploaded", storage_path: `private/${category}`,
});

describe("Driver checklist alignment", () => {
  it("places insurance setup after the signed agreement and reservation payment before inspection", () => {
    const requirements = activationRequirements(facts);
    const terms = { key: "terms_confirmed", label: "Terms Confirmed", met: true, enforcement: "advisory" } as const;
    const items = driverNextStepRequirements(requirements, "pending", terms);
    // t493u: Reservation Paid, then Insurance Quote, then Insurance Setup; Screening with the verification items.
    expect(items.map((item) => item.key)).toEqual([
      "interview", "license_documents", "gig_profile", "income", "screening",
      "approved", "terms_confirmed", "signed_agreement", "reservation_paid", "insurance_quote", "insurance_verified", "inspection", "pickup", "rental_active",
    ]);
    expect(items.map((item) => item.key)).toEqual(NEXT_STEP_REQUIREMENT_KEYS);
    expect(items.find((item) => item.key === "inspection")?.label).toBe("Pickup Inspection");
    expect(requirements.some((item) => item.key === "reservation_paid")).toBe(false);
  });

  it("removes License and Profile and places Agreement before Reserved", () => {
    const result = driverLifecycle({ contacted: true, screening: true, approved: true, inspection: false, agreement: false, rentalActive: false });
    expect(result.stages.map((stage) => stage.label)).toEqual([
      "Applied", "Contacted", "Documents", "Screening", "Approved",
      "Agreement", "Reserved", "Insurance", "Inspection", "Pickup", "Active",
    ]);
  });

  it("income can be checked off without an upload but remains Upload Due", () => {
    const checked = activationRequirements({ ...facts, evidence: { income: "collected" } }).find((item) => item.key === "income");
    expect(checked).toMatchObject({ met: true, detail: "Upload Due", enforcement: "advisory" });
    expect(activationRequirements({ ...facts, documents: [doc("income")] }).find((item) => item.key === "income")?.met).toBe(true);
  });

  it("Insurance Quote completes with the quote file; a check-off alone is Applied, not complete", () => {
    const find = (f: DriverReadinessFacts) => activationRequirements(f).find((item) => item.key === "insurance_quote");
    expect(find({ ...facts, documents: [doc("insurance_quote")] })?.met).toBe(true);
    expect(find({ ...facts, evidence: { insurance_quote: "collected" } })?.met).toBe(false);
    expect(find(facts)?.met).toBe(false);
  });

  it("Screening needs a check-off and its file before approval, and is complete once approved", () => {
    const pre = { ...facts, status: "new" };
    const find = (f: DriverReadinessFacts) => activationRequirements(f).find((item) => item.key === "screening");
    expect(find({ ...pre, documents: [doc("screening")] })?.met).toBe(false);
    expect(find({ ...pre, evidence: { screening: "collected" } })?.met).toBe(false);
    expect(find({ ...pre, documents: [doc("screening")], evidence: { screening: "collected" } })?.met).toBe(true);
    expect(find(facts)).toMatchObject({ met: true, detail: "Approved" });
  });

  it("lifecycle Screening follows the Screening row only (the quote is an insurance step)", () => {
    expect(screeningRequirementsComplete(activationRequirements({ ...facts, status: "new", documents: [doc("insurance_quote")], evidence: { insurance_quote: "collected" } }))).toBe(false);
    expect(screeningRequirementsComplete(activationRequirements(facts))).toBe(true);
  });

  it("saves a file-free inspection check-off as Yellow, never Passed", () => {
    const applicationId = "11111111-1111-4111-8111-111111111111";
    const input = { applicationId, field: "inspection", expectedRevision: 0, idempotencyKey: applicationId, state: "collected", source: "other", note: "" } as const;
    expect(attestationInput.parse(input).field).toBe("inspection");
    const projection = projectEvidence({ applicationId, field: "inspection", events: [{ ...input, id: "event-1", revision: 1, supersedesId: null, actorId: applicationId, occurredAt: "2026-11-09T00:00:00Z" }], documents: [], itemComplete: false });
    expect(projection).toMatchObject({ tone: "yellow", status: "upload_due", complete: false, checkedOff: true });
    expect(requirementEvidence("inspection", [projection])?.tone).toBe("yellow");
    expect(activationRequirements(facts).find((item) => item.key === "inspection")?.met).toBe(false);
  });

  it("wires lifecycle colors to saved evidence rather than local checkmarks", () => {
    const source = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    for (const key of ["interview", "approved", "inspection", "pickup", "rental_active"]) expect(source).toContain(`r.key === "${key}"`);
    expect(source).toContain("screening: screeningComplete");
    expect(source).toContain("documentsReceived: !vaultLoading && (missingRequiredCategories(vaultDocs).length === 0 || stepperReadiness.documentsReceived)");
    expect(source).toContain("documents: stepperReadiness.documentsTone");
    expect(source).toContain("agreement: agreementEvidenceTone");
    expect(source).toContain("inspection: inspectionEvidenceTone");
  });
});

describe("Pickup check-off", () => {
  it("turns Pickup green after confirmed payment without activating the rental", () => {
    const applicationId = "22222222-2222-4222-8222-222222222222";
    const input = { applicationId, field: "pickup", expectedRevision: 0, idempotencyKey: applicationId, state: "collected", source: "other", note: "Payment Confirmed: Cash; Amount Received: $350.00" } as const;
    expect(attestationInput.parse(input).field).toBe("pickup");
    const projection = projectEvidence({ applicationId, field: "pickup", events: [{ ...input, id: "event-1", revision: 1, supersedesId: null, actorId: applicationId, occurredAt: "2026-11-09T00:00:00Z" }], documents: [], itemComplete: false });
    expect(projection).toMatchObject({ tone: "green", status: "confirmed", complete: true });
    expect(requirementEvidence("pickup", [projection])?.tone).toBe("green");
    expect(activationRequirements(facts).find((item) => item.key === "rental_active")?.met).toBe(false);
    const life = driverLifecycle({ contacted: true, documentsReceived: true, screening: true, approved: true, reserved: true, insuranceComplete: true, inspection: true, agreement: true, rentalActive: false, pickup: true });
    expect(life.stages.find((s) => s.key === "pickup")?.state).toBe("done");
    expect(life.stages.find((s) => s.key === "active")?.state).toBe("current");
  });
});
