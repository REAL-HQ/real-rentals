import type { ActivationRequirement } from "@/lib/activation-readiness";
import type { FixTarget } from "@/lib/next-step";
import type { ActivationRequirementKey } from "@/lib/activation-readiness";

export const PICKUP_INSPECTION_REPORT_LABEL = "Pickup Inspection Report";
export const pickupInspectionCaption = (applicationId: string) => `Pickup Inspection · ${applicationId}`;

/** Pre-rental photos must name this applicant; rental photos must name this rental. */
export function checklistInspectionPhotos<T extends { vehicle_id: string; rental_id: string | null; phase: string; caption: string | null }>(rows: T[], vehicleId: string, applicationId: string, rentalId: string | null): T[] {
  return rows.filter((row) => row.vehicle_id === vehicleId && row.phase === "checkout" && (rentalId ? row.rental_id === rentalId : row.rental_id === null && row.caption === pickupInspectionCaption(applicationId)));
}

/** Only file-backed requirements; never infer a review or completion from a file. */
export function checklistDocumentCategories(key: ActivationRequirementKey): ("license_front" | "license_back" | "insurance" | "agreement" | "gig_profile" | "income" | "insurance_quote" | "screening")[] {
  switch (key) {
    case "license_documents": return ["license_front", "license_back"];
    case "signed_agreement": return ["agreement"];
    case "insurance_verified":
    case "insurance_document": return ["insurance"];
    case "gig_profile": return ["gig_profile"];
    case "income": return ["income"];
    case "insurance_quote": return ["insurance_quote"];
    case "screening": return ["screening"];
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
    case "income":
    case "insurance_quote":
    case "screening":
      return { label: requirement.met === true ? "View" : "+ Add", target: documentTarget };
    case "signed_agreement":
      // The same vault handles signed paper uploads and their audited review.
      return { label: requirement.met === true ? "View" : "+ Add", target: documentTarget };
    case "insurance_verified":
      return { label: requirement.met === true ? "View" : "+ Add", target: { kind: "section", tab: "documents", anchor: "profile-documents" } };
    case "interview":
      return { label: requirement.met === true ? "Edit Notes" : "Call Complete", target: { kind: "record_call" } };
    case "inspection":
      return { label: requirement.met === null ? "Choose Vehicle" : requirement.met === true ? "View" : "+ Add", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } };
    case "approved":
      return { label: "View", target: { kind: "section", tab: "application", anchor: "" } };
    case "gig_platform":
      return null;
    case "reservation_paid":
      return { label: "View", target: { kind: "section", tab: "payments", anchor: "" } };
    case "pickup":
      return { label: "Activate Rental", target: { kind: "activate" } };
    case "rental_active":
      return { label: "View", target: { kind: "section", tab: "rental", anchor: "profile-vehicle" } };
  }
}