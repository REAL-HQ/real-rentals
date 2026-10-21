/**
 * One definition of driver readiness facts.
 *
 * The Drivers drawer rental checklist and the onboarding cohort both call
 * this. Rental Readiness scoring in readiness.ts is a different model
 * (coverage and disqualifiers) and is not copied here. Document expiry reads
 * the same licence and insurance dates this module names, rather than a third
 * list of columns.
 *
 * Pickup is the rental record's start date. applications.pickup_date is the
 * applicant's hope on the marketing form, and there is no pickup_at column.
 * Identity reviews are duplicate-person checks, not ID verification, and a
 * passed background check is not one either. With no ID-verification column,
 * that fact stays Unknown.
 */

export const READINESS_DOCUMENT_CATEGORIES = [
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
] as const;

export const READINESS_FACT_KEYS = [
  "license",
  "card",
  "agreement",
  "pickup",
  "interview",
  "documents",
  "insurance",
  "mvr",
  "id",
  "deposit",
] as const;

export type ReadinessFactKey = (typeof READINESS_FACT_KEYS)[number];

export type ReadinessFactState = "done" | "missing" | "unknown";

export type ReadinessFact = {
  key: ReadinessFactKey;
  label: string;
  state: ReadinessFactState;
  source: string | null;
  at: string | null;
};

export const READINESS_FACT_LABELS: Record<Exclude<ReadinessFactKey, "documents">, string> = {
  license: "License (Front And Back)",
  card: "Card On File",
  agreement: "Agreement Signed",
  pickup: "Pickup Scheduled",
  interview: "Interview Complete",
  insurance: "Insurance Verified",
  mvr: "MVR Authorized",
  id: "ID Verified",
  deposit: "Deposit Received",
};

const CANCELLED_RENTAL = new Set(["cancelled", "canceled", "void", "voided"]);

const RENTAL_DEPOSIT_RECEIVED = new Set([
  "held",
  "pending_disposition",
  "partially_refunded",
  "forfeited",
  "applied",
]);

export type ReadinessApplication = {
  id: string;
  full_name: string | null;
  status: string;
  deleted_at: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
  deposit_status: string | null;
  license_expiration: string | null;
  insurance_expires_on: string | null;
};

export type ReadinessDocument = {
  id?: string;
  driver_id: string | null;
  category: string | null;
  is_current: boolean | null;
  reviewed_at: string | null;
  created_at: string | null;
};

export type ReadinessScreening = {
  id?: string;
  lead_id: string | null;
  interview_completed_at: string | null;
  insurance_verified: boolean | null;
  insurance_verified_at: string | null;
  mvr_authorized: boolean | null;
};

export type ReadinessAgreement = {
  id?: string;
  application_id: string | null;
  status: string | null;
  signed_at: string | null;
  voided_at: string | null;
};

export type ReadinessPayment = {
  id?: string;
  driver_id: string | null;
  type: string | null;
  status: string | null;
  net_collected: number | string | null;
  amount: number | string | null;
  paid_date: string | null;
};

export type ReadinessRental = {
  id?: string;
  application_id: string | null;
  status: string | null;
  start_date: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
  deposit_held: boolean | null;
  deposit_status: string | null;
  deposit_settled_at: string | null;
};

export type ReadinessInput = {
  application: ReadinessApplication;
  documents: readonly ReadinessDocument[];
  screening: ReadinessScreening | null;
  agreements: readonly ReadinessAgreement[];
  payments: readonly ReadinessPayment[];
  rentals: readonly ReadinessRental[];
};

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function money(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stampMillis(value: string | null): number | null {
  const raw = text(value);
  if (!raw) return null;
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(raw);
  const parsed = Date.parse(day ? `${day[1]}T23:59:59.999Z` : raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function later(left: string | null, right: string | null): string | null {
  const a = stampMillis(left);
  const b = stampMillis(right);
  if (a == null) return text(right);
  if (b == null) return text(left);
  return b > a ? text(right) : text(left);
}

function fact(
  key: ReadinessFactKey,
  label: string,
  state: ReadinessFactState,
  source: string | null,
  at: string | null,
): ReadinessFact {
  return {
    key,
    label,
    state,
    source: state === "done" ? source : null,
    at: state === "done" ? at : null,
  };
}

function liveRental(rental: ReadinessRental): boolean {
  return !CANCELLED_RENTAL.has((rental.status ?? "").toLowerCase());
}

function currentDocs(id: string, documents: readonly ReadinessDocument[]): ReadinessDocument[] {
  return documents.filter(
    (doc) => doc.driver_id === id && doc.is_current === true && text(doc.category) != null,
  );
}

function docTime(doc: ReadinessDocument): string | null {
  return text(doc.reviewed_at) ?? text(doc.created_at);
}

function licenseFact(id: string, documents: readonly ReadinessDocument[]): ReadinessFact {
  const mine = currentDocs(id, documents);
  const front = mine.filter((doc) => doc.category === "license_front");
  const back = mine.filter((doc) => doc.category === "license_back");
  if (front.length === 0 || back.length === 0) {
    return fact("license", READINESS_FACT_LABELS.license, "missing", null, null);
  }
  let at: string | null = null;
  for (const doc of [...front, ...back]) at = later(at, docTime(doc));
  return fact("license", READINESS_FACT_LABELS.license, "done", "Document Vault", at);
}

function documentsFact(id: string, documents: readonly ReadinessDocument[]): ReadinessFact {
  const mine = currentDocs(id, documents);
  const present = new Set<string>();
  let at: string | null = null;
  for (const doc of mine) {
    const category = text(doc.category);
    if (!category || !(READINESS_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) continue;
    present.add(category);
    at = later(at, docTime(doc));
  }
  const count = present.size;
  const total = READINESS_DOCUMENT_CATEGORIES.length;
  const label = `Documents ${count}/${total}`;
  if (count < total) return fact("documents", label, "missing", null, null);
  return fact("documents", label, "done", "Document Vault", at);
}

function hasCard(row: {
  card_last4: string | null;
  stripe_payment_method_id: string | null;
  card_on_file_at: string | null;
}): boolean {
  return text(row.card_last4) != null || text(row.stripe_payment_method_id) != null || text(row.card_on_file_at) != null;
}

function cardFact(app: ReadinessApplication, rentals: readonly ReadinessRental[]): ReadinessFact {
  if (hasCard(app)) return fact("card", READINESS_FACT_LABELS.card, "done", "Application", text(app.card_on_file_at));
  let at: string | null = null;
  let found = false;
  for (const rental of rentals) {
    if (rental.application_id !== app.id || !liveRental(rental) || !hasCard(rental)) continue;
    found = true;
    at = later(at, text(rental.card_on_file_at));
  }
  if (!found) return fact("card", READINESS_FACT_LABELS.card, "missing", null, null);
  return fact("card", READINESS_FACT_LABELS.card, "done", "Rental", at);
}

function agreementFact(id: string, agreements: readonly ReadinessAgreement[]): ReadinessFact {
  let at: string | null = null;
  let found = false;
  for (const agreement of agreements) {
    if (agreement.application_id !== id) continue;
    if (text(agreement.voided_at) || agreement.status === "voided") continue;
    // "signing" is the in-progress status. A timestamp on that row is not a signature.
    if (agreement.status !== "signed") continue;
    found = true;
    at = later(at, text(agreement.signed_at));
  }
  if (!found) return fact("agreement", READINESS_FACT_LABELS.agreement, "missing", null, null);
  return fact("agreement", READINESS_FACT_LABELS.agreement, "done", "Agreement", at);
}

function pickupFact(id: string, rentals: readonly ReadinessRental[]): ReadinessFact {
  let at: string | null = null;
  let found = false;
  for (const rental of rentals) {
    if (rental.application_id !== id || !liveRental(rental)) continue;
    const start = text(rental.start_date);
    if (!start) continue;
    found = true;
    at = later(at, start);
  }
  if (!found) return fact("pickup", READINESS_FACT_LABELS.pickup, "unknown", null, null);
  return fact("pickup", READINESS_FACT_LABELS.pickup, "done", "Rental", at);
}

function interviewFact(screening: ReadinessScreening | null): ReadinessFact {
  const at = text(screening?.interview_completed_at);
  if (!at) return fact("interview", READINESS_FACT_LABELS.interview, "missing", null, null);
  return fact("interview", READINESS_FACT_LABELS.interview, "done", "Interview", at);
}

function insuranceFact(screening: ReadinessScreening | null): ReadinessFact {
  if (screening?.insurance_verified !== true) {
    return fact("insurance", READINESS_FACT_LABELS.insurance, "missing", null, null);
  }
  return fact("insurance", READINESS_FACT_LABELS.insurance, "done", "Screening", text(screening.insurance_verified_at));
}

function mvrFact(screening: ReadinessScreening | null): ReadinessFact {
  if (screening?.mvr_authorized !== true) return fact("mvr", READINESS_FACT_LABELS.mvr, "missing", null, null);
  return fact("mvr", READINESS_FACT_LABELS.mvr, "done", "Screening", null);
}

/** No ID-verification column exists. Duplicate-person reviews are not a substitute. */
function idFact(): ReadinessFact {
  return fact("id", READINESS_FACT_LABELS.id, "unknown", null, null);
}

function paidDeposit(payment: ReadinessPayment): boolean {
  if (payment.type !== "deposit") return false;
  if (payment.status !== "paid") return false;
  const net = money(payment.net_collected);
  const collected = net == null ? money(payment.amount) : net;
  return collected != null && collected > 0;
}

function depositFact(
  app: ReadinessApplication,
  payments: readonly ReadinessPayment[],
  rentals: readonly ReadinessRental[],
): ReadinessFact {
  const hits: { at: string | null; source: string }[] = [];
  for (const payment of payments) {
    if (payment.driver_id !== app.id || !paidDeposit(payment)) continue;
    hits.push({ at: text(payment.paid_date), source: "Payment" });
  }
  for (const rental of rentals) {
    if (rental.application_id !== app.id || !liveRental(rental)) continue;
    if (rental.deposit_status === "refunded") continue;
    const received =
      rental.deposit_held === true ||
      (rental.deposit_status != null && RENTAL_DEPOSIT_RECEIVED.has(rental.deposit_status));
    if (!received) continue;
    hits.push({ at: text(rental.deposit_settled_at), source: "Rental" });
  }
  if (hits.length === 0 && app.deposit_status === "paid") hits.push({ at: null, source: "Application" });
  if (hits.length === 0) return fact("deposit", READINESS_FACT_LABELS.deposit, "missing", null, null);
  let best = hits[0];
  for (const hit of hits.slice(1)) {
    const next = stampMillis(hit.at);
    const prev = stampMillis(best.at);
    if (next != null && (prev == null || next > prev)) best = hit;
  }
  return fact("deposit", READINESS_FACT_LABELS.deposit, "done", best.source, best.at);
}

export function readinessFacts(input: ReadinessInput): ReadinessFact[] {
  const id = input.application.id;
  return [
    licenseFact(id, input.documents),
    cardFact(input.application, input.rentals),
    agreementFact(id, input.agreements),
    pickupFact(id, input.rentals),
    interviewFact(input.screening),
    documentsFact(id, input.documents),
    insuranceFact(input.screening),
    mvrFact(input.screening),
    idFact(),
    depositFact(input.application, input.payments, input.rentals),
  ];
}

export function nextMissingFact(facts: readonly ReadinessFact[]): string {
  const missing = facts.find((item) => item.state === "missing");
  if (missing) return missing.label;
  if (facts.some((item) => item.state === "unknown")) return "Unknown";
  return "Complete";
}

export function driverDisplayName(value: string | null): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name || "Unnamed Driver";
}
