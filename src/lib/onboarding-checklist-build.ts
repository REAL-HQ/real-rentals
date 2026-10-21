import {
  ONBOARDING_ROW_CAP,
  ONBOARDING_STEP_KEYS,
  onboardingCohort,
  type OnboardingAgreement,
  type OnboardingApplication,
  type OnboardingChecklistInput,
  type OnboardingChecklistResult,
  type OnboardingDocument,
  type OnboardingDriver,
  type OnboardingIdentityReview,
  type OnboardingPayment,
  type OnboardingRental,
  type OnboardingStep,
  type OnboardingStepKey,
} from "./onboarding-checklist";

export const ONBOARDING_STEP_LABELS: Record<OnboardingStepKey, string> = {
  license_docs: "License Docs Verified",
  id: "ID Verified",
  agreement: "Agreement Signed",
  card: "Card On File",
  deposit: "Deposit Received",
  pickup: "Pickup Scheduled",
  vehicle: "Vehicle Assigned",
};

const RENTAL_DEPOSIT_RECEIVED = new Set([
  "held",
  "pending_disposition",
  "partially_refunded",
  "refunded",
  "forfeited",
  "applied",
]);

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function money(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function driverName(value: string | null): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name || "Unnamed Driver";
}

function makeStep(key: OnboardingStepKey, done: boolean, source: string | null, at: string | null): OnboardingStep {
  return {
    key,
    label: ONBOARDING_STEP_LABELS[key],
    done,
    source: done ? source : null,
    at: done ? at : null,
  };
}

function latestBy<T>(rows: readonly T[], stamp: (row: T) => string | null): T | null {
  let best: T | null = null;
  let bestAt: string | null = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      bestAt = stamp(row);
      continue;
    }
    const at = stamp(row);
    if (at && (!bestAt || at > bestAt)) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

function licenseStep(id: string, documents: readonly OnboardingDocument[]): OnboardingStep {
  const fronts = documents.filter(
    (doc) =>
      doc.driver_id === id &&
      doc.is_current === true &&
      doc.category === "license_front" &&
      doc.review_status === "verified",
  );
  const picked = latestBy(fronts, (doc) => text(doc.reviewed_at));
  if (!picked) return makeStep("license_docs", false, null, null);
  return makeStep("license_docs", true, text(picked.source) ?? "Document Vault", text(picked.reviewed_at));
}

function idStep(app: OnboardingApplication, reviews: readonly OnboardingIdentityReview[]): OnboardingStep {
  const mine = reviews.filter((review) => review.application_id === app.id);
  const blocked =
    mine.some((review) => review.status !== "resolved") ||
    mine.some((review) => review.resolution === "different_person");
  if (blocked) return makeStep("id", false, null, null);
  const confirmed = mine.filter((review) => review.status === "resolved" && review.resolution === "same_person");
  const picked = latestBy(confirmed, (review) => text(review.resolved_at));
  if (picked) return makeStep("id", true, text(picked.source) ?? "Identity Review", text(picked.resolved_at));
  if (app.background_check_status === "passed") return makeStep("id", true, "Application", null);
  return makeStep("id", false, null, null);
}

function agreementStep(id: string, agreements: readonly OnboardingAgreement[]): OnboardingStep {
  const signed = agreements.filter((agreement) => {
    if (agreement.application_id !== id) return false;
    if (text(agreement.voided_at) || agreement.status === "voided") return false;
    return agreement.status === "signed" || text(agreement.signed_at) != null;
  });
  const picked = latestBy(signed, (agreement) => text(agreement.signed_at));
  if (!picked) return makeStep("agreement", false, null, null);
  return makeStep("agreement", true, text(picked.source) ?? "Agreement", text(picked.signed_at));
}

function cardStep(app: OnboardingApplication, rentals: readonly OnboardingRental[]): OnboardingStep {
  if (text(app.card_last4) || text(app.stripe_payment_method_id) || text(app.card_on_file_at)) {
    return makeStep("card", true, "Application", text(app.card_on_file_at));
  }
  const mine = rentals.filter(
    (rental) =>
      rental.application_id === app.id &&
      (text(rental.card_last4) || text(rental.stripe_payment_method_id) || text(rental.card_on_file_at)),
  );
  const picked = latestBy(mine, (rental) => text(rental.card_on_file_at));
  if (!picked) return makeStep("card", false, null, null);
  return makeStep("card", true, "Rental", text(picked.card_on_file_at));
}

function paymentReceived(payment: OnboardingPayment): boolean {
  if (payment.type !== "deposit") return false;
  if (payment.status === "void" || payment.status === "waived" || payment.status === "cancelled" || payment.status === "canceled") {
    return false;
  }
  if (payment.status !== "paid" && payment.status !== "refunded") return false;
  const net = money(payment.net_collected);
  const collected = net == null ? money(payment.amount) : net;
  return collected != null && collected > 0;
}

function depositStep(
  app: OnboardingApplication,
  payments: readonly OnboardingPayment[],
  rentals: readonly OnboardingRental[],
): OnboardingStep {
  const paid = payments.filter((payment) => payment.driver_id === app.id && paymentReceived(payment));
  if (paid.length) {
    const dates = paid.map((payment) => text(payment.paid_date)).filter((date): date is string => date != null);
    dates.sort();
    return makeStep("deposit", true, "Payment", dates[0] ?? null);
  }
  const held = rentals.filter((rental) => {
    if (rental.application_id !== app.id) return false;
    if (rental.deposit_held === true) return true;
    return rental.deposit_status != null && RENTAL_DEPOSIT_RECEIVED.has(rental.deposit_status);
  });
  const picked = latestBy(held, (rental) => text(rental.deposit_settled_at));
  if (picked) return makeStep("deposit", true, "Rental", text(picked.deposit_settled_at));
  if (app.deposit_status === "paid" || app.deposit_status === "refunded") {
    return makeStep("deposit", true, "Application", null);
  }
  return makeStep("deposit", false, null, null);
}

function pickupStep(app: OnboardingApplication, rentals: readonly OnboardingRental[]): OnboardingStep {
  const scheduled = text(app.pickup_date);
  if (scheduled) return makeStep("pickup", true, "Application", scheduled);
  const started = rentals.filter((rental) => rental.application_id === app.id && text(rental.start_date));
  const picked = latestBy(started, (rental) => text(rental.start_date));
  if (!picked) return makeStep("pickup", false, null, null);
  return makeStep("pickup", true, "Rental", text(picked.start_date));
}

function vehicleStep(app: OnboardingApplication, rentals: readonly OnboardingRental[]): OnboardingStep {
  const assigned = rentals.filter((rental) => rental.application_id === app.id && text(rental.vehicle_id));
  const picked = latestBy(assigned, (rental) => text(rental.created_at));
  if (picked) return makeStep("vehicle", true, "Rental", text(picked.created_at));
  if (text(app.vehicle_id)) return makeStep("vehicle", true, "Application", null);
  return makeStep("vehicle", false, null, null);
}

function nextMissing(steps: readonly OnboardingStep[]): string {
  return steps.find((step) => !step.done)?.label ?? "Complete";
}

export function buildOnboardingChecklist(input: OnboardingChecklistInput): OnboardingChecklistResult {
  if (input.truncated) return { truncated: true, cap: ONBOARDING_ROW_CAP, drivers: [] };
  const drivers: OnboardingDriver[] = [];
  for (const app of input.applications) {
    if (app.deleted_at || app.status === "duplicate" || !onboardingCohort(app.status)) continue;
    const steps = ONBOARDING_STEP_KEYS.map((key) => {
      if (key === "license_docs") return licenseStep(app.id, input.documents);
      if (key === "id") return idStep(app, input.reviews);
      if (key === "agreement") return agreementStep(app.id, input.agreements);
      if (key === "card") return cardStep(app, input.rentals);
      if (key === "deposit") return depositStep(app, input.payments, input.rentals);
      if (key === "pickup") return pickupStep(app, input.rentals);
      return vehicleStep(app, input.rentals);
    });
    drivers.push({
      id: app.id,
      name: driverName(app.full_name),
      status: app.status,
      steps,
      nextMissingStep: nextMissing(steps),
    });
  }
  return { truncated: false, cap: ONBOARDING_ROW_CAP, drivers };
}
