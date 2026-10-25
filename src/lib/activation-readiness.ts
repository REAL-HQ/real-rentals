// Driver activation readiness: the rules that decide whether Activate Rental
// may start a rental, as pure functions shared by the server (rentals.functions.ts)
// and the screens that explain them (ActivateRentalDialog, the Rental tab).
//
// Client-safe: no server imports. The server gathers the facts and is the only
// authority; the browser only renders what the server returned. The proposed
// database wrapper (proposed/activation-insurance-setting) re-checks the hard
// driver requirements and the insurance rule inside the activation transaction
// with the same definitions as here.
//
// Kinds of requirement:
//   hard        — never overridable. Activation refuses, with or without a reason.
//   acknowledge — insurance only, and only while the Owner setting
//                 "Allow Activation Without Insurance Verification" is ON: the
//                 operator must tick a separate insurance acknowledgement. A
//                 soft-blocker reason never satisfies it.
//   soft        — overridable only with a written reason (>= 5 characters), which
//                 is recorded with the blockers in the immutable audit_log
//                 (AGENTS.md "Rental activation overrides").
//   advisory    — shown as incomplete, never blocks (the insurance card and the
//                 gig profile / gig platform status: drivers may rent before
//                 completing gig-platform registration).

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
  /** Insurance is not verified and the Owner exception is OFF (or unavailable). Never overridable. */
  | "insurance_not_verified"
  /** The Owner exception is ON but the insurance warning was not acknowledged. */
  | "insurance_ack_required"
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

export type RequirementEnforcement = "hard" | "acknowledge" | "soft" | "advisory";

export type ActivationRequirementKey =
  | "approved"
  | "signed_agreement"
  | "license_documents"
  | "insurance_verified"
  | "interview"
  | "inspection"
  | "insurance_document"
  | "gig_profile"
  | "gig_platform";

export type ActivationRequirement = {
  key: ActivationRequirementKey;
  label: string;
  /** null when it cannot be judged yet (inspection before a vehicle is chosen). */
  met: boolean | null;
  enforcement: RequirementEnforcement;
  /** A short qualifier shown next to the label, e.g. the insurance status. */
  detail?: string;
};

export type InsuranceStatus = "verified" | "unverified" | "missing" | "expired";

export type InsuranceReadiness = {
  status: InsuranceStatus;
  /** The Owner setting as read (missing or unreadable reads false). */
  exceptionAllowed: boolean;
  settingPresent: boolean;
  settingReadable: boolean;
};

export type ActivationReadiness = {
  ready: boolean;
  blockers: ActivationBlocker[];
  warnings: string[];
  /** Every readiness requirement with its state, for the dialog and the Rental tab. */
  requirements: ActivationRequirement[];
  /** Insurance verification state and whether the Owner exception applies. */
  insurance: InsuranceReadiness;
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
  id?: string | null;
  category: string | null;
  is_current: boolean | null;
  review_status?: string | null;
  expires_at?: string | null;
  reviewed_at?: string | null;
  storage_path?: string | null;
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

/** Today's calendar date in America/New_York (the business day), as YYYY-MM-DD. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Insurance status, the same precedence the database wrapper uses:
 * expired (application or current insurance document date before today) >
 * verified (driver_screenings.insurance_verified) > missing (no current,
 * non-rejected insurance document) > unverified. Never inferred as verified.
 */
export function insuranceStatus(input: {
  verified: boolean | null;
  documents: readonly VaultDocFact[];
  applicationExpiresOn: string | null;
  today: string;
}): InsuranceStatus {
  const docs = input.documents.filter(
    (d) => d.category === "insurance" && d.is_current === true && d.review_status !== "rejected",
  );
  const dateOnly = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
  const expired =
    (dateOnly(input.applicationExpiresOn) ?? "9999-12-31") < input.today ||
    docs.some((d) => (dateOnly(d.expires_at) ?? "9999-12-31") < input.today);
  if (expired) return "expired";
  if (input.verified === true) return "verified";
  if (docs.length === 0) return "missing";
  return "unverified";
}

const INSURANCE_STATUS_LABEL: Record<InsuranceStatus, string> = {
  verified: "Verified",
  unverified: "Not Verified",
  missing: "No Insurance Document",
  expired: "Expired",
};

export function insuranceStatusLabel(s: InsuranceStatus): string {
  return INSURANCE_STATUS_LABEL[s];
}

/** The warning the operator must acknowledge to use the Owner exception. */
export function insuranceExceptionWarning(s: InsuranceStatus): string {
  const what =
    s === "expired"
      ? "The driver's insurance on file is expired."
      : s === "missing"
        ? "There is no insurance document on file for this driver."
        : "The driver's insurance has not been verified.";
  return `${what} The Owner allows activation without insurance verification. Starting this rental does not mark insurance as verified, and you are recording that you understand the driver may be uninsured.`;
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

/** The audit_log row setDocumentReview writes when an Owner/Manager verifies a paper agreement. */
export type PaperVerificationAudit = {
  action: string | null;
  actor_role: string | null;
  metadata: Record<string, unknown> | null;
};

export const PAPER_VERIFIER_ROLES = ["admin", "team"] as const;

/** Milliseconds since epoch, floored — the binding between a document's reviewed_at and its audit row. */
export function reviewedAtMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t);
}

/**
 * A manually signed paper agreement counts only when the vault document is
 * current, archived (has a storage path), marked Verified AND there is the
 * audited verification of exactly that file by an Owner or Manager: the
 * document.verified audit row naming this document id, storage path and
 * reviewed_at. review_status alone is not enough — a Coordinator or a stale
 * client could set it, but only the server writes audit_log.
 */
export function isAuditedPaperAgreement(
  d: VaultDocFact,
  audits: readonly PaperVerificationAudit[],
): boolean {
  if (d.category !== "agreement" || d.is_current !== true || d.review_status !== "verified")
    return false;
  if (!d.id || !d.storage_path) return false;
  const ms = reviewedAtMs(d.reviewed_at);
  if (ms == null) return false;
  return audits.some((a) => {
    const m = a.metadata ?? {};
    return (
      a.action === "document.verified" &&
      (PAPER_VERIFIER_ROLES as readonly string[]).includes(String(a.actor_role)) &&
      m.paper_agreement === true &&
      m.documentId === d.id &&
      m.storage_path === d.storage_path &&
      String(m.reviewed_at_ms) === String(ms)
    );
  });
}

export type DriverReadinessFacts = {
  status: string | null;
  agreements: readonly AgreementFact[];
  documents: readonly VaultDocFact[];
  /** document.verified audit rows for this application (paper agreements). */
  paperAudits?: readonly PaperVerificationAudit[];
  interviewCompletedAt: string | null;
  insurance: InsuranceReadiness;
  /** null when no vehicle is chosen, so inspection cannot be judged. */
  hasPassedInspection: boolean | null;
};

export function hasSignedAgreement(f: DriverReadinessFacts): boolean {
  return (
    f.agreements.some(isUsableSignedAgreement) ||
    f.documents.some((d) => isAuditedPaperAgreement(d, f.paperAudits ?? []))
  );
}

/** The readiness checklist, in the order the work is done. */
export function activationRequirements(f: DriverReadinessFacts): ActivationRequirement[] {
  const missing = new Set(missingRequiredCategories(f.documents));
  const ins = f.insurance;
  const gigOnFile = !missing.has("gig_profile");
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
    {
      key: "signed_agreement",
      label: "Rental Agreement Signed",
      met: hasSignedAgreement(f),
      enforcement: "hard",
    },
    {
      key: "insurance_verified",
      label: "Insurance Verified",
      met: ins.status === "verified",
      enforcement: ins.exceptionAllowed ? "acknowledge" : "hard",
      detail: insuranceStatusLabel(ins.status),
    },
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
      key: "insurance_document",
      label: "Insurance Card On File",
      met: !missing.has("insurance"),
      enforcement: "advisory",
    },
    {
      key: "gig_profile",
      label: gigOnFile
        ? "Gig Profile Screenshot On File (Not Platform-Verified)"
        : "Gig Profile Screenshot",
      met: gigOnFile,
      enforcement: "advisory",
    },
    // No integration verifies a driver with Uber, Lyft or any platform, so this
    // is never shown as met. Drivers may rent before gig-platform registration.
    {
      key: "gig_platform",
      label: "Gig Platform: Not Verified",
      met: false,
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
        "No signed rental agreement for this application. Send the agreement for eSignature, or upload the signed paper agreement to Documents and have an Owner or Manager verify it.",
    });
  }
  if (f.insurance.status !== "verified" && !f.insurance.exceptionAllowed) {
    out.push({
      code: "insurance_not_verified",
      message: `Insurance must be verified before activation (${insuranceStatusLabel(f.insurance.status)}). Verify it on the Screening tab.`,
    });
  }
  if (unmet("interview")) {
    out.push({ code: "no_interview", message: "The interview has not been completed." });
  }
  return out;
}

export type ActivationDecision =
  | { ok: true; overridden: ActivationBlocker[]; insuranceExceptionUsed: boolean }
  | { ok: false; blockers: ActivationBlocker[] };

/**
 * The server's decision on an activation attempt.
 *  1. Hard blockers refuse even with an override and a reason.
 *  2. Unverified insurance under the Owner exception needs the separate
 *     insurance acknowledgement; a soft-blocker reason does not count.
 *  3. Soft blockers need an explicit override and a written reason of at
 *     least MIN_OVERRIDE_REASON characters.
 */
export function decideActivation(
  readiness: { blockers: readonly ActivationBlocker[]; insurance: InsuranceReadiness },
  input: {
    overrideBlockers?: boolean;
    overrideReason?: string | null;
    insuranceExceptionAck?: boolean;
  },
): ActivationDecision {
  const { blockers, insurance } = readiness;
  const hard = blockers.filter((b) => isHardBlocker(b.code));
  if (hard.length) return { ok: false, blockers: hard };
  const insuranceExceptionUsed = insurance.status !== "verified";
  if (insuranceExceptionUsed) {
    // Unverified insurance without the exception is a hard blocker above; this is the ON case.
    if (!insurance.exceptionAllowed) {
      return {
        ok: false,
        blockers: [
          {
            code: "insurance_not_verified",
            message: "Insurance must be verified before activation.",
          },
        ],
      };
    }
    if (input.insuranceExceptionAck !== true) {
      return {
        ok: false,
        blockers: [
          { code: "insurance_ack_required", message: insuranceExceptionWarning(insurance.status) },
        ],
      };
    }
  }
  if (blockers.length === 0) return { ok: true, overridden: [], insuranceExceptionUsed };
  if (!input.overrideBlockers) return { ok: false, blockers: [...blockers] };
  if ((input.overrideReason ?? "").trim().length < MIN_OVERRIDE_REASON) {
    return {
      ok: false,
      blockers: [{ code: "override_reason_required", message: "Enter a reason for the override." }],
    };
  }
  return { ok: true, overridden: [...blockers], insuranceExceptionUsed };
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

/** Maps a refusal raised inside activate_rental_checked_tx to a blocker. */
export function checkedTxBlocker(msg: string): ActivationBlocker | null {
  const status = (prefix: string) => {
    const s = msg.split(prefix)[1]?.match(/^[a-z]+/)?.[0] as InsuranceStatus | undefined;
    return s && s in INSURANCE_STATUS_LABEL ? s : "unverified";
  };
  if (msg.includes("insurance_not_verified:"))
    return {
      code: "insurance_not_verified",
      message: `Insurance must be verified before activation (${insuranceStatusLabel(status("insurance_not_verified:"))}). The Owner exception was off when the rental was started.`,
    };
  if (msg.includes("insurance_ack_required:"))
    return {
      code: "insurance_ack_required",
      message: insuranceExceptionWarning(status("insurance_ack_required:")),
    };
  if (msg.includes("no_signed_agreement"))
    return {
      code: "no_signed_agreement",
      message: "No signed rental agreement for this application.",
    };
  if (msg.includes("missing_documents"))
    return {
      code: "missing_documents",
      message: "The driver's license (front and back) is missing or was rejected.",
    };
  if (msg.includes("application_not_found"))
    return { code: "not_approved", message: "Application not found." };
  return null;
}
