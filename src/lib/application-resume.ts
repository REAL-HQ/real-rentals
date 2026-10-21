/**
 * Application resume. The flag is a hard false constant. Routes duplicate it
 * and do not import this module until the check passes, so a flag-off visit
 * to / or /apply never loads it.
 *
 * Nothing here writes, sends mail, or talks to the database. The browser
 * loader in application-resume-client.ts reads with the applicant's own
 * session or the existing resume-token endpoint.
 */
export const APPLICATION_RESUME_ENABLED: boolean = false as boolean;

/** Columns a signed-in applicant may read for their own draft. No contact secrets, no staff fields, no payment fields. */
export const OWN_DRAFT_COLUMNS = [
  "status",
  "full_name",
  "current_step",
  "vehicle_size",
  "pickup_date",
  "expected_duration",
  "city",
  "state",
  "platforms",
  "gig_status",
  "drive_type",
  "insurance_answer",
  "license_valid",
  "license_photo_url",
  "insurance_doc_url",
  "profile_screenshot_url",
  "trip_screenshots",
  "address",
  "zip",
].join(",");

export const RESUME_STEP_TOTAL = 4;

const CLOSED_STATUSES = new Set([
  "approved",
  "active",
  "suspended",
  "declined",
  "closed",
  "duplicate",
  "complete",
]);

const DURATION_LABELS: Record<string, string> = {
  "1_month": "1 Month",
  "2_months": "2 Months",
  "3_months": "3 Months",
  "4plus_months": "4+ Months",
  not_sure: "Not Sure Yet",
  "1-2_weeks": "1-2 Weeks",
  "3-4_weeks": "3-4 Weeks",
  "1-2_months": "1-2 Months",
  "2plus_months": "2+ Months",
  ongoing: "Ongoing",
};

const GIG_LABELS: Record<string, string> = {
  "Yes, already driving": "Yes, Already Driving",
  "Not yet, ready to start": "Not Yet — Ready To Start",
  No: "No",
};

const DRIVE_LABELS: Record<string, string> = {
  full_time: "Full-Time",
  part_time: "Part-Time",
};

const INSURANCE_LABELS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  not_sure: "Not Sure",
};

export type ResumePhase = "rental" | "driving" | "documents";

/** Answers and upload presence. Storage paths never belong here. */
export type ResumeSnapshot = {
  status: string;
  deleted: boolean;
  fullName: string;
  vehicleSize: string | null;
  pickupDate: string | null;
  expectedDuration: string | null;
  city: string | null;
  state: string | null;
  platforms: string[];
  gigStatus: string | null;
  driveType: string | null;
  insuranceAnswer: string | null;
  licenseValid: boolean | null;
  licenseOnFile: boolean;
  insuranceOnFile: boolean;
  profileOnFile: boolean;
  tripCount: number;
  address: string | null;
  zip: string | null;
};

export type ResumeProgress = {
  step: number;
  total: typeof RESUME_STEP_TOTAL;
  label: string;
  /** Wizard phase to open. Null when the incomplete step is contact info, or when nothing is incomplete. */
  phase: ResumePhase | null;
  missingDocuments: string[];
  complete: boolean;
};

export type SavedAnswer = { label: string; value: string };

export type ContinueDraft = {
  progress: ResumeProgress;
  answers: SavedAnswer[];
  /** This tab holds a resume token, so Continue can open the existing wizard. */
  canOpenWizard: boolean;
};

const EMPTY: ResumeSnapshot = {
  status: "",
  deleted: false,
  fullName: "",
  vehicleSize: null,
  pickupDate: null,
  expectedDuration: null,
  city: null,
  state: null,
  platforms: [],
  gigStatus: null,
  driveType: null,
  insuranceAnswer: null,
  licenseValid: null,
  licenseOnFile: false,
  insuranceOnFile: false,
  profileOnFile: false,
  tripCount: 0,
  address: null,
  zip: null,
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function snapshotFromOwnRow(row: Record<string, unknown>): ResumeSnapshot {
  const trips = Array.isArray(row.trip_screenshots) ? row.trip_screenshots : [];
  return {
    ...EMPTY,
    status: text(row.status) ?? "",
    deleted: row.deleted_at != null && row.deleted_at !== "",
    fullName: text(row.full_name) ?? "",
    vehicleSize: text(row.vehicle_size),
    pickupDate: text(row.pickup_date),
    expectedDuration: text(row.expected_duration),
    city: text(row.city),
    state: text(row.state),
    platforms: stringList(row.platforms),
    gigStatus: text(row.gig_status),
    driveType: text(row.drive_type),
    insuranceAnswer: text(row.insurance_answer),
    licenseValid: typeof row.license_valid === "boolean" ? row.license_valid : null,
    licenseOnFile: present(row.license_photo_url),
    insuranceOnFile: present(row.insurance_doc_url),
    profileOnFile: present(row.profile_screenshot_url),
    tripCount: trips.length,
    address: text(row.address),
    zip: text(row.zip),
  };
}

/** The payload getApplicationForWizard already returns: presence flags, no paths, no status. */
export function snapshotFromWizard(row: {
  full_name?: string | null;
  vehicle_size?: string | null;
  pickup_date?: string | null;
  expected_duration?: string | null;
  city?: string | null;
  state?: string | null;
  platforms?: string[] | null;
  gig_status?: string | null;
  drive_type?: string | null;
  insurance_answer?: string | null;
  license_valid?: boolean | null;
  license_photo_on_file?: boolean;
  insurance_doc_on_file?: boolean;
  profile_screenshot_on_file?: boolean;
  trip_screenshot_names?: string[] | null;
  address?: string | null;
  zip?: string | null;
}): ResumeSnapshot {
  return {
    ...EMPTY,
    fullName: text(row.full_name) ?? "",
    vehicleSize: text(row.vehicle_size),
    pickupDate: text(row.pickup_date),
    expectedDuration: text(row.expected_duration),
    city: text(row.city),
    state: text(row.state),
    platforms: stringList(row.platforms),
    gigStatus: text(row.gig_status),
    driveType: text(row.drive_type),
    insuranceAnswer: text(row.insurance_answer),
    licenseValid: typeof row.license_valid === "boolean" ? row.license_valid : null,
    licenseOnFile: row.license_photo_on_file === true,
    insuranceOnFile: row.insurance_doc_on_file === true,
    profileOnFile: row.profile_screenshot_on_file === true,
    tripCount: Array.isArray(row.trip_screenshot_names) ? row.trip_screenshot_names.length : 0,
    address: text(row.address),
    zip: text(row.zip),
  };
}

function documentChecks(snapshot: ResumeSnapshot): { label: string; done: boolean }[] {
  return [
    { label: "Driver's Licence", done: snapshot.licenseOnFile && snapshot.licenseValid === true },
    { label: "Insurance", done: snapshot.insuranceOnFile },
    { label: "Gig Profile", done: snapshot.profileOnFile },
    { label: "Trip History", done: snapshot.tripCount > 0 },
    { label: "Your Address", done: Boolean(snapshot.address && snapshot.zip) },
  ];
}

export function progressFromSnapshot(snapshot: ResumeSnapshot): ResumeProgress {
  const missingDocuments = documentChecks(snapshot)
    .filter((item) => !item.done)
    .map((item) => item.label);
  const rentalDone = Boolean(snapshot.vehicleSize && snapshot.pickupDate && snapshot.expectedDuration);
  const drivingDone = Boolean(snapshot.gigStatus && snapshot.driveType && snapshot.insuranceAnswer);
  const documentsDone = missingDocuments.length === 0;

  let step = 4;
  let label = "Documents";
  let phase: ResumePhase | null = "documents";
  let complete = false;
  if (!snapshot.fullName) {
    step = 1;
    label = "Your Info";
    phase = null;
  } else if (!rentalDone) {
    step = 2;
    label = "Rental";
    phase = "rental";
  } else if (!drivingDone) {
    step = 3;
    label = "Driving";
    phase = "driving";
  } else if (!documentsDone) {
    step = 4;
    label = "Documents";
    phase = "documents";
  } else {
    complete = true;
    phase = null;
  }

  return { step, total: RESUME_STEP_TOTAL, label, phase, missingDocuments, complete };
}

export function progressFromWizard(row: Parameters<typeof snapshotFromWizard>[0]): ResumeProgress {
  return progressFromSnapshot(snapshotFromWizard(row));
}

export function isOpenDraft(snapshot: ResumeSnapshot): boolean {
  if (snapshot.deleted) return false;
  if (CLOSED_STATUSES.has(snapshot.status.trim().toLowerCase())) return false;
  return !progressFromSnapshot(snapshot).complete;
}

function show(value: string | null, labels?: Record<string, string>): string {
  if (!value) return "Not Answered";
  return labels?.[value] ?? value;
}

function vehicleLabel(value: string | null): string {
  if (!value) return "Not Answered";
  return value === "XL" ? "Minivan" : value;
}

export function savedAnswers(snapshot: ResumeSnapshot, progress: ResumeProgress): SavedAnswer[] {
  if (progress.label === "Your Info") {
    return [{ label: "Full Name", value: show(snapshot.fullName) }];
  }
  if (progress.label === "Rental") {
    const place = [snapshot.city, snapshot.state].filter(Boolean).join(", ");
    return [
      { label: "Vehicle", value: vehicleLabel(snapshot.vehicleSize) },
      { label: "Pickup Date", value: show(snapshot.pickupDate) },
      { label: "Expected Duration", value: show(snapshot.expectedDuration, DURATION_LABELS) },
      { label: "Pickup City", value: place || "Not Answered" },
    ];
  }
  if (progress.label === "Driving") {
    return [
      { label: "Gig Apps", value: snapshot.platforms.length ? snapshot.platforms.join(", ") : "Not Answered" },
      { label: "Gig Status", value: show(snapshot.gigStatus, GIG_LABELS) },
      { label: "How You Plan To Drive", value: show(snapshot.driveType, DRIVE_LABELS) },
      { label: "Full Coverage Insurance", value: show(snapshot.insuranceAnswer, INSURANCE_LABELS) },
    ];
  }
  return documentChecks(snapshot).map((item) => ({
    label: item.label,
    value: item.done ? "On File" : "Missing",
  }));
}

export function continueDraft(snapshot: ResumeSnapshot, canOpenWizard: boolean): ContinueDraft | null {
  if (!isOpenDraft(snapshot)) return null;
  const progress = progressFromSnapshot(snapshot);
  return { progress, answers: savedAnswers(snapshot, progress), canOpenWizard };
}

/**
 * The link promotion already minted. Same address resumeUrl() builds for
 * /thank-you. Plaintext exists only in the admin session that just promoted.
 */
export function resumeLinkForToken(token: string): string {
  return `https://drivereal.com/thank-you?t=${encodeURIComponent(token)}`;
}

/**
 * The application a waitlist promotion already created or linked.
 * Rows are this verified email only, newest signup first. The first row
 * with a promoted application wins. An unpromoted row does not invent one.
 */
export function continuationApplicationId(
  rows: { promoted_application_id?: string | null }[],
): string | null {
  for (const row of rows) {
    const id = row.promoted_application_id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}

/** The promoted application belongs to this verified caller, and to nobody else. */
export function canContinuePromotedApplication(
  app: { email?: string | null; deleted_at?: string | null; user_id?: string | null },
  verifiedEmail: string,
  userId: string,
): boolean {
  if (app.deleted_at) return false;
  const email = verifiedEmail.trim().toLowerCase();
  const appEmail = String(app.email ?? "").trim().toLowerCase();
  if (!email || appEmail !== email) return false;
  if (app.user_id && app.user_id !== userId) return false;
  return true;
}
