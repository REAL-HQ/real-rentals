/**
 * Add Driver requests from the Driver Portal (Dolmar, Nov 28 2026 11:41 AM ET).
 * Client-safe: copy, statuses, the step order, the same-address rule and the
 * form check. No database, no Stripe, no sending.
 *
 * Flow: the renter fills in the driver and uploads the license front and
 * back → Requested → pays $100 by Stripe Checkout → Paid (payments webhook) →
 * staff start the insurance step → Insurance Pending → staff record Approved
 * (with the insurance card) or Denied (with a note). Nothing is sent to an
 * insurer automatically. Refunds after a denial are a staff action.
 *
 * Renter copy never names an insurer, broker or rep, says Reservation Fee
 * (never "deposit") where a fee is meant, and uses no em dashes.
 *
 * Switch: Automations → Add Driver (Portal), key renter_add_driver. Off until
 * an Owner turns it on. Off hides the portal card and refuses submit and pay.
 * Staff can still work requests that already exist.
 */
import { MIN_RENTER_AGE } from "@/lib/renter-age";
import { normalizeUsState, normalizeZip, type AddressParts } from "@/lib/driver-addresses";

export const ADD_DRIVER_SWITCH_KEY = "renter_add_driver";
export const ADD_DRIVER_REASON = "add_driver";
export const ADD_DRIVER_FEE_CENTS = 10000;
export const ADD_DRIVER_NOTE_PREFIX = "add_driver:";
export const ADD_DRIVER_UPLOAD_FOLDER = "additional-driver";
export const ADD_DRIVER_MAX_BYTES = 15 * 1024 * 1024;
export const ADD_DRIVER_CHECKOUT_TTL_MS = 23 * 60 * 60 * 1000;
/** Where a renter at a different address goes to get their own car. */
export const APPLY_OWN_CAR_URL = "/apply";

/** Stripe Checkout sends the renter back to /portal?add_driver=paid|canceled; open Documents. */
export function addDriverReturn(search: string): boolean {
  try {
    const v = new URLSearchParams(search).get("add_driver");
    return v === "paid" || v === "canceled";
  } catch {
    return false;
  }
}

export const ADD_DRIVER_STATUSES = [
  "requested",
  "paid",
  "insurance_pending",
  "approved",
  "denied",
] as const;
export type AddDriverStatus = (typeof ADD_DRIVER_STATUSES)[number];

export const ADD_DRIVER_STATUS_LABEL: Record<AddDriverStatus, string> = {
  requested: "Requested",
  paid: "Paid",
  insurance_pending: "Insurance Pending",
  approved: "Approved",
  denied: "Denied",
};

/** Allowed next steps. Mirrors public.guard_additional_driver_request(). */
export const ADD_DRIVER_TRANSITIONS: Record<AddDriverStatus, readonly AddDriverStatus[]> = {
  requested: ["paid", "denied"],
  paid: ["insurance_pending", "denied"],
  insurance_pending: ["approved", "denied"],
  approved: [],
  denied: [],
};

export function canMoveAddDriver(from: AddDriverStatus, to: AddDriverStatus): boolean {
  return ADD_DRIVER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Steps only staff may take. Paid comes from the payments webhook, never a person. */
export const STAFF_ADD_DRIVER_STEPS: readonly AddDriverStatus[] = [
  "insurance_pending",
  "approved",
  "denied",
];

export function isAddDriverStatus(v: unknown): v is AddDriverStatus {
  return typeof v === "string" && (ADD_DRIVER_STATUSES as readonly string[]).includes(v);
}

// ---- Renter copy --------------------------------------------------------------

export const ADD_DRIVER_TITLE = "Add Driver";
export const ADD_DRIVER_BUTTON = "Add Driver";
export const ADD_DRIVER_CARD_TITLE = "Additional Drivers";
export const ADD_DRIVER_CARD_INTRO =
  "Want someone else to drive your car? Send a request and we'll take it from there.";

/** Shown before the form can be sent. Keep it short and plain. */
export const ADD_DRIVER_INFO_POINTS: readonly { title: string; text: string }[] = [
  { title: "Cost", text: "Adding a driver costs $100. You pay it after you send this request." },
  {
    title: "Insurance",
    text: "If approved, the driver is added to the insurance policy on your rental.",
  },
  { title: "Approval", text: "Approval depends on the driver's driving record and history." },
  {
    title: "Same Address",
    text: "For insurance, we can only add a driver who lives at the same address as you.",
  },
];

export const ADD_DRIVER_DIFFERENT_ADDRESS =
  "We can only add a driver who lives at your address. Since this driver lives somewhere else, they need to apply for their own car.";
export const ADD_DRIVER_APPLY_LABEL = "Apply For A Car";
export const ADD_DRIVER_NO_ADDRESS =
  "We don't have your home address on file yet. Contact us and we'll update it before you add a driver.";
export const ADD_DRIVER_NO_RENTAL = "You can add a driver once you have an active rental.";
export const ADD_DRIVER_CONSENT_LABEL =
  "The driver agrees that we and our insurance agency may use this information, including their driving record, to add them to the policy.";
export const ADD_DRIVER_CONSENT_VERSION = "2026-11-28.v1";
export const ADD_DRIVER_PAY_LABEL = "Pay $100";
export const ADD_DRIVER_SENT = "Request sent. Pay $100 to move it forward.";

/** What the renter sees for each status. */
export const ADD_DRIVER_RENTER_STATUS_LINE: Record<AddDriverStatus, string> = {
  requested: "Waiting for your $100 payment.",
  paid: "Payment received. We're getting the insurance started.",
  insurance_pending: "We're adding this driver to the insurance. We'll update you here.",
  approved: "Approved. This driver is on your insurance.",
  denied: "We couldn't add this driver. Contact us with any questions.",
};

// ---- Same-address rule --------------------------------------------------------

const WORDS: Record<string, string> = {
  street: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  av: "ave",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  boulevard: "blvd",
  blvd: "blvd",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  circle: "cir",
  cir: "cir",
  place: "pl",
  pl: "pl",
  terrace: "ter",
  ter: "ter",
  parkway: "pkwy",
  pkwy: "pkwy",
  highway: "hwy",
  hwy: "hwy",
  trail: "trl",
  trl: "trl",
  way: "way",
  square: "sq",
  sq: "sq",
  north: "n",
  n: "n",
  south: "s",
  s: "s",
  east: "e",
  e: "e",
  west: "w",
  w: "w",
  northeast: "ne",
  ne: "ne",
  northwest: "nw",
  nw: "nw",
  southeast: "se",
  se: "se",
  southwest: "sw",
  sw: "sw",
  apartment: "apt",
  apt: "apt",
  unit: "apt",
  suite: "apt",
  ste: "apt",
  "#": "apt",
};

function streetKey(line1: string | null | undefined, line2: string | null | undefined): string {
  const raw = `${line1 ?? ""} ${line2 ?? ""}`
    .toLowerCase()
    .replace(/#/g, " # ")
    .replace(/[.,]/g, " ");
  const words = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w);
  // "apt 4", "# 4" and "unit 4" are the same unit.
  const out: string[] = [];
  for (const w of words) {
    if (w === "apt" && out[out.length - 1] === "apt") continue;
    out.push(w);
  }
  return out.join(" ");
}

/**
 * One key per household address: street words abbreviated the same way, unit
 * markers folded together, state as a 2-letter code and the 5-digit ZIP.
 * Null when the street, city, state or ZIP is missing.
 */
export function householdAddressKey(parts: AddressParts | null | undefined): string | null {
  if (!parts) return null;
  const street = streetKey(parts.line1, parts.line2);
  const city = String(parts.city ?? "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const state = normalizeUsState(parts.state);
  const zip = normalizeZip(parts.zip)?.slice(0, 5) ?? null;
  if (!street || !city || !state || !zip) return null;
  return [street, city, state, zip].join("|");
}

export type SameAddressResult = "same" | "different" | "no_main_address" | "incomplete";

export function compareHouseholdAddress(
  main: AddressParts | null | undefined,
  driver: AddressParts | null | undefined,
): SameAddressResult {
  const m = householdAddressKey(main);
  if (!m) return "no_main_address";
  const d = householdAddressKey(driver);
  if (!d) return "incomplete";
  return m === d ? "same" : "different";
}

// ---- Form ---------------------------------------------------------------------

export type AddDriverForm = {
  fullName: string;
  dob: string;
  phone: string;
  email: string;
  relationship: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  yearsLicensed: string;
  licenseFrontPath: string | null;
  licenseBackPath: string | null;
  consent: boolean;
};

export const emptyAddDriverForm = (main?: AddressParts | null): AddDriverForm => ({
  fullName: "",
  dob: "",
  phone: "",
  email: "",
  relationship: "",
  addressLine1: main?.line1 ?? "",
  addressLine2: main?.line2 ?? "",
  city: main?.city ?? "",
  state: main?.state ?? "",
  zip: main?.zip ?? "",
  licenseNumber: "",
  licenseState: "",
  licenseExpiration: "",
  yearsLicensed: "",
  licenseFrontPath: null,
  licenseBackPath: null,
  consent: false,
});

export function formAddress(
  f: Pick<AddDriverForm, "addressLine1" | "addressLine2" | "city" | "state" | "zip">,
): AddressParts {
  return {
    line1: f.addressLine1,
    line2: f.addressLine2 || null,
    city: f.city,
    state: f.state,
    zip: f.zip,
  };
}

function wholeYears(dob: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return today.slice(5) < dob.slice(5) ? years - 1 : years;
}

/** First problem with the form, in the order the fields appear. Null when it can be sent. */
export function addDriverFormError(f: AddDriverForm, today: string): string | null {
  if (f.fullName.trim().split(/\s+/).length < 2) return "Enter the driver's full name.";
  const age = wholeYears(f.dob, today);
  if (age == null) return "Enter the driver's date of birth.";
  if (age < MIN_RENTER_AGE) return `Drivers must be at least ${MIN_RENTER_AGE}.`;
  if (age > 100) return "Check the date of birth.";
  if (f.phone.replace(/\D/g, "").length < 10) return "Enter the driver's phone number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Enter the driver's email.";
  if (f.relationship.trim().length < 2) return "Enter how the driver is related to you.";
  if (!f.addressLine1.trim() || !f.city.trim()) return "Enter the driver's home address.";
  if (!normalizeUsState(f.state)) return "Enter the state of the driver's address.";
  if (!normalizeZip(f.zip)) return "Enter the ZIP code of the driver's address.";
  if (f.licenseNumber.trim().length < 4) return "Enter the license number.";
  if (!normalizeUsState(f.licenseState)) return "Enter the license state.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.licenseExpiration)) return "Enter the license expiration date.";
  if (f.licenseExpiration < today) return "This license has expired. A valid license is required.";
  if (f.yearsLicensed.trim() !== "") {
    const y = Number(f.yearsLicensed);
    if (!Number.isInteger(y) || y < 0 || y > 80) return "Enter years licensed as a whole number.";
  }
  if (!f.licenseFrontPath) return "Upload the front of the license.";
  if (!f.licenseBackPath) return "Upload the back of the license.";
  if (!f.consent) return "Check the box to confirm the driver agrees.";
  return null;
}

/** True when an upload path sits in this renter's own Add Driver folder. */
export function ownAddDriverPath(applicationId: string, path: string | null | undefined): boolean {
  if (!path) return false;
  const prefix = `${applicationId}/${ADD_DRIVER_UPLOAD_FOLDER}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("..") && path.length < 300;
}

export function addDriverUploadPath(
  applicationId: string,
  kind: "license_front" | "license_back" | "insurance_card",
  fileName: string,
  mimeType: string,
  id: string,
): string {
  const fromName = (fileName.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
  };
  const ext = fromName && fromName.length <= 5 ? fromName : (map[mimeType] ?? "bin");
  return `${applicationId}/${ADD_DRIVER_UPLOAD_FOLDER}/${kind}-${id}.${ext}`;
}

export function addDriverPaymentNote(requestId: string): string {
  return `${ADD_DRIVER_NOTE_PREFIX}${requestId}`;
}

// ---- Rows ---------------------------------------------------------------------

export type AddDriverRequest = {
  id: string;
  applicationId: string;
  rentalId: string | null;
  status: AddDriverStatus;
  fullName: string;
  dob: string;
  phone: string;
  email: string;
  relationship: string;
  address: AddressParts;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  yearsLicensed: number | null;
  feeCents: number;
  paymentId: string | null;
  paidAt: string | null;
  insuranceStartedAt: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  hasInsuranceCard: boolean;
  refundNote: string | null;
  createdAt: string;
};

/** What a renter may see about one of their own requests. No staff notes. */
export type RenterAddDriverRequest = {
  id: string;
  status: AddDriverStatus;
  statusLabel: string;
  statusLine: string;
  fullName: string;
  relationship: string;
  createdAt: string;
  canPay: boolean;
  insuranceCardUrl: string | null;
};

export function renterView(
  r: AddDriverRequest,
  insuranceCardUrl: string | null,
): RenterAddDriverRequest {
  return {
    id: r.id,
    status: r.status,
    statusLabel: ADD_DRIVER_STATUS_LABEL[r.status],
    statusLine: ADD_DRIVER_RENTER_STATUS_LINE[r.status],
    fullName: r.fullName,
    relationship: r.relationship,
    createdAt: r.createdAt,
    canPay: r.status === "requested",
    insuranceCardUrl: r.status === "approved" ? insuranceCardUrl : null,
  };
}

/** Open requests a staff member should act on, oldest first. */
export function staffQueueRank(status: AddDriverStatus): number {
  if (status === "paid") return 0;
  if (status === "insurance_pending") return 1;
  if (status === "requested") return 2;
  return 3;
}
