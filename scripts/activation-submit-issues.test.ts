import { describe, expect, it } from "vitest";
import { activationSubmitIssues } from "../src/components/admin/activation-submit-issues";
import { checklistDocumentCategories } from "../src/components/admin/checklist-actions";
import type { ActivationReadiness } from "../src/lib/activation-readiness";

const readiness: ActivationReadiness = { ready: true, blockers: [], warnings: [], requirements: [], insurance: { status: "verified", exceptionAllowed: false, settingPresent: true, settingReadable: true }, vehicleId: "car", suggestedWeeklyRate: 350, suggestedDeposit: null, inspectionMileage: 100000, currentMileage: 100000 };
const input = { readiness, checking: false, vehicleId: "car", rate: 350, pickupMileage: 100000, startDate: "2026-11-08", acknowledged: true, overrideReason: "owner approved rental", insuranceAcknowledged: false };

describe("Visible activation gates", () => {
  it("a written reason never bypasses missing license evidence or an unreviewed signed agreement", () => {
    const blocked = { ...readiness, blockers: [{ code: "missing_documents" as const, message: "License Missing" }, { code: "no_signed_agreement" as const, message: "Agreement Missing" }] };
    expect(activationSubmitIssues({ ...input, readiness: blocked }).map((i) => i.key)).toEqual(["missing_documents", "no_signed_agreement"]);
  });
  it("the existing five-character reason clears only soft interview and inspection blockers", () => {
    const soft = { ...readiness, blockers: [{ code: "no_interview" as const, message: "Interview" }, { code: "no_passed_inspection" as const, message: "Inspection" }] };
    expect(activationSubmitIssues({ ...input, readiness: soft, overrideReason: "four" }).map((i) => i.key)).toEqual(["reason"]);
    expect(activationSubmitIssues({ ...input, readiness: soft, overrideReason: "Valid" })).toEqual([]);
  });
  it("insurance exceptions still need their separate acknowledgement", () => {
    const exception = { ...readiness, insurance: { ...readiness.insurance, status: "unverified" as const, exceptionAllowed: true } };
    expect(activationSubmitIssues({ ...input, readiness: exception }).map((i) => i.key)).toEqual(["insurance_ack"]);
    expect(activationSubmitIssues({ ...input, readiness: exception, insuranceAcknowledged: true })).toEqual([]);
  });
  it("unknown readiness and missing pickup mileage cannot enable activation", () => {
    expect(activationSubmitIssues({ ...input, readiness: null }).map((i) => i.key)).toEqual(["readiness"]);
    expect(activationSubmitIssues({ ...input, pickupMileage: null }).map((i) => i.key)).toEqual(["mileage"]);
    expect(activationSubmitIssues(input)).toEqual([]);
  });
});

describe("Checklist file destinations", () => {
  it("license files stay distinct front and back categories", () => expect(checklistDocumentCategories("license_documents")).toEqual(["license_front", "license_back"]));
  it("signed paper evidence goes to the existing agreement category", () => expect(checklistDocumentCategories("signed_agreement")).toEqual(["agreement"]));
  it("insurance uploads do not become a verification action", () => expect(checklistDocumentCategories("insurance_verified")).toEqual(["insurance"]));
  it("interview, approval, inspection and platform verification do not accept a file as completion", () => {
    for (const key of ["interview", "approved", "inspection", "gig_platform"] as const) expect(checklistDocumentCategories(key)).toEqual([]);
  });
});