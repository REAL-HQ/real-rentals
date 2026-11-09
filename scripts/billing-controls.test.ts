import { readFileSync } from "node:fs";
import {
  BILLING_DAY_APPLY_ENABLED,
  BILLING_DAY_APPLY_OFF,
  BILLING_DAY_CHANGE_ENABLED,
  BILLING_DAY_CHANGE_OFF,
  BILLING_EXTENSION_RECORD_ENABLED,
  BILLING_EXTENSION_RECORD_OFF,
  BILLING_ONE_TIME_EXTENSION_ENABLED,
  BILLING_ONE_TIME_EXTENSION_OFF,
  BILLING_PM_UPDATE_LINK_ENABLED,
  BILLING_PM_UPDATE_LINK_OFF,
} from "../src/lib/billing-controls-flag";
import {
  DRIVER_EMAIL_MISSING,
  PAYMENT_METHOD_EMAIL_SUBJECT,
  PORTAL_NOT_CONFIGURED,
  RENEWAL_INVOICE_EXISTS,
  SUBSCRIPTION_ID_UNCHANGED,
  billingControlsRoleAllowed,
  billingDayApplyBlock,
  billingDayIdempotencyKey,
  billingDefaultRoleAllowed,
  etDate,
  extensionCollectionState,
  extensionCollectionView,
  extensionIdempotencyKey,
  extensionProviderUpdate,
  extensionReadWarning,
  extensionRecordBlock,
  paymentMethodDefaultIdempotencyKey,
  paymentMethodPortalParams,
  portalConfigurationMissing,
  projectBillingDayChange,
  readPreviewLines,
  renewalInvoiceBlocksApply,
  saturdayBillingAnchorUnix,
  verifyPaymentMethod,
  weeklyRateCents,
  withBillingExtensions,
} from "../src/lib/billing-controls";
import {
  runApplyBillingDay,
  runCreatePaymentMethodLink,
  runGrantPaymentExtension,
  runPreviewBillingDay,
  runSendPaymentMethodLink,
  runSetSubscriptionDefault,
  runVerifyPaymentMethod,
} from "../src/lib/billing-controls.server";

let fails = 0;
const ok = (condition: boolean, message: string) => {
  console.log(`${condition ? "  PASS" : "  FAIL"}  ${message}`);
  if (!condition) fails++;
};

const OP = "11111111-1111-4111-8111-111111111111";
const anchor = saturdayBillingAnchorUnix();
const preview = projectBillingDayChange({ weeklyAmountCents: 35000, anchorUnix: anchor, targetWeekday: 1 });

ok(BILLING_PM_UPDATE_LINK_ENABLED === false, "payment method flag stays off");
ok(BILLING_DAY_CHANGE_ENABLED === false, "billing day flag stays off");
ok(BILLING_ONE_TIME_EXTENSION_ENABLED === false, "extension flag stays off");
ok(BILLING_DAY_APPLY_ENABLED === false, "billing day apply stays off");
ok(BILLING_EXTENSION_RECORD_ENABLED === false, "extension recording stays off");
ok(anchor === Date.UTC(2026, 9, 24, 15, 41, 0) / 1000, "Saturday 11:41 ET is 15:41 UTC");
ok(preview.trialEndUnix === Date.UTC(2026, 9, 26, 15, 41, 0) / 1000, "Monday 11:41 ET is 15:41 UTC");
ok(preview.invoices[0]?.kind === "trial" && preview.invoices[0].amountCents === 0 && preview.invoices[0].dateEt === "2026-10-24", "$0 trial invoice is dated on the Saturday anchor");
ok(preview.invoices[1]?.kind === "renewal" && preview.invoices[1].amountCents === 35000 && preview.invoices[1].dateEt === "2026-10-26", "$350 renewal is Monday Oct 26");
ok(preview.invoices[2]?.kind === "renewal" && preview.invoices[2].amountCents === 35000 && preview.invoices[2].dateEt === "2026-11-02", "$350 renewal is Monday Nov 2");
ok(preview.invoices.every((invoice) => invoice.prorations.length === 0 && invoice.creditsCents === 0) && preview.prorations.length === 0, "the Saturday to Monday preview has no proration lines");
ok(!preview.invoices.some((invoice) => invoice.dateEt === "2026-10-24" && invoice.amountCents > 0), "Oct 24 has no charge");
ok(etDate(preview.invoices[2]!.atUnix) === "2026-11-02", "the second weekly renewal stays on Nov 2 across the time change");
ok(preview.gapDays === 2, "Saturday to Monday is two gap days and they are not a charge");

let threw = false;
try { projectBillingDayChange({ weeklyAmountCents: 350.125, anchorUnix: anchor, targetWeekday: 1 }); } catch { threw = true; }
ok(threw, "an unreadable weekly amount is refused");
ok(weeklyRateCents("350.00") === 35000 && weeklyRateCents(0) === 0 && weeklyRateCents("33.335") === null && weeklyRateCents(-1) === null, "weekly rate cents keep a clean amount and leave the rest null");

ok(billingDayApplyBlock({ feature: false, journal: false }) === BILLING_DAY_CHANGE_OFF, "apply refuses the feature flag first");
ok(billingDayApplyBlock({ feature: true, journal: false }) === BILLING_DAY_APPLY_OFF, "apply stays off until the journal exists");
ok(extensionRecordBlock({ feature: false, record: true }) === BILLING_ONE_TIME_EXTENSION_OFF, "extension refuses the feature flag first");
ok(extensionRecordBlock({ feature: true, record: false }) === BILLING_EXTENSION_RECORD_OFF, "extension recording stays off until the table exists");

ok(billingControlsRoleAllowed("owner") && billingControlsRoleAllowed("manager"), "owner and manager can use billing controls");
ok(!billingControlsRoleAllowed("coordinator") && !billingControlsRoleAllowed(null), "a coordinator and a missing role are refused");
ok(billingDefaultRoleAllowed("owner") && !billingDefaultRoleAllowed("manager") && !billingDefaultRoleAllowed("coordinator"), "only an owner can set the subscription default");

const portal = paymentMethodPortalParams("cus_123", "https://drivereal.com/admin");
ok(portal.flow_data.type === "payment_method_update" && portal.customer === "cus_123" && !("configuration" in portal), "the portal session updates the payment method and does not create a configuration");
ok(portalConfigurationMissing(new Error("No configuration provided and the default configuration has not been created")), "a missing portal configuration is recognized");
ok(!portalConfigurationMissing(new Error("card was declined")), "a card decline is not a missing portal configuration");

let portalCalls = 0;
try {
  await runCreatePaymentMethodLink({
    enabled: false,
    environment: "sandbox",
    customerId: "cus_123",
    subscriptionId: "sub_123",
    returnUrl: "https://drivereal.com/admin",
    stripe: { billingPortal: { sessions: { create: async () => { portalCalls += 1; return { id: "bps_1", url: "https://example.test" }; } } } },
  });
  ok(false, "flag-off link creation throws");
} catch (error) {
  ok(error instanceof Error && error.message === BILLING_PM_UPDATE_LINK_OFF && portalCalls === 0, "flag-off link creation throws before Stripe");
}

try {
  await runCreatePaymentMethodLink({
    enabled: true,
    environment: "live",
    customerId: "cus_123",
    subscriptionId: "sub_123",
    returnUrl: "https://drivereal.com/admin",
    stripe: { billingPortal: { sessions: { create: async () => { portalCalls += 1; return { id: "bps_1", url: "https://example.test" }; } } } },
  });
  ok(false, "live Stripe is refused");
} catch (error) {
  ok(error instanceof Error && error.message === "Live Stripe is refused." && portalCalls === 0, "live Stripe is refused before a portal session");
}

try {
  await runCreatePaymentMethodLink({
    enabled: true,
    environment: "sandbox",
    customerId: "cus_123",
    subscriptionId: "sub_123",
    returnUrl: "https://drivereal.com/admin",
    stripe: { billingPortal: { sessions: { create: async () => { throw new Error("No configuration provided and the default configuration has not been created"); } } } },
  });
  ok(false, "missing portal configuration throws");
} catch (error) {
  ok(error instanceof Error && error.message === PORTAL_NOT_CONFIGURED, "missing portal configuration returns Portal not configured");
}

let emails = 0;
try {
  await runSendPaymentMethodLink({
    enabled: true,
    environment: "sandbox",
    customerId: "cus_123",
    subscriptionId: "sub_123",
    returnUrl: "https://drivereal.com/admin",
    email: null,
    rentalId: "rental",
    stripe: { billingPortal: { sessions: { create: async () => { portalCalls += 1; return { id: "bps_1", url: "https://example.test/portal" }; } } } },
    sendEmail: async () => { emails += 1; return { ok: true }; },
  });
  ok(false, "missing driver email throws");
} catch (error) {
  ok(error instanceof Error && error.message === DRIVER_EMAIL_MISSING && portalCalls === 0 && emails === 0, "a missing driver email does not create or send a link");
}

const sent = await runSendPaymentMethodLink({
  enabled: true,
  environment: "sandbox",
  customerId: "cus_123",
  subscriptionId: "sub_123",
  returnUrl: "https://drivereal.com/admin",
  email: "driver@example.com",
  rentalId: "rental",
  stripe: { billingPortal: { sessions: { create: async () => ({ id: "bps_9", url: "https://example.test/portal" }) } } },
  sendEmail: async (message) => {
    emails += 1;
    ok(message.subject === PAYMENT_METHOD_EMAIL_SUBJECT && message.to === "driver@example.com" && !message.idempotencyKey.includes("example.test"), "send uses the payment method subject and does not put the link token in the idempotency key");
    return { ok: true };
  },
});
ok(sent.sent === true && emails === 1, "send link emails once and copy is a separate call");

const verified = await runVerifyPaymentMethod({
  enabled: true,
  environment: "sandbox",
  customerId: "cus_123",
  subscriptionId: "sub_123",
  reads: {
    subscriptions: { retrieve: async () => ({ default_payment_method: "pm_old" }) },
    customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: "pm_new" } }) },
    paymentMethods: { list: async () => ({ data: [{ id: "pm_old" }, { id: "pm_new" }] }) },
  },
});
ok(verified.selectedOnSubscription && verified.attachedNotDefaultId === "pm_new", "an attached method that is not the subscription default is offered");
const selected = verifyPaymentMethod({ subscriptionDefaultId: "pm_new", customerDefaultId: "pm_new", attachedIds: ["pm_new"] });
ok(selected.selectedOnSubscription && selected.attachedNotDefaultId === null, "the subscription default is selected when it is the attached method");

let defaultWrites = 0;
try {
  await runSetSubscriptionDefault({
    enabled: true,
    environment: "sandbox",
    owner: false,
    subscriptionId: "sub_123",
    paymentMethodId: "pm_new",
    attachedIds: ["pm_new"],
    stripe: { subscriptions: { update: async () => { defaultWrites += 1; return { id: "sub_123" }; } } },
  });
  ok(false, "a non-owner is refused");
} catch (error) {
  ok(error instanceof Error && error.message === "Forbidden" && defaultWrites === 0, "setting the subscription default refuses a non-owner before Stripe");
}
const updatedDefault = await runSetSubscriptionDefault({
  enabled: true,
  environment: "sandbox",
  owner: true,
  subscriptionId: "sub_123",
  paymentMethodId: "pm_new",
  attachedIds: ["pm_old", "pm_new"],
  stripe: { subscriptions: { update: async (_id, params, options) => {
    defaultWrites += 1;
    ok(params.default_payment_method === "pm_new" && options.idempotencyKey === paymentMethodDefaultIdempotencyKey("sub_123", "pm_new"), "the owner sets that method as the subscription default");
    return { id: "sub_123" };
  } } },
});
ok(updatedDefault.subscriptionId === "sub_123" && defaultWrites === 1, "the subscription id stays the same");

let previewCalls = 0;
const serverPreview = await runPreviewBillingDay({
  featureEnabled: true,
  environment: "sandbox",
  subscriptionId: "sub_123",
  weeklyAmountCents: 35000,
  targetWeekday: 1,
  subscription: { current_period_end: anchor, billing_cycle_anchor: anchor },
  stripe: { invoices: { createPreview: async (params) => {
    previewCalls += 1;
    ok(params.subscription_details.proration_behavior === "none" && params.subscription_details.trial_end === preview.trialEndUnix, "createPreview uses the Monday trial end and no proration");
    return { amount_due: 35000, lines: { data: [{ amount: -500, proration: false, description: "Credit" }, { amount: 100, proration: true, description: "Unused time" }] } };
  } } },
});
ok(previewCalls === 1 && serverPreview.invoices[1]?.dateEt === "2026-10-26" && serverPreview.stripePreview.creditsCents === 500 && serverPreview.stripePreview.prorations.length === 1, "preview shows the Monday renewal, the credit, and the proration line");
ok(readPreviewLines({ amount_due: 0, lines: { data: [] } }).prorations.length === 0, "an empty Stripe preview has no proration lines");

let begins = 0;
let updates = 0;
let finishes = 0;
const applyInput = {
  featureEnabled: true,
  journalEnabled: true,
  environment: "sandbox" as const,
  subscriptionId: "sub_123",
  trialEndUnix: preview.trialEndUnix,
  invoices: [] as Array<{ periodStarts: number[]; status: string | null }>,
  stripe: { subscriptions: { update: async (id: string, _params: unknown, options: { idempotencyKey: string }) => {
    updates += 1;
    ok(id === "sub_123" && options.idempotencyKey === billingDayIdempotencyKey(OP), "apply uses one billing-day idempotency key on the same subscription");
    return { id: "sub_123" };
  } } },
  begin: async () => {
    begins += 1;
    return begins === 1
      ? { operationId: OP, state: "pending" as const, subscriptionId: "sub_123" }
      : { operationId: OP, state: "complete" as const, subscriptionId: "sub_123" };
  },
  finish: async () => { finishes += 1; },
};
const firstApply = await runApplyBillingDay(applyInput);
const secondApply = await runApplyBillingDay(applyInput);
ok(firstApply.repeated === false && secondApply.repeated === true && firstApply.idempotencyKey === secondApply.idempotencyKey && updates === 1 && finishes === 1, "the same operation applies once");

let blockedBegins = 0;
try {
  await runApplyBillingDay({
    ...applyInput,
    invoices: [{ periodStarts: [preview.trialEndUnix], status: "open" }],
    begin: async () => { blockedBegins += 1; return { operationId: OP, state: "pending", subscriptionId: "sub_123" }; },
    stripe: { subscriptions: { update: async () => { updates += 1; return { id: "sub_123" }; } } },
  });
  ok(false, "an existing renewal invoice is refused");
} catch (error) {
  ok(error instanceof Error && error.message === RENEWAL_INVOICE_EXISTS && blockedBegins === 0 && updates === 1, "an existing renewal invoice refuses apply before the journal and before another update");
}
ok(!renewalInvoiceBlocksApply([{ periodStarts: [preview.trialEndUnix], status: "void" }], preview.trialEndUnix), "a void renewal invoice does not block apply");

try {
  await runApplyBillingDay({
    ...applyInput,
    begin: async () => ({ operationId: OP, state: "pending", subscriptionId: "sub_123" }),
    stripe: { subscriptions: { update: async () => ({ id: "sub_other" }) } },
    finish: async () => { finishes += 1; },
  });
  ok(false, "a changed subscription id is refused");
} catch (error) {
  ok(error instanceof Error && error.message === SUBSCRIPTION_ID_UNCHANGED, "a changed subscription id is not written onto the rental");
}

const extensionUpdate = extensionProviderUpdate();
ok(JSON.stringify(extensionUpdate) === JSON.stringify({ auto_advance: false }), "an extension only turns auto-advance off");
const outstanding = extensionCollectionView({ invoiceId: "in_1", amountDueCents: 35000, originalDue: "2026-10-24", newDue: "2026-10-31", paid: false, status: "open" });
ok(extensionCollectionState({ paid: false, status: "open" }) === "outstanding" && outstanding.reporting === "outstanding" && outstanding.label === "Extended", "an open unpaid extension stays outstanding");
ok(extensionCollectionView({ invoiceId: "in_1", amountDueCents: 35000, originalDue: "2026-10-24", newDue: "2026-10-31", paid: true, status: "paid" }).reporting === "collected", "a later payment is collected rather than invented");

let extensionUpdates = 0;
let extensionPays = 0;
let extensionFinishes = 0;
const grant = await runGrantPaymentExtension({
  featureEnabled: true,
  recordEnabled: true,
  environment: "sandbox",
  customerId: "cus_123",
  subscriptionId: "sub_123",
  invoiceId: "in_1",
  reason: "Driver asked for one week",
  newDue: "2026-10-31",
  stripe: {
    invoices: {
      retrieve: async () => ({ id: "in_1", subscription: "sub_123", customer: "cus_123", status: "open", paid: false, amount_due: 35000, period_end: anchor }),
      update: async (_id, params, options) => {
        extensionUpdates += 1;
        ok(params.auto_advance === false && options.idempotencyKey === extensionIdempotencyKey(OP) && !("paid" in params), "the invoice update does not mark it paid");
        return { id: "in_1" };
      },
      pay: async () => { extensionPays += 1; },
    },
  },
  begin: async () => ({ operationId: OP, state: "pending", subscriptionId: "sub_123" }),
  finish: async () => { extensionFinishes += 1; },
});
ok(grant.reporting === "outstanding" && grant.label === "Extended" && extensionUpdates === 1 && extensionPays === 0 && extensionFinishes === 1, "the extension stays outstanding and does not call invoice pay");

let recordFailed = false;
try {
  await runGrantPaymentExtension({
    featureEnabled: true,
    recordEnabled: true,
    environment: "sandbox",
    customerId: "cus_123",
    subscriptionId: "sub_123",
    invoiceId: "in_1",
    reason: "Driver asked for one week",
    newDue: "2026-10-31",
    stripe: { invoices: { retrieve: async () => ({ subscription: "sub_123", customer: "cus_123", status: "open", paid: false, amount_due: 35000 }), update: async () => { extensionUpdates += 1; } } },
    begin: async () => { throw new Error("exception insert failed"); },
    finish: async () => { extensionFinishes += 1; },
  });
} catch (error) {
  recordFailed = error instanceof Error && error.message === "exception insert failed";
}
ok(recordFailed && extensionUpdates === 1, "a failed exception record is not swallowed and does not defer the invoice");

const report = { warnings: ["Base"] };
const same = withBillingExtensions(report, [outstanding], BILLING_ONE_TIME_EXTENSION_ENABLED);
ok(same === report && !("extensions" in same), "flag-off collections do not gain an extensions key");
const shown = withBillingExtensions(report, [outstanding], true);
ok("extensions" in shown && shown.extensions[0]?.reporting === "outstanding" && shown.extensions[0].label === "Extended", "flag-on collections show the extension as outstanding");
ok(extensionReadWarning("42P01") === "Payment extension records are not installed." && extensionReadWarning("PGRST205").includes("not installed"), "only 42P01 and PGRST205 mean the table is missing");
ok(extensionReadWarning("PGRST204") === "Payment extensions could not be read." && !extensionReadWarning("PGRST204").includes("not installed"), "a different PostgREST error is not treated as a missing table");

const functionsSource = readFileSync("src/lib/billing-controls.functions.ts", "utf8");
const serverSource = readFileSync("src/lib/billing-controls.server.ts", "utf8");
const collectionsSource = readFileSync("src/lib/stripe-collections.server.ts", "utf8");
const sql = readFileSync("proposed/billing-controls-v1.sql", "utf8");

function body(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  const next = source.indexOf("\nexport const ", start + 10);
  return source.slice(start, next === -1 ? undefined : next);
}
function flagBefore(source: string, name: string, marker: string, role: string) {
  const text = body(source, name);
  ok(text.indexOf(marker) >= 0 && text.indexOf(marker) < text.indexOf(role), `${name} checks ${marker} before ${role}`);
}
flagBefore(functionsSource, "createBillingPaymentMethodLink", "BILLING_PM_UPDATE_LINK_OFF", "requireManager");
flagBefore(functionsSource, "sendBillingPaymentMethodLink", "BILLING_PM_UPDATE_LINK_OFF", "requireManager");
flagBefore(functionsSource, "verifyBillingPaymentMethod", "BILLING_PM_UPDATE_LINK_OFF", "requireManager");
flagBefore(functionsSource, "setBillingSubscriptionDefault", "BILLING_PM_UPDATE_LINK_OFF", "requireOwner");
flagBefore(functionsSource, "previewBillingDay", "BILLING_DAY_CHANGE_OFF", "requireManager");
flagBefore(functionsSource, "applyBillingDay", "BILLING_DAY_APPLY_OFF", "requireManager");
flagBefore(functionsSource, "grantBillingExtension", "BILLING_EXTENSION_RECORD_OFF", "requireManager");
ok(functionsSource.indexOf("gatePaymentMethodLink, requireSupabaseAuth") >= 0, "the payment method flag runs before auth");
ok(functionsSource.indexOf("gateBillingDayApply, requireSupabaseAuth") >= 0, "the billing day apply flag runs before auth");
ok(functionsSource.indexOf("gatePaymentExtension, requireSupabaseAuth") >= 0, "the extension flag runs before auth");
ok(!serverSource.includes("createStripeClient(\"live\")") && !serverSource.includes("createReadOnlyStripe(\"live\")") && !serverSource.includes("logAudit"), "billing controls do not call live Stripe or logAudit");
ok(!serverSource.includes("subscriptions.create") && !serverSource.includes("invoices.pay") && !serverSource.includes("paid_out_of_band") && !serverSource.includes("billingPortal.configurations"), "billing controls do not create a subscription, pay an invoice, or create a portal configuration");
ok(collectionsSource.indexOf("if (!BILLING_ONE_TIME_EXTENSION_ENABLED) return collectionsReport;") < collectionsSource.indexOf("readBillingExtensionReport"), "flag-off collections return before the extension read");
ok(sql.includes("CREATE TABLE private.billing_exceptions_v1") && sql.includes("CREATE TABLE private.billing_operations_v1") && sql.includes("-- ===== ROLLBACK ====="), "proposed SQL has the journal, the exception table, and a rollback");
ok(!sql.includes("DROP FUNCTION public.rental_subscription_begin_v1") && !sql.includes("DROP TABLE public.rentals") && sql.includes("state IN ('extended', 'collected')") && !sql.includes("'paid'"), "rollback does not drop the rental subscription journal and the exception state is never paid");
ok(sql.includes("interval '23 hours'") && sql.includes("subscription_mismatch") && sql.includes("live_refused"), "the journal keeps the 23-hour window, the same subscription id, and refuses live");

if (fails) {
  console.error(`billing-controls ${fails} failed`);
  process.exit(1);
}
console.log("billing-controls ok");
