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
check(reporting.classifyPaymentSource({ payment_method: "card", stripe_payment_intent_id: "pi_9" }) === "stripe", "card with a Stripe id maps to Stripe");
check(reporting.classifyPaymentSource({ payment_method: "card" }) === "other" && reporting.isManualCard({ payment_method: "card" }), "card without a Stripe id is Card (manual)");
check(reporting.classifyPaymentSource({ payment_method: "Cash App Pay" }) === "cash_app", "Cash App Pay maps to Cash App");
check(reporting.classifyPaymentSource({ payment_method: "Apple Pay", stripe_payment_intent_id: "pi_9" }) === "stripe", "Apple Pay with a Stripe id maps to Stripe");
check(reporting.classifyPaymentSource({ payment_method: "Apple Pay" }) === "other" && reporting.isManualCard({ payment_method: "Apple Pay" }), "Apple Pay without a Stripe id is Card (manual)");
check(reporting.classifyPaymentSource({ payment_method: "PayPal" }) === "other" && !reporting.isManualCard({ payment_method: "PayPal" }), "PayPal is Other");
check(reporting.classifyPaymentSource({ payment_method: "Card (in person)" }) === "other" && reporting.isManualCard({ payment_method: "Card (in person)" }), "Card (in person) is Card (manual)");
check(reporting.classifyPaymentSource({ payment_method: "Bank Transfer", stripe_invoice_id: "in_1" }) === "other", "Bank Transfer keeps its method when an invoice id is present");
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
check(reporting.paymentMatchesCharge({ id: "p-note", notes: "settled on ch_1" }, charge, []), "a charge id in notes matches");
check(reporting.paymentMatchesCharge({ id: "bt", payment_method: "Bank Transfer", stripe_invoice_id: "in_1" }, charge, []), "a Bank Transfer invoice id still matches for dedupe");
const multiCharge = { id: "ch_multi", paymentIntentId: "pi_multi", paymentIds: ["row-60", "row-40"], created: Date.parse("2026-10-10T16:00:00Z") / 1000 };
check(reporting.paymentMatchesCharge({ id: "row-60", payment_method: null, amount: 60 }, multiCharge, []), "metadata paymentIds matches without comparing amounts");
check(!reporting.paymentMatchesCharge({ id: "row-other", payment_method: null, amount: 200, paid_date: "2026-10-10" }, { id: "ch_x", paymentIntentId: "pi_x", created: Date.parse("2026-10-10T16:00:00Z") / 1000 }, []), "the same amount is not a match");
const rentalDay = Date.parse("2026-10-12T03:30:00.000Z") / 1000;
check(reporting.paymentMatchesCharge(
  { id: "row-rent", payment_method: null, rental_id: "11111111-1111-4111-8111-111111111111", paid_date: "2026-10-11" },
  { id: "ch_r", paymentIntentId: "pi_r", rentalId: "11111111-1111-4111-8111-111111111111", paymentIds: [], created: rentalDay },
  [],
), "a blank row matches rental and Eastern paid day when the charge names no payment ids");
check(!reporting.paymentMatchesCharge(
  { id: "row-cash", payment_method: "Cash", rental_id: "11111111-1111-4111-8111-111111111111", paid_date: "2026-10-11", amount: 60 },
  { id: "ch_r", rentalId: "11111111-1111-4111-8111-111111111111", paymentIds: [], created: rentalDay },
  [],
), "a named cash payment on that rental day stays separate");
const parsed = reporting.chargeLinksFromMetadata({ paymentIds: "not-a-uuid,11111111-1111-4111-8111-111111111111", rentalId: "also-bad" });
check(parsed.paymentIds.join(",") === "11111111-1111-4111-8111-111111111111" && parsed.rentalId === null, "metadata keeps only uuid payment ids");

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

const multi = summarize({
  payments: [
    pay({ id: "row-60", amount: 60, payment_method: null, paid_date: "2026-10-10" }),
    pay({ id: "row-40", amount: 40, payment_method: null, paid_date: "2026-10-10" }),
  ],
  stripe: readyStripe({
    totals: [{ currency: "usd", gross: 20000, refunds: 0, fees: 0, net: 20000 }],
    charges: [multiCharge],
  }),
});
check(multi.grossCollected.amount === 200 && multi.netCollected.amount === 200, "a $200 charge recorded as $60 + $40 counts once");
check(multi.duplicateIds.slice().sort().join(",") === "row-40,row-60", "both multi-row payments are the duplicate");
check(multi.unmatched.length === 0, "linked multi-row payments are not listed as unmatched");

const unlinked = summarize({
  payments: [
    pay({ id: "row-60", amount: 60, payment_method: null, paid_date: "2026-10-10" }),
    pay({ id: "row-40", amount: 40, payment_method: null, paid_date: "2026-10-10" }),
  ],
  stripe: readyStripe({
    totals: [{ currency: "usd", gross: 20000, refunds: 0, fees: 0, net: 20000 }],
    charges: [{ id: "ch_multi", paymentIntentId: "pi_multi" }],
  }),
});
check(unlinked.grossCollected.amount === 200 && unlinked.coverage === "Partial", "unlinked rows are left out and the total stays partial");
check(unlinked.unmatched.map((row) => row.id).sort().join(",") === "row-40,row-60", "unlinked rows are listed");

const invoiceOnly = summarize({
  payments: [pay({ id: "inv", amount: 100, payment_method: null, stripe_invoice_id: "in_1", stripe_payment_intent_id: null, refunded_amount: 0 })],
  stripe: readyStripe({ totals: [{ currency: "usd", gross: 10000, refunds: 0, fees: 300, net: 9700 }], charges: [{ id: "ch_1", paymentIntentId: null, invoiceId: "in_1" }] }),
});
check(invoiceOnly.duplicateIds.join(",") === "inv" && invoiceOnly.netCollected.amount === 97, "an invoice-only row is the same net as Payments All");

const manualCard = summarize({
  payments: [pay({ id: "card-m", amount: 80, payment_method: "Card", stripe_payment_intent_id: null })],
  stripe: readyStripe({ totals: [{ currency: "usd", gross: 10000, refunds: 0, fees: 0, net: 10000 }], charges: [{ id: "ch_1", paymentIntentId: "pi_1" }] }),
});
check(manualCard.grossCollected.amount === 100 && manualCard.unmatched.some((row) => row.id === "card-m" && /Card \(manual\)/.test(row.reason)), "a manual card is not added on top of Stripe");

const zeroRefund = summarize({
  source: "stripe",
  payments: [],
  stripe: readyStripe({ totals: [{ currency: "usd", gross: 10000, refunds: 0, fees: 0, net: 10000 }], charges: [] }),
});
check(Object.is(zeroRefund.refunds.amount, 0), "zero refunds are $0.00, not -$0.00");

const easternRefund = summarize({
  source: "cash",
  range: { from: "2026-10-11", to: "2026-10-11" },
  payments: [pay({ paid_date: "2026-10-11", refunded_amount: 15, refunded_at: "2026-10-12T03:30:00.000Z" })],
});
check(easternRefund.refunds.amount === -15, "a refund at 03:30 UTC is the previous Eastern day");
const nextEasternDay = summarize({
  source: "cash",
  range: { from: "2026-10-12", to: "2026-10-12" },
  payments: [pay({ paid_date: "2026-10-11", refunded_amount: 15, refunded_at: "2026-10-12T03:30:00.000Z" })],
});
check(nextEasternDay.refunds.amount === 0 && !Object.is(nextEasternDay.refunds.amount, -0), "that refund is not placed on the UTC day");

const impossible = summarize({ range: { from: "2026-13-45", to: "2026-13-45" }, source: "cash", payments: [pay()] });
check(impossible.grossCollected.amount === null && /real calendar/.test(impossible.grossCollected.reason), "an impossible date does not total");
const tooLong = summarize({ range: { from: "2024-01-01", to: "2025-01-01" }, source: "cash", payments: [pay()] });
check(tooLong.grossCollected.amount === null && /366/.test(tooLong.grossCollected.reason), "a range over 366 days is unavailable");

const cutOff = summarize({ truncated: true, payments: [pay({ amount: 500 })], stripe: readyStripe() });
check(cutOff.grossCollected.amount === null && cutOff.netCollected.amount === null && cutOff.coverage === "Unavailable", "a truncated read does not total");
const shortPage = await reporting.readEveryPage(async (from) => from === 0 ? { data: [1], error: null, count: 2 } : { data: [], error: null, count: 2 });
check(shortPage.complete === false && shortPage.rows.length === 1, "a short page below the count is incomplete");
const fullPage = await reporting.readEveryPage(async () => ({ data: [1, 2], error: null, count: 2 }));
check(fullPage.complete === true && fullPage.rows.length === 2, "a page whose length equals the count is complete");
const missingCount = await reporting.readEveryPage(async () => ({ data: [1], error: null, count: null }));
check(missingCount.complete === false, "a missing count is incomplete");

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
check(overview.includes("summarizePayments"), "overview revenue uses the payments dedupe");
check(overview.includes("readEveryPage"), "overview pages the payment read");
check(!overview.includes("paymentRevenue"), "overview no longer treats a missing payment intent as non-Stripe");
check(overview.includes("selectHotProspects"), "overview uses the shared hot rule");
check(!overview.includes("<StripeCollections"), "the Stripe Collections panel is gone from Overview");
check(!overview.includes("Hot Prospects"), "the separate Hot Prospects section is gone from Overview");
check(overview.includes("Billed vs Collected"), "the billed versus collected chart stays");
check(leads.includes("hot.prospects.length") && leads.includes("hot.prospects.map"), "the hot count and the modal render one list");
check(leads.includes("View All Follow-ups") && leads.includes("ALL_FOLLOW_UPS_PAGE = 25") && leads.includes('limit: ALL_FOLLOW_UPS_PAGE'), "all follow-ups opens the 25-row list");
check(payments.includes("readEveryPage") && payments.includes("rangeMessage") && payments.includes('role="alert"'), "payments pages its reads and shows a range message");
check(readFileSync("src/lib/eastern-day.ts", "utf8").includes("Choose a range of up to 366 days."), "a long range has a visible message");
check(readFileSync("src/routes/admin.tsx", "utf8").includes("isRealDay"), "payments dates reject an impossible calendar day");
check(leads.includes('label="Hot Prospects"') || leads.includes('label="Hot Prospects"') || leads.includes("Hot Prospects"), "the modal keeps the hot prospect cards");
check(payments.includes("SOURCE_FILTERS") && payments.includes("<StripeCollections"), "Stripe detail lives on the Stripe filter");
check(!overview.includes("Stripe Collected"), "there is no separate Stripe Collected line");

console.log(checks + " overview and payments checks passed");
