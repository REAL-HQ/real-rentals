import { describe, expect, it } from "vitest";
import { checklistAction, checklistDocumentCategories } from "../src/components/admin/checklist-actions";
import type { ActivationRequirement, ActivationRequirementKey } from "../src/lib/activation-readiness";

const requirement = (key: ActivationRequirementKey, met: boolean | null = false): ActivationRequirement => ({ key, met, label: key, enforcement: "hard" });

describe("Driver checklist actions", () => {
  it("routes each Add field to its own document category, never a different evidence slot", () => {
    expect(checklistDocumentCategories("license_documents")).toEqual(["license_front", "license_back"]);
    expect(checklistDocumentCategories("signed_agreement")).toEqual(["agreement"]);
    expect(checklistDocumentCategories("insurance_verified")).toEqual(["insurance"]);
    expect(checklistDocumentCategories("gig_profile")).toEqual(["gig_profile"]);
    expect(checklistDocumentCategories("approved")).toEqual([]);
    expect(checklistDocumentCategories("gig_platform")).toEqual([]);
  });
  it("files and paper agreements open the existing document vault rather than completing readiness", () => {
    for (const key of ["license_documents", "insurance_document", "gig_profile", "signed_agreement"] as const) {
      const before = requirement(key);
      expect(checklistAction(before)?.target).toEqual({ kind: "section", tab: "documents", anchor: "profile-documents" });
      expect(before.met).toBe(false);
    }
  });
  it("insurance review and interview open the established workflows", () => {
    expect(checklistAction(requirement("insurance_verified"))?.target).toEqual({ kind: "section", tab: "screening", anchor: "profile-insurance" });
    expect(checklistAction(requirement("interview"))?.target).toEqual({ kind: "record_call" });
    expect(checklistAction(requirement("interview", true))?.target).toEqual({ kind: "interview" });
  });
  it("approval and inspection never offer a direct approval or activation override", () => {
    expect(checklistAction(requirement("approved"))?.target).toEqual({ kind: "section", tab: "application", anchor: "" });
    expect(checklistAction(requirement("inspection", null))?.target).toEqual({ kind: "section", tab: "rental", anchor: "profile-vehicle" });
  });
  it("gig platform cannot be manually verified", () => {
    expect(checklistAction(requirement("gig_platform"))).toBeNull();
  });
  it("completed evidence stays complete and still opens its original records", () => {
    const completed = requirement("license_documents", true);
    expect(checklistAction(completed)?.target).toEqual(checklistAction(requirement("license_documents"))?.target);
    expect(completed.met).toBe(true);
  });
});