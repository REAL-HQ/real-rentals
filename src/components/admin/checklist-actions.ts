import type { ActivationRequirement } from "@/lib/activation-readiness";
import type { FixTarget } from "@/lib/next-step";
import type { ActivationRequirementKey } from "@/lib/activation-readiness";

/** Only file-backed requirements; never infer a review or completion from a file. */
export function checklistDocumentCategories(key: ActivationRequirementKey): ("license_front" | "license_back" | "insurance" | "agreement" | "gig_profile")[] {
  switch (key) {
    case "license_documents": return ["license_front", "license_back"];
    case "signed_agreement": return ["agreement"];
    case "insurance_verified":
    case "insurance_document": return ["insurance"];
    case "gig_profile": return ["gig_profile"];
    default: return [];
  }
}

type ChecklistAction = { label: string; target: FixTarget };

/** Navigation only: never approve, verify, sign, or activate from a checkmark. */
export function checklistAction(requirement: ActivationRequirement): ChecklistAction | null {
  const documentTarget: FixTarget = { kind: "section", tab: "documents", anchor: "profile-documents" };
  switch (requirement.key) {
    case "license_documents":
    case "insurance_document":
    case "gig_profile":
      return { label: requirement.met === true ? "View Files" : "Add Files", target: documentTarget };
    case "signed_agreement":
      // The same vault handles signed paper uploads and their audited review.
      return { label: requirement.met === true ? "View Agreement" : "Add / Review", target: documentTarget };
    case "insurance_verified":
      return { label: "Review", target: { kind: "section", tab: "screening", anchor: "profile-insurance" } };
    case "interview":
      return { label: requirement.met === true ? "Interview Script" : "Call Complete", target: { kind: requirement.met === true ? "interview" : "record_call" } };
    case "inspection":
      return { label: requirement.met === null ? "Choose Vehicle" : "View Vehicle", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } };
    case "approved":
      return { label: "View Application", target: { kind: "section", tab: "application", anchor: "" } };
    case "gig_platform":
      return null;
    case "pickup":
      return { label: "Activate Rental", target: { kind: "activate" } };
    case "rental_active":
      return { label: "View Rental", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } };
  }
}