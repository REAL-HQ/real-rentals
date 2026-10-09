// The Vehicle Profile document upload, as a state machine.
//
// Pure and client-safe, so the same rules decide what the dialog shows and
// what the tests assert. It exists because the dialog previously inferred its
// whole state from one boolean ("is anything busy?"), which cannot tell
// "nothing has happened yet" apart from "everything has finished" — and that
// is precisely the confusion that left staff looking at "Reading…" over a
// document that had finished, with no way to save what it found.
//
// Nothing here performs I/O or decides permissions; the server still owns both.

/**
 * What has definitely happened to one uploaded file, in order. Each milestone
 * is a fact about stored state, not a guess: a file that reached
 * "document_saved" has a row in the documents vault and a link to this vehicle,
 * whatever the dialog does next.
 */
export const MILESTONES = [
  "file_uploaded",
  "document_saved",
  "extraction_complete",
  "ready_for_review",
  "profile_updated",
] as const;
export type Milestone = (typeof MILESTONES)[number];

export const MILESTONE_LABEL: Record<Milestone, string> = {
  file_uploaded: "File Uploaded",
  document_saved: "Document Saved",
  extraction_complete: "Extraction Complete",
  ready_for_review: "Ready For Review",
  profile_updated: "Vehicle Profile Updated",
};

/** fleet_import_items statuses that mean the reader has not finished. */
export const READING_STATUSES = new Set(["uploaded", "analyzing", "matching"]);

export type UploadItem = {
  id: string;
  fileName: string;
  /** fleet_import_items.status */
  status: string | null;
  docClass: string | null;
  error: string | null;
  /** Whether this file has at least one pending detail for THIS vehicle. */
  reviewable?: boolean;
  /** Whether any field from this file has been written to the vehicle. */
  applied?: boolean;
};

export type FileState = {
  milestone: Milestone;
  label: string;
  /** Reading failed. The file is still saved and linked — that is the point. */
  failed: boolean;
  /** Content-identical to a file already in the vault; linked, not stored twice. */
  duplicate: boolean;
  /** One honest sentence for this file, or "" when the label says enough. */
  note: string;
};

/**
 * Where one file has got to. A file is never reported as less than
 * "document_saved" once the server has registered it, because at that point the
 * original is permanently in the vault whatever happens to the reading.
 */
export function fileState(i: UploadItem): FileState {
  const status = String(i.status ?? "");
  const reading = READING_STATUSES.has(status);
  const failed = status === "failed";
  const duplicate = status === "duplicate";

  if (reading) {
    return {
      milestone: "document_saved",
      label: MILESTONE_LABEL.document_saved,
      failed: false,
      duplicate: false,
      note: "Reading the details…",
    };
  }
  if (failed) {
    return {
      milestone: "document_saved",
      label: MILESTONE_LABEL.document_saved,
      failed: true,
      duplicate: false,
      note: `${i.error ?? "The details could not be read."} The file is saved and linked to this vehicle; you can retry from Fleet Inbox.`,
    };
  }
  if (i.applied) {
    return {
      milestone: "profile_updated",
      label: MILESTONE_LABEL.profile_updated,
      failed: false,
      duplicate,
      note: "",
    };
  }
  if (i.reviewable) {
    return {
      milestone: "ready_for_review",
      label: MILESTONE_LABEL.ready_for_review,
      failed: false,
      duplicate,
      note: "",
    };
  }
  return {
    milestone: "extraction_complete",
    label: MILESTONE_LABEL.extraction_complete,
    failed: false,
    duplicate,
    note: duplicate ? "This exact file was already on file — linked to this vehicle, not stored again." : "",
  };
}

export type Step = 1 | 2 | 3;
export const STEP_LABEL: Record<Step, string> = { 1: "Upload", 2: "Review", 3: "Save Changes" };

/**
 * Which of the three steps the dialog is on. Step 3 is only ever reached by a
 * person pressing Accept: reading something is not saving it.
 */
export function uploadStep(items: UploadItem[]): Step {
  if (!items.length) return 1;
  if (items.some((i) => i.applied)) return 3;
  if (items.some((i) => READING_STATUSES.has(String(i.status ?? "")))) return 1;
  return 2;
}

/** True once anything has been committed, so the dialog must stop saying "Cancel". */
export function isCommitted(args: { items: UploadItem[]; savedDirect: number }): boolean {
  return args.items.length > 0 || args.savedDirect > 0;
}

export type ReviewState =
  | { kind: "reading"; message: string }
  | { kind: "ready"; message: "" }
  | { kind: "empty"; message: string };

/**
 * What to say when the review list has nothing in it.
 *
 * The one message this replaces — "No new details to add; this vehicle already
 * has every value the document shows" — was printed for every empty case,
 * including a duplicate whose details were never applied, a reading that
 * failed, and a document that turned out to belong to a different car. In
 * those three it was simply false.
 */
export function reviewState(args: {
  items: UploadItem[];
  /** Pending details for THIS vehicle, from this upload. */
  suggestions: number;
  conflicts: number;
  possibleMatches: number;
  needsVerification: number;
  /** Vehicles other than this one that the document names by full VIN. */
  otherVehicles: number;
}): ReviewState {
  const { items } = args;
  if (!items.length) return { kind: "empty", message: "" };
  if (items.some((i) => READING_STATUSES.has(String(i.status ?? "")))) {
    return { kind: "reading", message: "Reading the details…" };
  }
  if (args.suggestions || args.conflicts || args.possibleMatches || args.needsVerification) {
    return { kind: "ready", message: "" };
  }
  if (items.every((i) => String(i.status) === "failed")) {
    return {
      kind: "empty",
      message: "Nothing could be read from this file, so there is nothing to review. The file itself is saved and linked to this vehicle.",
    };
  }
  if (args.otherVehicles > 0) {
    return {
      kind: "empty",
      message: "Every detail in this document belongs to another vehicle, matched by full VIN. Nothing here applies to this one — link it above if the document covers it too.",
    };
  }
  if (items.some((i) => String(i.status) === "duplicate")) {
    return {
      kind: "empty",
      message: "This exact file was already on file, so it was linked rather than stored again. Any details it holds were read the first time — review them in Fleet Inbox.",
    };
  }
  return {
    kind: "empty",
    message: "No new details to add — this vehicle already has every value the document shows.",
  };
}

/**
 * Which accepted expiry date, if any, is also this DOCUMENT's expiry.
 *
 * A registration card expires; so does an insurance card. The vehicle columns
 * have always captured those dates, but documents.expires_at — the column the
 * lapse warnings and listExpiring read — was only ever filled by hand on the
 * direct upload path. A file that went through the reader therefore produced a
 * confirmed expiry date that warned nobody.
 *
 * The date is only taken from a field the document's own class makes it the
 * authority for, so an insurance policy date never ends up stamped on a
 * registration card, and only from a field a person has just accepted.
 */
const DOC_EXPIRY_FIELD: Record<string, string> = {
  registration: "registration_expires_on",
  insurance_card: "insurance_expires_on",
  insurance_policy: "insurance_expires_on",
  insurance_renewal: "insurance_expires_on",
};

export function documentExpiryFrom(
  docClass: string | null | undefined,
  accepted: Record<string, string | null | undefined>,
): string | null {
  const field = DOC_EXPIRY_FIELD[String(docClass ?? "")];
  if (!field) return null;
  const value = accepted[field];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}
