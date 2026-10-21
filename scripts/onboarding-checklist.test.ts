import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ONBOARDING_CHECKLIST_ENABLED,
  ONBOARDING_ROW_CAP,
  type OnboardingAgreement,
  type OnboardingApplication,
  type OnboardingDocument,
  type OnboardingIdentityReview,
  type OnboardingPayment,
  type OnboardingRental,
} from "../src/lib/onboarding-checklist";
import { ONBOARDING_STEP_LABELS, buildOnboardingChecklist } from "../src/lib/onboarding-checklist-build";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

function app(partial: Partial<OnboardingApplication> & Pick<OnboardingApplication, "id">): OnboardingApplication {
  return {
    full_name: "Ada Lovelace",
    status: "approved",
    deleted_at: null,
    card_last4: null,
    stripe_payment_method_id: null,
    card_on_file_at: null,
    background_check_status: "pending",
    pickup_date: null,
    vehicle_id: null,
    deposit_status: "not_paid",
    ...partial,
  };
}

function build(partial: {
  applications?: OnboardingApplication[];
  documents?: OnboardingDocument[];
  reviews?: OnboardingIdentityReview[];
  agreements?: OnboardingAgreement[];
  payments?: OnboardingPayment[];
  rentals?: OnboardingRental[];
  truncated?: boolean;
}) {
  return buildOnboardingChecklist({
    applications: partial.applications ?? [],
    documents: partial.documents ?? [],
    reviews: partial.reviews ?? [],
    agreements: partial.agreements ?? [],
    payments: partial.payments ?? [],
    rentals: partial.rentals ?? [],
    truncated: partial.truncated ?? false,
  });
}

const completeDocs: OnboardingDocument[] = [
  {
    driver_id: "done",
    category: "license_front",
    review_status: "verified",
    reviewed_at: "2026-04-02T15:00:00.000Z",
    is_current: true,
    source: "upload",
  },
];
const completeReviews: OnboardingIdentityReview[] = [
  {
    application_id: "done",
    status: "resolved",
    resolution: "same_person",
    resolved_at: "2026-04-03T15:00:00.000Z",
    source: "apply",
  },
];
const completeAgreements: OnboardingAgreement[] = [
  {
    application_id: "done",
    status: "signed",
    signed_at: "2026-04-04T15:00:00.000Z",
    voided_at: null,
    source: "esign",
  },
];
const completePayments: OnboardingPayment[] = [
  {
    driver_id: "done",
    type: "deposit",
    status: "paid",
    net_collected: 200,
    amount: 200,
    refunded_amount: 0,
    paid_date: "2026-04-05",
  },
];

describe("onboarding checklist", () => {
  it("declares the flag once, hard false", () => {
    const src = read("src/lib/onboarding-checklist.ts");
    assert.equal(src.match(/export const ONBOARDING_CHECKLIST_ENABLED: boolean = false/g)?.length, 1);
    assert.equal(ONBOARDING_CHECKLIST_ENABLED, false);
    assert.equal(read("src/lib/onboarding-checklist.functions.ts").includes("ONBOARDING_CHECKLIST_ENABLED"), false);
  });

  it("refuses before the role check and before reads", () => {
    const fn = read("src/lib/onboarding-checklist.functions.ts");
    assert.match(fn, /\.middleware\(\[onboardingChecklistGate, requireSupabaseAuth\]\)/);
    const handler = fn.slice(fn.indexOf(".handler("));
    const asserted = handler.indexOf("assertOnboardingChecklistEnabled()");
    const role = handler.indexOf("requireManager(");
    const readFrom = handler.indexOf(".from(");
    const buildImport = handler.indexOf('import("./onboarding-checklist-build")');
    assert.ok(asserted !== -1 && asserted < role && role < readFrom);
    assert.ok(asserted < buildImport);
    const limits = fn.match(/\.limit\([^)]*\)/g) ?? [];
    assert.equal(limits.length, 6);
    assert.ok(limits.every((limit) => limit === ".limit(ONBOARDING_ROW_CAP + 1)"));
    assert.match(fn, /truncated/);
    assert.doesNotMatch(fn, /throw /);
    assert.equal(ONBOARDING_ROW_CAP, 1000);
    assert.doesNotMatch(fn, /\.(insert|update|delete|upsert)\(/);
    assert.doesNotMatch(fn, /process\.env/);
    assert.doesNotMatch(fn, /pickup_at|agreement_signed_at|approved_at/);
  });

  it("extends the drivers screen and does not add a tab", () => {
    const panel = read("src/components/admin/DriversPanel.tsx");
    const ui = read("src/components/admin/OnboardingChecklist.tsx");
    assert.match(panel, /ONBOARDING_CHECKLIST_ENABLED === true && <OnboardingChecklist canView=\{canViewOnboarding\} \/>/);
    assert.match(
      panel,
      /ONBOARDING_CHECKLIST_ENABLED === true && canViewOnboarding && onboardingCohort\(driver\.status\) \? \(\s*<OnboardingChecklist canView=\{canViewOnboarding\} focusId=\{driver\.id\} \/>/,
    );
    const gate = ui.indexOf("if (ONBOARDING_CHECKLIST_ENABLED !== true || canView !== true) return null;");
    const hook = ui.indexOf("useServerFn(getOnboardingChecklist)");
    assert.ok(gate !== -1 && hook !== -1 && gate < hook);
    assert.doesNotMatch(ui, /uppercase|lowercase|capitalize/);
    assert.doesNotMatch(read("src/components/admin/nav-config.ts"), /onboarding/);
    assert.match(read("src/routes/admin.tsx"), /canViewOnboarding=\{tierAllows\(tier, "manager"\)\}/);
    assert.match(ui, /Could Not Load Onboarding Checklist/);
    const failed = ui.indexOf("Could Not Load Onboarding Checklist");
    const empty = ui.indexOf("No Approved Drivers");
    assert.ok(failed !== -1 && empty !== -1 && failed < empty);
  });

  it("records source, time, and the next missing step", () => {
    const result = build({
      applications: [
        app({
          id: "done",
          full_name: "Ada Lovelace",
          card_last4: "4242",
          card_on_file_at: "2026-04-06T15:00:00.000Z",
          pickup_date: "2026-04-07",
          vehicle_id: "veh-app",
        }),
        app({ id: "gap", full_name: "Grace Hopper", status: "active" }),
        app({ id: "closed", status: "closed", full_name: "Closed Driver" }),
        app({ id: "gone", deleted_at: "2026-04-01T00:00:00.000Z" }),
        app({ id: "dupe", status: "duplicate" }),
        app({ id: "new", status: "new" }),
      ],
      documents: [
        ...completeDocs,
        {
          driver_id: "gap",
          category: "license_back",
          review_status: "verified",
          reviewed_at: "2026-04-02T15:00:00.000Z",
          is_current: true,
          source: "upload",
        },
        {
          driver_id: "gap",
          category: "license_front",
          review_status: "uploaded",
          reviewed_at: null,
          is_current: true,
          source: "upload",
        },
        {
          driver_id: "old",
          category: "license_front",
          review_status: "verified",
          reviewed_at: "2026-01-01T00:00:00.000Z",
          is_current: false,
          source: "upload",
        },
      ],
      reviews: [
        ...completeReviews,
        {
          application_id: "gap",
          status: "open",
          resolution: null,
          resolved_at: null,
          source: "apply",
        },
      ],
      agreements: [
        ...completeAgreements,
        {
          application_id: "done",
          status: "voided",
          signed_at: "2026-04-01T00:00:00.000Z",
          voided_at: "2026-04-02T00:00:00.000Z",
          source: "esign",
        },
        {
          application_id: "gap",
          status: "sent",
          signed_at: null,
          voided_at: null,
          source: "esign",
        },
      ],
      payments: [
        ...completePayments,
        {
          driver_id: "done",
          type: "rent",
          status: "paid",
          net_collected: 350,
          amount: 350,
          refunded_amount: 0,
          paid_date: "2026-04-01",
        },
        {
          driver_id: "gap",
          type: "deposit",
          status: "void",
          net_collected: 200,
          amount: 200,
          refunded_amount: 0,
          paid_date: "2026-04-05",
        },
      ],
      rentals: [
        {
          application_id: "done",
          vehicle_id: "veh-rental",
          created_at: "2026-04-08T15:00:00.000Z",
          start_date: "2026-04-09",
          deposit_held: true,
          deposit_status: "held",
          deposit_settled_at: null,
          card_last4: null,
          stripe_payment_method_id: null,
          card_on_file_at: null,
        },
      ],
    });
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.drivers.map((driver) => driver.id),
      ["done", "gap", "closed"],
    );
    const done = result.drivers[0];
    assert.deepEqual(
      done.steps.map((step) => step.key),
      ["license_docs", "id", "agreement", "card", "deposit", "pickup", "vehicle"],
    );
    assert.equal(done.nextMissingStep, "Complete");
    assert.deepEqual(done.steps.map((step) => [step.label, step.done, step.source, step.at]), [
      ["License Docs Verified", true, "upload", "2026-04-02T15:00:00.000Z"],
      ["ID Verified", true, "apply", "2026-04-03T15:00:00.000Z"],
      ["Agreement Signed", true, "esign", "2026-04-04T15:00:00.000Z"],
      ["Card On File", true, "Application", "2026-04-06T15:00:00.000Z"],
      ["Deposit Received", true, "Payment", "2026-04-05"],
      ["Pickup Scheduled", true, "Application", "2026-04-07"],
      ["Vehicle Assigned", true, "Rental", "2026-04-08T15:00:00.000Z"],
    ]);
    const gap = result.drivers[1];
    assert.equal(gap.steps.every((step) => step.done === false && step.source == null && step.at == null), true);
    assert.equal(gap.nextMissingStep, ONBOARDING_STEP_LABELS.license_docs);
    assert.equal(result.drivers[2].name, "Closed Driver");
  });

  it("uses background clearance, rental card, and rental start only when that is the record", () => {
    const result = build({
      applications: [
        app({
          id: "bg",
          background_check_status: "passed",
          card_last4: "1111",
          deposit_status: "partially_paid",
        }),
        app({ id: "rental", full_name: "  " }),
        app({ id: "diff", background_check_status: "passed" }),
      ],
      reviews: [
        {
          application_id: "diff",
          status: "resolved",
          resolution: "different_person",
          resolved_at: "2026-04-03T15:00:00.000Z",
          source: "apply",
        },
      ],
      rentals: [
        {
          application_id: "rental",
          vehicle_id: null,
          created_at: "2026-04-08T15:00:00.000Z",
          start_date: "2026-05-01",
          deposit_held: false,
          deposit_status: "refunded",
          deposit_settled_at: "2026-06-01T15:00:00.000Z",
          card_last4: "9999",
          stripe_payment_method_id: null,
          card_on_file_at: null,
        },
      ],
    });
    const bg = result.drivers[0];
    const id = bg.steps.find((step) => step.key === "id");
    const card = bg.steps.find((step) => step.key === "card");
    const deposit = bg.steps.find((step) => step.key === "deposit");
    assert.deepEqual([id?.done, id?.source, id?.at], [true, "Application", null]);
    assert.deepEqual([card?.done, card?.source, card?.at], [true, "Application", null]);
    assert.equal(deposit?.done, false);
    assert.equal(bg.nextMissingStep, "License Docs Verified");
    const rental = result.drivers[1];
    assert.equal(rental.name, "Unnamed Driver");
    assert.deepEqual(
      rental.steps.filter((step) => step.done).map((step) => [step.key, step.source, step.at]),
      [
        ["card", "Rental", null],
        ["deposit", "Rental", "2026-06-01T15:00:00.000Z"],
        ["pickup", "Rental", "2026-05-01"],
      ],
    );
    assert.equal(rental.nextMissingStep, "License Docs Verified");
    const diff = result.drivers[2].steps.find((step) => step.key === "id");
    assert.equal(diff?.done, false);
  });

  it("drops every step when a read overflowed", () => {
    const result = build({
      applications: [app({ id: "done", card_last4: "4242", pickup_date: "2026-04-07", vehicle_id: "veh" })],
      documents: completeDocs,
      reviews: completeReviews,
      agreements: completeAgreements,
      payments: completePayments,
      truncated: true,
    });
    assert.deepEqual(result, { truncated: true, cap: 1000, drivers: [] });
  });
});
