// Driver activation readiness: the rules that decide whether Activate Rental
// may start a rental, as pure functions shared by the server (rentals.functions.ts)
// and the screens that explain them (ActivateRentalDialog, the Rental tab).
//
// Client-safe: no server imports. The server gathers the facts and is the only
// authority; the browser only renders what the server returned.
//
// Three kinds of requirement:
//   hard     — never overridable. Activation refuses, with or without a reason.
//   soft     — overridable only with a written reason (>= 5 characters), which
//              is recorded with the blockers in the immutable audit_log
//              (AGENTS.md "Rental activation overrides").
//   advisory — shown as incomplete, never blocks. Used for checks whose hard
//              version conflicts with an existing business rule and is waiting
//              on an Owner decision (insurance verification, the insurance
//              card and the gig profile screenshot — see the PR notes).

import { REQUIRED_VAULT_CATEGORIES } from "@/lib/required-docs";

export type ActivationBlockerCode =
  | "no_vehicle"
  | "vehicle_busy"
  | "no_passed_inspection"
  | "no_email"
  | "not_approved"
  | "already_active"
  | "invalid_dates"
  /** Vehicle fails Rental Ready (or rate missing). Never overridable. */
  | "vehicle_not_ready"
  /** The application's login belongs to a different identity. Never overridable. */
  | "account_conflict"
  /** Pickup mileage is materially below the vehicle's mileage history. */
  | "mileage_invalid"
  /** No signed, non-voided agreement for this application. Never overridable. */
  | "no_signed_agreement"
  /** A required identity document (licence front/back) is missing or rejected. Never overridable. */
  | "missing_documents"
  /** Interview not completed. Overridable with a written reason. */
  | "no_interview"
  /** A soft blocker was acknowledged without a written reason. */
  | "override_reason_required"
  /** Another approval write held the lock; nothing was written. Safe to retry. */
  | "write_busy_retry";

export type ActivationBlocker = {
  code: ActivationBlockerCode;
  message: string;
};

export type RequirementEnforcement = "hard" | "soft" | "advisory";

export type ActivationRequirementKey =
  | "approved"
  | "signed_agreement"
  | "license_documents"
  | "interview"
  | "inspection"
  | "insurance_verified"
  | "insurance_document"
  | "gig_profile";

export type ActivationRequirement = {
  key: ActivationRequirementKey;
  label: string;
  /** null when it cannot be judged yet (inspection before a vehicle is chosen). */
  met: boolean | null;
  enforcement: RequirementEnforcement;
};

export type ActivationReadiness = {
  ready: boolean;
  blockers: ActivationBlocker[];
  warnings: string[];
  /** Every readiness requirement with its state, for the dialog and the Rental tab. */
  requirements: ActivationRequirement[];
  vehicleId: string | null;
  suggestedWeeklyRate: number | null;
  suggestedDeposit: number | null;
  /** Odometer from the latest passed pre-delivery inspection — prefills Pickup Mileage (same observation, never duplicated). */
  inspectionMileage: number | null;
  /** Newest valid reading in mileage history, for the "at least" hint. */
  currentMileage: number | null;
};

/**
 * The only blockers an operator may override, with a written reason.
 * Everything else — including any code added later — is hard: fail closed.
 */
export const SOFT_ACTIVATION_BLOCKERS: ReadonlySet<ActivationBlockerCode> =
  new Set<ActivationBlockerCode>(["no_passed_inspection", "no_interview"]);

export const MIN_OVERRIDE_REASON = 5;

export function isHardBlocker(code: string): boolean {
  return !SOFT_ACTIVATION_BLOCKERS.has(code as ActivationBlockerCode);
}

/** Application statuses activate_rental_tx accepts. Mirrors the database check. */
export const ACTIVATABLE_STATUSES = ["approved", "active"] as const;

/** Licence front and back: required for every renter, never overridable. */
export const HARD_REQUIRED_CATEGORIES = ["license_front", "license_back"] as const;

const DOC_LABEL: Record<string, string> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  insurance: "Insurance Card",
  gig_profile: "Gig Profile Screenshot",
};

export type VaultDocFact = {
  category: string | null;
  is_current: boolean | null;
  review_status?: string | null;
};

/**
 * Required vault categories (REQUIRED_VAULT_CATEGORIES) with no current,
 * non-rejected document. One definition for the drawer count and the server.
 */
export function missingRequiredCategories(docs: readonly VaultDocFact[]): string[] {
  const present = new Set<string>();
  for (const d of docs) {
    if (d.is_current !== true || d.review_status === "rejected" || !d.category) continue;
    present.add(d.category);
  }
  return REQUIRED_VAULT_CATEGORIES.filter((c) => !present.has(c));
}

export type AgreementFact = {
  source?: string | null;
  status: string | null;
  signed_at: string | null;
  voided_at: string | null;
  rental_id?: string | null;
};

/**
 * A signed rental agreement that can paper this activation: an eSign rental
 * agreement for this application (esign.server.ts sets status 'signed' and
 * signed_at in one guarded write), not voided, and not already consumed by an
 * earlier rental (activate_rental_tx links agreements with rental_id NULL to
 * the rental it starts, so a linked one belongs to a previous rental).
 */
export function isUsableSignedAgreement(a: AgreementFact): boolean {
  if ((a.source ?? "rental") !== "rental") return false;
  if (a.status !== "signed" || !a.signed_at) return false;
  if (a.voided_at) return false;
  if (a.rental_id) return false;
  return true;
}

/**
 * A signed agreement filed in the Document Vault (category "agreement", the
 * "Signed agreement" slot staff can upload a paper copy into) counts only once
 * a Manager has marked it Verified — an audited, Manager-only decision.
 */
export function isVerifiedVaultAgreement(d: VaultDocFact): boolean {
  return d.category === "agreement" && d.is_current === true && d.review_status === "verified";
}

export type DriverReadinessFacts = {
  status: string | null;
  agreements: readonly AgreementFact[];
  documents: readonly VaultDocFact[];
  interviewCompletedAt: string | null;
  insuranceVerified: boolean | null;
  /** null when no vehicle is chosen, so inspection cannot be judged. */
  hasPassedInspection: boolean | null;
};

/** The readiness checklist, in the order the work is done. */
export function activationRequirements(f: DriverReadinessFacts): ActivationRequirement[] {
  const missing = new Set(missingRequiredCategories(f.documents));
  const signed =
    f.agreements.some(isUsableSignedAgreement) || f.documents.some(isVerifiedVaultAgreement);
  return [
    {
      key: "approved",
      label: "Application Approved",
      met: (ACTIVATABLE_STATUSES as readonly string[]).includes(
        String(f.status ?? "").toLowerCase(),
      ),
      enforcement: "hard",
    },
    {
      key: "license_documents",
      label: "Driver's License (Front And Back)",
      met: HARD_REQUIRED_CATEGORIES.every((c) => !missing.has(c)),
      enforcement: "hard",
    },
    { key: "signed_agreement", label: "Rental Agreement Signed", met: signed, enforcement: "hard" },
    {
      key: "interview",
      label: "Interview Complete",
      met: !!f.interviewCompletedAt,
      enforcement: "soft",
    },
    {
      key: "inspection",
      label: "Passed Pre-Delivery Inspection",
      met: f.hasPassedInspection,
      enforcement: "soft",
    },
    {
      key: "insurance_verified",
      label: "Insurance Verified",
      met: f.insuranceVerified === true,
      enforcement: "advisory",
    },
    {
      key: "insurance_document",
      label: "Insurance Card",
      met: !missing.has("insurance"),
      enforcement: "advisory",
    },
    {
      key: "gig_profile",
      label: "Gig Profile Screenshot",
      met: !missing.has("gig_profile"),
      enforcement: "advisory",
    },
  ];
}

/**
 * Blockers for the driver-side requirements. The vehicle-side ones
 * (no_vehicle, vehicle_busy, vehicle_not_ready, no_passed_inspection) are
 * produced next to the vehicle reads in evaluateReadiness.
 */
export function driverRequirementBlockers(f: DriverReadinessFacts): ActivationBlocker[] {
  const out: ActivationBlocker[] = [];
  const req = activationRequirements(f);
  const unmet = (k: ActivationRequirementKey) => req.find((r) => r.key === k)?.met === false;
  if (unmet("approved")) {
    out.push({
      code: "not_approved",
      message: `Application is "${f.status}". Approve it before activating.`,
    });
  }
  if (unmet("license_documents")) {
    const missing = missingRequiredCategories(f.documents).filter((c) =>
      (HARD_REQUIRED_CATEGORIES as readonly string[]).includes(c),
    );
    out.push({
      code: "missing_documents",
      message: `Missing required documents: ${missing.map((c) => DOC_LABEL[c] ?? c).join(", ")}. Upload or replace them in Documents.`,
    });
  }
  if (unmet("signed_agreement")) {
    out.push({
      code: "no_signed_agreement",
      message:
        "No signed rental agreement for this application. Send the agreement and wait for the driver to sign it.",
    });
  }
  if (unmet("interview")) {
    out.push({ code: "no_interview", message: "The interview has not been completed." });
  }
  return out;
}

export type ActivationDecision =
  { ok: true; overridden: ActivationBlocker[] } | { ok: false; blockers: ActivationBlocker[] };

/**
 * The server's decision on an activation attempt. Hard blockers refuse even
 * with an override and a reason; soft blockers need an explicit override and
 * a written reason of at least MIN_OVERRIDE_REASON characters.
 */
export function decideActivation(
  blockers: readonly ActivationBlocker[],
  input: { overrideBlockers?: boolean; overrideReason?: string | null },
): ActivationDecision {
  const hard = blockers.filter((b) => isHardBlocker(b.code));
  if (hard.length) return { ok: false, blockers: hard };
  if (blockers.length === 0) return { ok: true, overridden: [] };
  if (!input.overrideBlockers) return { ok: false, blockers: [...blockers] };
  if ((input.overrideReason ?? "").trim().length < MIN_OVERRIDE_REASON) {
    return {
      ok: false,
      blockers: [{ code: "override_reason_required", message: "Enter a reason for the override." }],
    };
  }
  return { ok: true, overridden: [...blockers] };
}

/** Activate Rental entry on the Rental tab: who sees what. */
export type ActivationEntryState = "enabled" | "manager_only" | "rental_active";

export function activationEntryState(input: {
  isManager: boolean;
  rentalActive: boolean;
}): ActivationEntryState {
  if (input.rentalActive) return "rental_active";
  return input.isManager ? "enabled" : "manager_only";
}

export type PrimaryStep =
  "interview" | "documents" | "insurance" | "approve" | "activate" | "view_rental";

/**
 * The drawer header's single next step. Unchanged order; a Coordinator, whom
 * the server refuses, is sent to the Rental tab instead of being offered
 * Activate Rental.
 */
export function primaryStep(input: {
  screeningDone: boolean;
  docsComplete: boolean;
  insuranceOk: boolean;
  approved: boolean;
  rentalActive: boolean;
  isManager: boolean;
}): PrimaryStep {
  if (!input.screeningDone) return "interview";
  if (!input.docsComplete) return "documents";
  if (!input.insuranceOk) return "insurance";
  if (!input.approved) return "approve";
  if (!input.rentalActive) return input.isManager ? "activate" : "view_rental";
  return "view_rental";
}
