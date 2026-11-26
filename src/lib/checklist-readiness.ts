/**
 * One readiness source for the driver profile's Next Step checklist AND the
 * Driver Lifecycle stepper, so the two can never disagree (Dolmar, t493u).
 *
 * Pure and client-safe. Inputs are authorized facts the profile already reads:
 * the vault list (adminListDriverDocuments), saved check-offs
 * (checklist_evidence_events), the server readiness rows
 * (getActivationReadiness) and FLEET's audited "insurance applied" mark.
 * Nothing here verifies identity, insurance or a gig platform: green means a
 * real file or a real recorded decision is on file.
 */
import {
  INSURANCE_QUOTE_LABEL,
  SCREENING_APPROVED_LABEL,
  type ActivationRequirement,
  type VaultDocFact,
} from "./activation-readiness";
import {
  EVIDENCE_FIELDS,
  documentCollection,
  evidenceTone,
  latestEvidenceEvent,
  projectEvidence,
  type EvidenceEvent,
  type EvidenceField,
  type EvidenceProjection,
  type EvidenceTone,
} from "./checklist-evidence";
import { requirementCategory } from "./required-docs";

/**
 * The vault list sent to the browser never carries storage_path, so the strict
 * "file on record" test in projectEvidence read every received file as not
 * uploaded (license and gig profile showed "Upload Due" with verified files on
 * record). A current, not-rejected file with an id is a received file — the
 * same rule the Documents tab and documentCollection use.
 */
export function withVaultReceipt<T extends VaultDocFact>(docs: readonly T[]): T[] {
  return docs.map((doc) => ({ ...doc, storage_path: doc.storage_path === undefined && doc.id ? `vault:${doc.id}` : doc.storage_path }));
}

/** FLEET's audited "insurance applied for" mark (fleet-insurance-applied.server.ts). */
export type FleetInsuranceApplied = { at: string; summary: string } | null | undefined;

export type ChecklistReadinessInput = {
  applicationId: string;
  /** The vault list as the profile holds it (with or without storage_path). */
  documents: readonly VaultDocFact[];
  /** Saved check-offs; an inconsistent history must be passed as [] by the caller. */
  events: readonly EvidenceEvent[];
  /** Server readiness rows; null while loading or after a failed read. */
  requirements: readonly ActivationRequirement[] | null;
  /** A real running rental (rentals table). The only thing that completes Pickup. */
  rentalActive: boolean;
  /** Real passed pre-delivery inspection for the chosen vehicle. */
  inspectionPassed: boolean;
  fleetInsuranceApplied?: FleetInsuranceApplied;
};

const REVIEW_REQUIRED: readonly EvidenceField[] = ["agreement", "insurance", "insurance_quote", "screening"];
const VERIFIED_LABEL_FIELDS: readonly EvidenceField[] = ["license_front", "gig_profile", "income"];

function hasCurrentFile(docs: readonly VaultDocFact[], field: EvidenceField): VaultDocFact[] {
  return docs.filter((d) => (field === "income" ? requirementCategory(d.category) === "income" : d.category === field)
    && d.is_current === true && d.review_status !== "rejected" && !!d.id);
}

/** Applied: a saved staff "Mark Applied" check-off, or a FLEET mark newer than any staff correction. */
export function insuranceQuoteApplied(input: { applicationId: string; events: readonly EvidenceEvent[]; fleetInsuranceApplied?: FleetInsuranceApplied }): boolean {
  const latest = latestEvidenceEvent(input.events, input.applicationId, "insurance_quote");
  const fleetAt = input.fleetInsuranceApplied?.at ? Date.parse(input.fleetInsuranceApplied.at) : NaN;
  if (latest?.state === "collected") return true;
  if (!Number.isFinite(fleetAt)) return false;
  if (!latest) return true;
  const staffAt = Date.parse(latest.occurredAt);
  // A staff "Not Applied" correction made after FLEET's mark wins.
  return !Number.isFinite(staffAt) || fleetAt > staffAt;
}

/** Insurance Quote: Applied (yellow) once applied for; Green only when the quote file is on record. */
export function projectInsuranceQuote(input: { applicationId: string; events: readonly EvidenceEvent[]; documents: readonly VaultDocFact[]; fleetInsuranceApplied?: FleetInsuranceApplied }): EvidenceProjection {
  const latest = latestEvidenceEvent(input.events, input.applicationId, "insurance_quote");
  const uploaded = hasCurrentFile(input.documents, "insurance_quote").length > 0;
  const applied = insuranceQuoteApplied(input);
  const base = { field: "insurance_quote" as const, revision: latest?.revision ?? 0, checkedOff: latest?.state === "collected", uploaded, collected: uploaded || applied, complete: uploaded, followUpOpen: !uploaded };
  if (uploaded) return { ...base, tone: "green", status: "uploaded", label: INSURANCE_QUOTE_LABEL.onFile };
  if (applied) return { ...base, tone: "yellow", status: "upload_due", label: INSURANCE_QUOTE_LABEL.applied };
  return { ...base, tone: "red", status: latest?.state === "not_collected" ? "not_collected" : "missing", label: INSURANCE_QUOTE_LABEL.notApplied };
}

const met = (reqs: readonly ActivationRequirement[] | null, key: ActivationRequirement["key"]) => reqs?.some((r) => r.key === key && r.met === true) === true;

/** Every checklist evidence row, from the one shared set of facts. */
export function checklistEvidenceItems(input: ChecklistReadinessInput): EvidenceProjection[] {
  const documents = withVaultReceipt(input.documents);
  const reqs = input.requirements;
  return EVIDENCE_FIELDS.map((field) => {
    if (field === "insurance_quote") return projectInsuranceQuote({ ...input, documents });
    const itemComplete =
      field === "agreement" ? reqs?.some((r) => r.key === "signed_agreement" && r.met === true && r.detail !== "Upload Due") === true
      // Pickup is complete only when the rental is actually running. A paid
      // Reservation Fee (payments "Current") is not a pickup.
      : field === "pickup" ? input.rentalActive
      : field === "inspection" ? input.inspectionPassed
      : field === "income" || field === "screening" ? met(reqs, field)
      : false;
    const p = projectEvidence({ applicationId: input.applicationId, field, events: input.events, documents, itemComplete, reviewRequired: REVIEW_REQUIRED.includes(field) });
    if (field === "screening" && p.tone === "green" && reqs?.some((r) => r.key === "screening" && r.detail === SCREENING_APPROVED_LABEL)) {
      return { ...p, label: SCREENING_APPROVED_LABEL };
    }
    // A file a person reviewed and marked Verified (document.verified audit) says so.
    if (VERIFIED_LABEL_FIELDS.includes(field) && p.tone === "green" && hasCurrentFile(documents, field).some((d) => d.review_status === "verified")) {
      return { ...p, label: "Verified" };
    }
    return p;
  });
}

export type LifecycleReadiness = {
  /** Documents stage: license front, gig profile and income proof received (file or saved check-off). */
  documentsReceived: boolean;
  documentsTone: EvidenceTone;
  /** Screening stage: the Screening checklist row. */
  screeningComplete: boolean;
  screeningTone: EvidenceTone | null;
};

/** Stepper facts and colors for Documents and Screening, read from the checklist rows. */
export function lifecycleReadiness(input: ChecklistReadinessInput & { items?: readonly EvidenceProjection[] }): LifecycleReadiness {
  const items = input.items ?? checklistEvidenceItems(input);
  const docs = documentCollection({
    applicationId: input.applicationId,
    events: input.events,
    documents: input.documents.map((d) => ({ ...d, applicationId: input.applicationId })),
  });
  const documentRows = items.filter((i) => i.field === "license_front" || i.field === "gig_profile" || i.field === "income");
  const documentsTone = evidenceTone(documentRows) ?? docs.tone;
  const screening = items.filter((i) => i.field === "screening");
  const screeningComplete = met(input.requirements, "screening");
  return {
    documentsReceived: docs.collected,
    documentsTone,
    screeningComplete,
    screeningTone: screeningComplete ? "green" : evidenceTone(screening),
  };
}
