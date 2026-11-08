import type { ActivationRequirement } from "@/lib/activation-readiness";
import type { FixTarget } from "@/lib/next-step";

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
      return { label: "Interview", target: { kind: "interview" } };
    case "inspection":
      return { label: requirement.met === null ? "Choose Vehicle" : "View Vehicle", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } };
    case "approved":
      return { label: "View Application", target: { kind: "section", tab: "application", anchor: "" } };
    case "gig_platform":
      return null;
  }
}