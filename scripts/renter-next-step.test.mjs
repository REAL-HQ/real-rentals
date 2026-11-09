/**
 * Renter profile Next Step: which ONE action leads, which blockers show and
 * where each fix opens. Model + server-rendered card; no browser, no database,
 * no server calls, nothing is activated, charged or sent.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { nextStep } = await import("../src/lib/next-step.ts");
const { NextStepCard } = await import("../src/components/admin/NextStepCard.tsx");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("PASS", name); };
const req = (key, met, enforcement = "hard", extra = {}) => ({ key, label: key, met, enforcement, ...extra });
const readiness = (requirements) => ({ ready: false, blockers: [], warnings: [], requirements, insurance: { status: "unverified", exceptionAllowed: false, settingPresent: true, settingReadable: true }, vehicleId: null, suggestedWeeklyRate: null, suggestedDeposit: null, inspectionMileage: null, currentMileage: null });
const base = { step: "activate", entry: "enabled", readiness: null, loading: false, failed: false };
const render = (model, r = null) => renderToStaticMarkup(h(NextStepCard, { model, readiness: r, onRun() {}, onActivate() {}, onRetry() {} }));

// Schrita/Damon/Regina shape: approved, agreement + docs fine, insurance NOT verified.
const noInsurance = readiness([req("approved", true), req("signed_agreement", true), req("license_documents", true), req("insurance_verified", false, "hard", { detail: "Unverified" }), req("interview", true, "soft"), req("inspection", null, "soft"), req("insurance_document", false, "advisory")]);

t("blocked on insurance: primary opens the insurance card, not activation", () => {
  const m = nextStep({ ...base, readiness: noInsurance });
  assert.equal(m.activation, "blocked");
  assert.equal(m.label, "Verify Insurance");
  assert.deepEqual(m.target, { kind: "section", tab: "screening", anchor: "profile-insurance" });
  assert.deepEqual(m.blockers.map((b) => b.key), ["insurance_verified"], "advisory and soft items are not blockers");
});
t("blocked card still shows Activate Rental (findable) and names the blocker with its fix", () => {
  const html = render(nextStep({ ...base, readiness: noInsurance }), noInsurance);
  assert.match(html, /data-activation="blocked"/);
  assert.match(html, />(<svg[^]*?<\/svg>)? ?Activate Rental<\/button>/);
  assert.match(html, /data-blocker="insurance_verified"[^]*Verify Insurance/);
  assert.equal((html.match(/data-requirement="insurance_verified"/g) ?? []).length, 1);
  assert.equal((html.match(/data-requirement="license_documents"/g) ?? []).length, 1);
  assert.equal((html.match(/data-requirement="signed_agreement"/g) ?? []).length, 1);
  assert.equal((html.match(/data-requirement="insurance_document"/g) ?? []).length, 0);
});
t("blockers ordered: documents, insurance, approval, agreement", () => {
  const r = readiness([req("signed_agreement", false), req("approved", false), req("insurance_verified", false), req("license_documents", false)]);
  const m = nextStep({ ...base, step: "documents", readiness: r });
  assert.deepEqual(m.blockers.map((b) => b.key), ["license_documents", "insurance_verified", "approved", "signed_agreement"]);
  assert.equal(m.label, "Review Documents");
  assert.equal(m.blockers.find((b) => b.key === "approved").target.kind, "approve");
  assert.equal(m.blockers.find((b) => b.key === "signed_agreement").target.anchor, "profile-agreements");
});
t("ready: Activate Rental is the one primary; no duplicate secondary", () => {
  const r = readiness([req("approved", true), req("insurance_verified", true), req("interview", false, "soft")]);
  const m = nextStep({ ...base, readiness: r });
  assert.equal(m.activation, "ready");
  assert.deepEqual(m.target, { kind: "activate" });
  const html = render(m, r);
  assert.equal((html.match(/Activate Rental<\/button>/g) ?? []).length, 1);
});
t("interview unfinished still comes first", () => {
  const m = nextStep({ ...base, step: "interview", readiness: noInsurance });
  assert.deepEqual(m.target, { kind: "record_call" });
  assert.equal(m.blockers[1].key, "insurance_verified");
});
t("loading: primary disabled, Activate Rental disabled, no fake checklist", () => {
  const m = nextStep({ ...base, loading: true });
  assert.equal(m.activation, "checking");
  assert.equal(m.busy, true);
  const html = render(m);
  assert.doesNotMatch(html, /next-step-primary/, "no guessed primary while checking");
  assert.match(html, /<button type="button" disabled=""[^>]*>(<svg[^]*?<\/svg>)? ?Activate Rental/, "Activate Rental visible but disabled until checked");
  assert.doesNotMatch(html, /Full Checklist/);
});
t("failure: says so, offers Retry, Activate Rental re-checks on open", () => {
  const m = nextStep({ ...base, failed: true });
  assert.equal(m.activation, "unknown");
  assert.deepEqual(m.target, { kind: "activate" });
  const html = render(m);
  assert.match(html, /role="alert"[^>]*>Couldn&#x27;t check readiness/);
  assert.match(html, />(<svg[^]*?<\/svg>)? ?Retry<\/button>/);
});
t("before the server answers, an unapproved renter is never offered Activate", () => {
  const m = nextStep({ ...base, step: "insurance", loading: true });
  assert.equal(m.label, "Verify Insurance");
  assert.equal(nextStep({ ...base, step: "approve", failed: true }).target.kind, "approve");
});
t("Coordinator: never gets an Activate action; disabled entry with an explanation", () => {
  const m = nextStep({ ...base, entry: "manager_only", step: "view_rental", readiness: noInsurance });
  assert.equal(m.activation, "manager_only");
  assert.notEqual(m.target.kind, "activate");
  const html = render(m);
  assert.match(html, /disabled="" title="Only a Manager or Owner can start a rental"/);
  assert.match(html, /Ready for a Manager or Owner to start the rental\./);
  const local = nextStep({ ...base, entry: "manager_only", step: "insurance" });
  assert.equal(local.label, "Verify Insurance");
});
t("rental running: card hidden, header says View Rental", () => {
  const m = nextStep({ ...base, entry: "rental_active", readiness: noInsurance });
  assert.equal(m.label, "View Rental");
  assert.equal(render(m), "");
});
t("responsive controls: same 36px height, full width on a phone", () => {
  const html = render(nextStep({ ...base, readiness: noInsurance }), noInsurance);
  assert.match(html, /max-sm:w-full/);
  assert.match(html, /h-9[^"]*max-sm:flex-1|max-sm:flex-1[^"]*h-9/);
});
t("wiring: header and card share the model; fixes open the exact card; guards stay", () => {
  const p = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  assert.match(p, /const next = nextStep\(\{/);
  assert.match(p, /onClick: \(\) => runTarget\(next\.target\)/);
  for (const id of ["profile-insurance", "profile-documents", "profile-agreements", "profile-vehicle"]) assert.match(p, new RegExp(`id="${id}"`));
  assert.match(p, /if \(approving\) return;/);
  assert.match(p, /if \(activationEntry !== "enabled" \|\| activateOpen\) return;/, "readiness only fetched for Manager+");
  assert.equal((p.match(/<ActivateRentalDialog/g) ?? []).length, 1);
  assert.doesNotMatch(p, /StartRentalCard/);
  const d = readFileSync("src/components/admin/ActivateRentalDialog.tsx", "utf8");
  assert.match(d, /async function submit\(\) \{\n    if \(!canSubmit\) return;/);
  assert.match(d, /const canSubmit = !busy && submitIssues.length === 0;/);
  assert.match(d, /const fresh = await check\(/, "server re-check on submit failure is kept");
  const lib = readFileSync("src/lib/next-step.ts", "utf8");
  assert.doesNotMatch(lib, /supabase|insurance_verified\s*[:=]\s*true|status:\s*"active"/, "the model writes nothing");
});
console.log(`${n} renter next step checks passed`);
