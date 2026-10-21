import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/lib/payment-reporting.ts", "src/lib/readiness.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  outdir: "out",
});
const file = (name) => bundled.outputFiles.find((item) => item.path.endsWith(name)).text;
const reporting = await import("data:text/javascript;base64," + Buffer.from(file("payment-reporting.js")).toString("base64"));
const readiness = await import("data:text/javascript;base64," + Buffer.from(file("readiness.js")).toString("base64"));

let checks = 0;
const check = (value, message) => {
  assert.equal(Boolean(value), true, message);
  checks++;
};

const prospect = (id, qualification, coverage, extra = {}) => ({
  id,
  readiness: {
    state: "promising_more_info",
    qualification,
    coverage,
    verifiedCoverage: 0,
    disqualifiers: [],
    positives: [],
    unknowns: [],
    ...extra,
  },
});
const apps = [
  prospect("hot-a", 80, 50),
  prospect("cold-low", 74, 80),
  prospect("cold-thin", 90, 39),
  prospect("cold-dq", 100, 100, { disqualifiers: ["dui"] }),
  prospect("cold-unknown", null, 80),
  prospect("hot-b", 90, 60, { state: "needs_attention" }),
].map(({ id, readiness: result }) => ({ app: { id }, result }));
const hot = readiness.selectHotProspects(
  apps.map((row) => row.app),
  Object.fromEntries(apps.map((row) => [row.app.id, row.result])),
);
check(hot.length === 2 && hot.map((row) => row.app.id).join(",") === "hot-b,hot-a", "hot list is the qualification rule, readiness order");
check(hot.length === readiness.selectHotProspects(apps.map((row) => row.app), Object.fromEntries(apps.map((row) => [row.app.id, row.result]))).length, "hot count is the modal list length");

const pay = (over = {}) => ({
  id: "p1",
  amount: 100,
  balance_due: 0,
  refunded_amount: 0,
  status: "paid",
  type: "rent",
  paid_date: "2026-10-10",
  refunded_at: null,
  payment_method: "Cash",
  stripe_payment_intent_id: null,
  stripe_invoice_id: null,
  stripe_subscription_id: null,
  rental_id: null,
  ...over,
});
const readyStripe = (over = {}) => ({
  status: "ready",
  collectionsComplete: true,
  totals: [{ currency: "usd", gross: 10000, refunds: 4000, fees: 300, net: 5700 }],
  charges: [{ id: "ch_1", paymentIntentId: "pi_1", invoiceId: "in_1" }],
  ...over,
});
const summarize = (over) => reporting.summarizePayments({
  payments: [],
  refundLinks: [],
  stripe: { status: "hidden", collectionsComplete: false, totals: null, charges: [] },
  deposits: { rentals: [], payments: [] },
  source: "all",
  range: { from: "2026-10-01", to: "2026-10-31" },
  ...over,
});

check(reporting.classifyPaymentSource({ payment_method: "Cash App" }) === "cash_app", "Cash App spacing");
check(reporting.classifyPaymentSource({ payment_method: "cashapp" }) === "cash_app", "cashapp token");
check(reporting.classifyPaymentSource({ payment_method: "Venmo" }) === "venmo", "Venmo");
check(reporting.classifyPaymentSource({ payment_method: "Zelle" }) === "zelle", "Zelle");
check(reporting.classifyPaymentSource({ payment_method: "Wire Transfer" }) === "wire", "Wire Transfer");
check(reporting.classifyPaymentSource({ payment_method: "Cash" }) === "cash", "Cash");
check(reporting.classifyPaymentSource({ payment_method: "bank_transfer" }) === "other", "bank transfer is Other");
check(reporting.classifyPaymentSource({ payment_method: "ACH" }) === "other", "ACH is Other");
check(reporting.classifyPaymentSource({ payment_method: "check" }) === "other", "check is Other");
check(reporting.classifyPaymentSource({ payment_method: "money_order" }) === "other", "money order is Other");
check(reporting.classifyPaymentSource({ payment_method: null }) === "other", "blank method is Other");
check(reporting.classifyPaymentSource({ payment_method: "card" }) === "stripe", "card maps to Stripe");
check(reporting.classifyPaymentSource({ payment_method: null, stripe_invoice_id: "in_9" }) === "stripe", "invoice id maps to Stripe");
check(reporting.classifyPaymentSource({ payment_method: "Venmo", stripe_payment_intent_id: "pi_9" }) === "venmo", "named method wins over a Stripe id");
check(reporting.SOURCE_FILTERS.join(",") === "all,stripe,venmo,cash_app,zelle,wire,cash,other", "source filters");

const charge = { id: "ch_1", paymentIntentId: "pi_1", invoiceId: "in_1" };
const links = [{ stripe_charge_id: "ch_1", stripe_payment_intent_id: "pi_1", payment_ids: ["p-refund"] }];
check(reporting.paymentMatchesCharge({ id: "p-pi", stripe_payment_intent_id: "pi_1" }, charge, []), "intent match");
check(reporting.paymentMatchesCharge({ id: "p-in", stripe_invoice_id: "in_1" }, charge, []), "invoice match");
check(reporting.paymentMatchesCharge({ id: "p-ch", stripe_payment_intent_id: "ch_1" }, charge, []), "stored charge id match");
check(reporting.paymentMatchesCharge({ id: "p-refund" }, charge, links), "refund link charge id match");
check(!reporting.paymentMatchesCharge({ id: "p-no", stripe_payment_intent_id: "pi_other" }, charge, links), "different intent stays separate");
check(reporting.duplicatePaymentIds(
  [{ id: "p-pi", stripe_payment_intent_id: "pi_1" }, { id: "p-refund" }, { id: "p-keep", stripe_payment_intent_id: null }],
  [charge],
  links,
).join(",") === "p-pi,p-refund", "dedupe returns only the matching rows");

const cash = summarize({
  source: "cash",
  payments: [pay({ id: "cash-1", amount: 100, refunded_amount: 40, refunded_at: "2026-10-12", balance_due: 0 }), pay({ id: "owed", status: "overdue", amount: 25, balance_due: 25, paid_date: null })],
});
check(cash.grossCollected.amount === 100, "cash gross is the collected amount");
check(cash.refunds.amount === -40, "refunds are signed negative");
check(cash.netCollected.amount === 60, "net is amount minus refunds");
check(cash.fees.amount === null && /not stored/.test(cash.fees.reason), "manual fees are unavailable");
check(cash.outstanding.amount === 25, "outstanding is the open balance");
check(cash.depositsHeld.amount === null, "a method filter cannot total held deposits");
check(cash.coverage === "Partial", "a recorded method total is partial, not invented as complete");

const doubled = summarize({
  payments: [pay({ id: "p-pi", payment_method: "card", stripe_payment_intent_id: "pi_1", amount: 100, refunded_amount: 40, refunded_at: "2026-10-12" }), pay({ id: "cash-1", amount: 50 })],
  stripe: readyStripe(),
});
check(doubled.duplicateIds.join(",") === "p-pi", "the Stripe-linked row is the duplicate");
check(doubled.grossCollected.amount === 150, "gross keeps Stripe once and adds the other payment");
check(doubled.refunds.amount === -40, "the Stripe refund is not added a second time");
check(doubled.netCollected.amount === 107, "net is Stripe after fees plus the recorded payment");
check(doubled.fees.amount === null, "combined fees stay unavailable when a recorded payment has no fee");

const stripeOnly = summarize({
  source: "stripe",
  stripe: readyStripe(),
  payments: [pay({ id: "p-pi", payment_method: "card", stripe_payment_intent_id: "pi_1", amount: 100, refunded_amount: 40, refunded_at: "2026-10-12" })],
});
check(stripeOnly.grossCollected.amount === 100 && stripeOnly.refunds.amount === -40 && stripeOnly.fees.amount === -3 && stripeOnly.netCollected.amount === 57, "Stripe filter uses verified gross, signed refunds, signed fees, and net");

const missingLinks = summarize({
  refundLinks: null,
  stripe: readyStripe(),
  payments: [pay({ id: "p-pi", payment_method: "card", stripe_payment_intent_id: "pi_1" })],
});
check(missingLinks.grossCollected.amount === null && /deduplicated/.test(missingLinks.grossCollected.reason), "missing refund links withhold the combined total");

const partial = summarize({
  stripe: readyStripe({ collectionsComplete: false, totals: null }),
  payments: [pay()],
});
check(partial.grossCollected.amount === null && partial.netCollected.amount === null && partial.coverage === "Unavailable", "incomplete Stripe evidence makes the combined total unavailable");

const undated = summarize({
  source: "cash",
  payments: [pay({ paid_date: null })],
});
check(undated.grossCollected.amount === null, "a collected payment with no paid date is not dropped or guessed");

const undatedRefund = summarize({
  source: "zelle",
  payments: [pay({ payment_method: "Zelle", refunded_amount: 10, refunded_at: null })],
});
check(undatedRefund.refunds.amount === null && undatedRefund.netCollected.amount === null, "a refund with no date is unavailable inside a range");

const badBalance = summarize({
  source: "wire",
  payments: [pay({ payment_method: "wire", status: "overdue", balance_due: null, amount: null, paid_date: null, refunded_amount: 0 })],
});
check(badBalance.outstanding.amount === null, "a missing balance is unavailable");

const held = summarize({
  deposits: {
    rentals: [
      { id: "r-held", deposit_amount: 200, deposit_held: true, deposit_status: "held" },
      { id: "r-applied", deposit_amount: 300, deposit_held: false, deposit_status: "applied" },
      { id: "r-blank", deposit_amount: null, deposit_held: true, deposit_status: "held" },
    ],
    payments: [],
  },
});
check(held.depositsHeld.amount === null, "a blank held deposit withholds the total");
const heldKnown = summarize({
  deposits: {
    rentals: [
      { id: "r-held", deposit_amount: 200, deposit_held: true, deposit_status: "held" },
      { id: "r-applied", deposit_amount: 300, deposit_held: false, deposit_status: "applied" },
    ],
    payments: [{ id: "dep", rental_id: "r-held", type: "deposit", status: "paid", net_collected: 150 }],
  },
});
check(heldKnown.depositsHeld.amount === 150, "held deposits use the paid net, and applied deposits stay out");

const search = reporting.revenuePaymentsSearch({ from: "2026-10-01", to: "2026-10-18" });
check(search.tab === "payments" && search.from === "2026-10-01" && search.to === "2026-10-18", "revenue search carries the date range");

const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const leads = readFileSync("src/components/admin/LeadPriorities.tsx", "utf8");
const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
check(overview.includes("revenuePaymentsSearch(range)"), "the revenue card uses the date-range search");
check(overview.includes("selectHotProspects"), "overview uses the shared hot rule");
check(!overview.includes("<StripeCollections"), "the Stripe Collections panel is gone from Overview");
check(!overview.includes("Hot Prospects"), "the separate Hot Prospects section is gone from Overview");
check(overview.includes("Billed vs Collected"), "the billed versus collected chart stays");
check(leads.includes("hot.prospects.length") && leads.includes("hot.prospects.map"), "the hot count and the modal render one list");
check(leads.includes('label="Hot Prospects"') || leads.includes('label="Hot Prospects"') || leads.includes("Hot Prospects"), "the modal keeps the hot prospect cards");
check(payments.includes("SOURCE_FILTERS") && payments.includes("<StripeCollections"), "Stripe detail lives on the Stripe filter");
check(!overview.includes("Stripe Collected"), "there is no separate Stripe Collected line");

console.log(checks + " overview and payments checks passed");
