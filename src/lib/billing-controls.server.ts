import {
  BILLING_DAY_APPLY_ENABLED,
  BILLING_DAY_CHANGE_ENABLED,
  BILLING_EXTENSION_RECORD_ENABLED,
  BILLING_ONE_TIME_EXTENSION_ENABLED,
  BILLING_PM_UPDATE_LINK_ENABLED,
  BILLING_PM_UPDATE_LINK_OFF,
} from "./billing-controls-flag";
import {
  DRIVER_EMAIL_MISSING,
  LIVE_STRIPE_REFUSED,
  PAYMENT_METHOD_EMAIL_SUBJECT,
  PORTAL_NOT_CONFIGURED,
  RENEWAL_INVOICE_EXISTS,
  SUBSCRIPTION_ID_UNCHANGED,
  assertBillingStripeMode,
  billingDayApplyBlock,
  billingDayIdempotencyKey,
  customerInvoiceDefaultId,
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
  readableCents,
  renewalInvoiceBlocksApply,
  renewalPeriodStarts,
  subscriptionAnchorUnix,
  subscriptionDefaultId,
  verifyPaymentMethod,
  weeklyRateCents,
  type BillingExtensionView,
  type PaymentMethodVerifyResult,
  type PreviewLineRead,
} from "./billing-controls";

export const BILLING_STRIPE_ENVIRONMENT = "sandbox" as const;

type PortalStripe = {
  billingPortal: { sessions: { create: (params: ReturnType<typeof paymentMethodPortalParams>) => Promise<{ id?: string; url?: string | null }> } };
};

type PreviewStripe = {
  invoices: { createPreview: (params: { subscription: string; subscription_details: { trial_end: number; proration_behavior: "none" } }) => Promise<{ amount_due?: unknown; lines?: { data?: Array<{ amount?: unknown; proration?: unknown; description?: unknown }> } }> };
};

type SubscriptionWrite = {
  subscriptions: {
    update: (
      id: string,
      params: { trial_end?: number; proration_behavior?: "none"; default_payment_method?: string },
      options: { idempotencyKey: string },
    ) => Promise<{ id: string }>;
  };
};

type InvoiceWrite = {
  invoices: {
    retrieve: (id: string) => Promise<any>;
    update: (id: string, params: { auto_advance: false }, options: { idempotencyKey: string }) => Promise<any>;
  };
};

type VerifyReads = {
  subscriptions: { retrieve: (id: string) => Promise<{ default_payment_method?: unknown }> };
  customers: { retrieve: (id: string) => Promise<{ invoice_settings?: { default_payment_method?: unknown } | null }> };
  paymentMethods: { list: (params: { customer: string; type: "card" }) => Promise<{ data: Array<{ id: string }> }> };
};

export type BillingOperationHandle = {
  operationId: string;
  state: "pending" | "complete";
  subscriptionId: string;
};

export type BillingRental = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  weeklyAmountCents: number | null;
  applicationId: string | null;
};

export function billingReturnUrl(): string {
  const origin = process.env.PUBLIC_SITE_URL || "https://drivereal.com";
  return `${origin.replace(/\/$/, "")}/admin`;
}

export async function sandboxReads() {
  assertBillingStripeMode(BILLING_STRIPE_ENVIRONMENT);
  const { createReadOnlyStripe } = await import("./stripe-reader.server");
  return createReadOnlyStripe(BILLING_STRIPE_ENVIRONMENT);
}

export async function sandboxWrites() {
  assertBillingStripeMode(BILLING_STRIPE_ENVIRONMENT);
  const { createStripeClient } = await import("./stripe.server");
  return createStripeClient(BILLING_STRIPE_ENVIRONMENT);
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadBillingRental(rentalId: string, client?: { from: (table: string) => any }): Promise<BillingRental> {
  const supabase = client ?? await adminClient();
  const { data, error } = await supabase
    .from("rentals")
    .select("id, stripe_customer_id, stripe_subscription_id, weekly_rate, application_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Rental not found.");
  return {
    id: String(data.id),
    customerId: typeof data.stripe_customer_id === "string" ? data.stripe_customer_id : null,
    subscriptionId: typeof data.stripe_subscription_id === "string" ? data.stripe_subscription_id : null,
    weeklyAmountCents: weeklyRateCents(data.weekly_rate),
    applicationId: typeof data.application_id === "string" ? data.application_id : null,
  };
}

export async function loadDriverEmail(applicationId: string | null, client?: { from: (table: string) => any }): Promise<string | null> {
  if (!applicationId) return null;
  const supabase = client ?? await adminClient();
  const { data, error } = await supabase.from("applications").select("email").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  const email = typeof data?.email === "string" ? data.email.trim() : "";
  return email || null;
}

function requireCustomerAndSubscription(customerId: string | null, subscriptionId: string | null): { customerId: string; subscriptionId: string } {
  if (!customerId) throw new Error("This rental has no Stripe customer.");
  if (!subscriptionId) throw new Error("This rental has no Stripe subscription.");
  return { customerId, subscriptionId };
}

export async function runCreatePaymentMethodLink(input: {
  enabled: boolean;
  environment: string;
  customerId: string | null;
  subscriptionId: string | null;
  returnUrl: string;
  stripe: PortalStripe;
}): Promise<{ url: string; sessionId: string }> {
  if (!input.enabled) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  assertBillingStripeMode(input.environment);
  const ids = requireCustomerAndSubscription(input.customerId, input.subscriptionId);
  const params = paymentMethodPortalParams(ids.customerId, input.returnUrl);
  try {
    const session = await input.stripe.billingPortal.sessions.create(params);
    if (!session.url || !session.id) throw new Error("Payment method link was not created.");
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    if (error instanceof Error && error.message === "Payment method link was not created.") throw error;
    if (portalConfigurationMissing(error)) throw new Error(PORTAL_NOT_CONFIGURED);
    throw error;
  }
}

export async function runSendPaymentMethodLink(input: {
  enabled: boolean;
  environment: string;
  customerId: string | null;
  subscriptionId: string | null;
  returnUrl: string;
  email: string | null;
  rentalId: string;
  stripe: PortalStripe;
  sendEmail: (message: { to: string; subject: string; html: string; idempotencyKey: string }) => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ sent: true }> {
  if (!input.email) throw new Error(DRIVER_EMAIL_MISSING);
  const created = await runCreatePaymentMethodLink(input);
  const result = await input.sendEmail({
    to: input.email,
    subject: PAYMENT_METHOD_EMAIL_SUBJECT,
    html: `<p>Use this link to update the payment method on your rental.</p><p><a href="${escapeHtml(created.url)}">Update Your Payment Method</a></p>`,
    idempotencyKey: `rr:pm-email:${created.sessionId}`,
  });
  if (!result.ok) throw new Error(result.error || "The payment method link could not be sent.");
  return { sent: true };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

export async function runVerifyPaymentMethod(input: {
  enabled: boolean;
  environment: string;
  customerId: string | null;
  subscriptionId: string | null;
  reads: VerifyReads;
}): Promise<PaymentMethodVerifyResult> {
  if (!input.enabled) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  assertBillingStripeMode(input.environment);
  const ids = requireCustomerAndSubscription(input.customerId, input.subscriptionId);
  const [subscription, customer, methods] = await Promise.all([
    input.reads.subscriptions.retrieve(ids.subscriptionId),
    input.reads.customers.retrieve(ids.customerId),
    input.reads.paymentMethods.list({ customer: ids.customerId, type: "card" }),
  ]);
  return verifyPaymentMethod({
    subscriptionDefaultId: subscriptionDefaultId(subscription),
    customerDefaultId: customerInvoiceDefaultId(customer),
    attachedIds: (methods.data ?? []).map((method) => method.id),
  });
}

export async function runSetSubscriptionDefault(input: {
  enabled: boolean;
  environment: string;
  owner: boolean;
  subscriptionId: string;
  paymentMethodId: string;
  attachedIds: string[];
  stripe: SubscriptionWrite;
}): Promise<{ subscriptionId: string; paymentMethodId: string; idempotencyKey: string }> {
  if (!input.enabled) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  if (!input.owner) throw new Error("Forbidden");
  assertBillingStripeMode(input.environment);
  if (!input.attachedIds.includes(input.paymentMethodId)) throw new Error("That payment method is not attached to this customer.");
  const idempotencyKey = paymentMethodDefaultIdempotencyKey(input.subscriptionId, input.paymentMethodId);
  const updated = await input.stripe.subscriptions.update(
    input.subscriptionId,
    { default_payment_method: input.paymentMethodId },
    { idempotencyKey },
  );
  if (updated.id !== input.subscriptionId) throw new Error(SUBSCRIPTION_ID_UNCHANGED);
  return { subscriptionId: updated.id, paymentMethodId: input.paymentMethodId, idempotencyKey };
}

export async function runPreviewBillingDay(input: {
  featureEnabled: boolean;
  environment: string;
  subscriptionId: string;
  weeklyAmountCents: number | null;
  targetWeekday: number;
  subscription: { current_period_end?: unknown; billing_cycle_anchor?: unknown; items?: unknown };
  stripe: PreviewStripe;
}): Promise<{ trialEndUnix: number; gapDays: number; invoices: ReturnType<typeof projectBillingDayChange>["invoices"]; prorations: []; stripePreview: PreviewLineRead }> {
  if (!input.featureEnabled) throw new Error("Billing day changes are off.");
  assertBillingStripeMode(input.environment);
  if (input.weeklyAmountCents == null) throw new Error("The weekly rate is not a readable amount.");
  const anchorUnix = subscriptionAnchorUnix(input.subscription);
  if (anchorUnix == null) throw new Error("This subscription has no billing anchor.");
  const projected = projectBillingDayChange({
    weeklyAmountCents: input.weeklyAmountCents,
    anchorUnix,
    targetWeekday: input.targetWeekday,
  });
  const invoice = await input.stripe.invoices.createPreview({
    subscription: input.subscriptionId,
    subscription_details: { trial_end: projected.trialEndUnix, proration_behavior: "none" },
  });
  return { ...projected, stripePreview: readPreviewLines(invoice) };
}

export async function runApplyBillingDay(input: {
  featureEnabled: boolean;
  journalEnabled: boolean;
  environment: string;
  subscriptionId: string;
  trialEndUnix: number;
  invoices: Array<{ periodStarts: number[]; status: string | null }>;
  stripe: SubscriptionWrite;
  begin: () => Promise<BillingOperationHandle>;
  finish: (operation: { operationId: string; subscriptionId: string }) => Promise<void>;
}): Promise<{ idempotencyKey: string; repeated: boolean; subscriptionId: string }> {
  const block = billingDayApplyBlock({ feature: input.featureEnabled, journal: input.journalEnabled });
  if (block) throw new Error(block);
  assertBillingStripeMode(input.environment);
  if (input.environment === "live") throw new Error(LIVE_STRIPE_REFUSED);
  if (renewalInvoiceBlocksApply(input.invoices, input.trialEndUnix)) throw new Error(RENEWAL_INVOICE_EXISTS);
  const operation = await input.begin();
  const idempotencyKey = billingDayIdempotencyKey(operation.operationId);
  if (operation.state === "complete") {
    if (operation.subscriptionId !== input.subscriptionId) throw new Error(SUBSCRIPTION_ID_UNCHANGED);
    return { idempotencyKey, repeated: true, subscriptionId: operation.subscriptionId };
  }
  const updated = await input.stripe.subscriptions.update(
    input.subscriptionId,
    { trial_end: input.trialEndUnix, proration_behavior: "none" },
    { idempotencyKey },
  );
  if (updated.id !== input.subscriptionId) throw new Error(SUBSCRIPTION_ID_UNCHANGED);
  await input.finish({ operationId: operation.operationId, subscriptionId: updated.id });
  return { idempotencyKey, repeated: false, subscriptionId: updated.id };
}

export async function runGrantPaymentExtension(input: {
  featureEnabled: boolean;
  recordEnabled: boolean;
  environment: string;
  customerId: string;
  subscriptionId: string;
  invoiceId: string;
  reason: string;
  newDue: string;
  stripe: InvoiceWrite;
  begin: () => Promise<BillingOperationHandle>;
  finish: (operation: { operationId: string; subscriptionId: string }) => Promise<void>;
}): Promise<BillingExtensionView> {
  const block = extensionRecordBlock({ feature: input.featureEnabled, record: input.recordEnabled });
  if (block) throw new Error(block);
  assertBillingStripeMode(input.environment);
  if (!input.reason.trim()) throw new Error("Enter a reason.");
  const invoice = await input.stripe.invoices.retrieve(input.invoiceId);
  const invoiceSubscription = refId(invoice.subscription);
  const invoiceCustomer = refId(invoice.customer);
  if (invoiceSubscription !== input.subscriptionId) throw new Error("That invoice is not on this subscription.");
  if (invoiceCustomer !== input.customerId) throw new Error("That invoice is not for this customer.");
  const status = typeof invoice.status === "string" ? invoice.status : null;
  const paid = invoice.paid === true || status === "paid";
  if (paid) throw new Error("This invoice is already paid.");
  if (status === "void" || status === "uncollectible") throw new Error("This invoice cannot be extended.");
  const operation = await input.begin();
  const idempotencyKey = extensionIdempotencyKey(operation.operationId);
  const originalDue = invoiceDue(invoice);
  const amountDueCents = readableCents(invoice.amount_due);
  if (operation.state === "complete") {
    return extensionCollectionView({
      invoiceId: input.invoiceId,
      amountDueCents,
      originalDue,
      newDue: input.newDue,
      paid: false,
      status: status === "paid" ? "paid" : "open",
    });
  }
  await input.stripe.invoices.update(input.invoiceId, extensionProviderUpdate(), { idempotencyKey });
  await input.finish({ operationId: operation.operationId, subscriptionId: input.subscriptionId });
  return extensionCollectionView({
    invoiceId: input.invoiceId,
    amountDueCents,
    originalDue,
    newDue: input.newDue,
    paid: false,
    status: "open",
  });
}

function refId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function invoiceDue(invoice: Record<string, unknown>): string {
  const due = invoice.due_date;
  if (typeof due === "number" && Number.isSafeInteger(due)) return new Date(due * 1000).toISOString().slice(0, 10);
  const period = invoice.period_end;
  if (typeof period === "number" && Number.isSafeInteger(period)) return new Date(period * 1000).toISOString().slice(0, 10);
  return "";
}

export async function readBillingExtensionReport(client?: {
  rpc: (fn: string) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}): Promise<{ rows: BillingExtensionView[]; warning: string | null }> {
  if (!BILLING_ONE_TIME_EXTENSION_ENABLED) return { rows: [], warning: null };
  const supabase = client ?? await adminClient() as unknown as { rpc: (fn: string) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
  const { data, error } = await supabase.rpc("billing_exceptions_list_v1");
  if (error) {
    return { rows: [], warning: extensionReadWarning(error.code) };
  }
  const list = Array.isArray(data) ? data : [];
  return {
    rows: list.map((row) => {
      const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const collected = record.state === "collected";
      return extensionCollectionView({
        invoiceId: typeof record.invoiceId === "string" ? record.invoiceId : "",
        amountDueCents: readableCents(record.amountDueCents),
        originalDue: typeof record.originalDue === "string" ? record.originalDue : "",
        newDue: typeof record.newDue === "string" ? record.newDue : "",
        paid: collected,
        status: collected ? "paid" : "open",
      });
    }),
    warning: null,
  };
}

function sessionIdOf(claims: { session_id?: unknown } | null | undefined): string {
  const sessionId = claims?.session_id;
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Verified session required");
  return sessionId;
}

async function stripeAccountId(stripe: { accounts: { retrieve: (id: string | null) => Promise<{ id?: string | null }> } }): Promise<string> {
  const account = await stripe.accounts.retrieve(null);
  if (!account?.id) throw new Error("Provider account unavailable");
  return account.id;
}

export async function performCreatePaymentMethodLink(rentalId: string) {
  if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  const rental = await loadBillingRental(rentalId);
  return runCreatePaymentMethodLink({
    enabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    customerId: rental.customerId,
    subscriptionId: rental.subscriptionId,
    returnUrl: billingReturnUrl(),
    stripe: await sandboxWrites(),
  });
}

export async function performSendPaymentMethodLink(rentalId: string) {
  if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  const rental = await loadBillingRental(rentalId);
  const email = await loadDriverEmail(rental.applicationId);
  const { sendEmail } = await import("@/lib/email.server");
  return runSendPaymentMethodLink({
    enabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    customerId: rental.customerId,
    subscriptionId: rental.subscriptionId,
    returnUrl: billingReturnUrl(),
    email,
    rentalId,
    stripe: await sandboxWrites(),
    sendEmail,
  });
}

export async function performVerifyPaymentMethod(rentalId: string) {
  if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  const rental = await loadBillingRental(rentalId);
  return runVerifyPaymentMethod({
    enabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    customerId: rental.customerId,
    subscriptionId: rental.subscriptionId,
    reads: await sandboxReads() as unknown as VerifyReads,
  });
}

export async function performSetSubscriptionDefault(rentalId: string, paymentMethodId: string) {
  if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  const rental = await loadBillingRental(rentalId);
  const ids = requireCustomerAndSubscription(rental.customerId, rental.subscriptionId);
  const verified = await runVerifyPaymentMethod({
    enabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    customerId: ids.customerId,
    subscriptionId: ids.subscriptionId,
    reads: await sandboxReads() as unknown as VerifyReads,
  });
  return runSetSubscriptionDefault({
    enabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    owner: true,
    subscriptionId: ids.subscriptionId,
    paymentMethodId,
    attachedIds: verified.attachedIds,
    stripe: await sandboxWrites(),
  });
}

export async function performPreviewBillingDay(rentalId: string, targetWeekday: number) {
  if (!BILLING_DAY_CHANGE_ENABLED) throw new Error("Billing day changes are off.");
  const rental = await loadBillingRental(rentalId);
  const ids = requireCustomerAndSubscription(rental.customerId, rental.subscriptionId);
  const reads = await sandboxReads();
  const subscription = await reads.subscriptions.retrieve(ids.subscriptionId);
  return runPreviewBillingDay({
    featureEnabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    subscriptionId: ids.subscriptionId,
    weeklyAmountCents: rental.weeklyAmountCents,
    targetWeekday,
    subscription,
    stripe: await sandboxWrites() as PreviewStripe,
  });
}

export async function performApplyBillingDay(input: {
  actorId: string;
  claims: { session_id?: unknown } | null | undefined;
  rentalId: string;
  targetWeekday: number;
}) {
  const block = billingDayApplyBlock({ feature: BILLING_DAY_CHANGE_ENABLED, journal: BILLING_DAY_APPLY_ENABLED });
  if (block) throw new Error(block);
  const sessionId = sessionIdOf(input.claims);
  const rental = await loadBillingRental(input.rentalId);
  const ids = requireCustomerAndSubscription(rental.customerId, rental.subscriptionId);
  const reads = await sandboxReads();
  const writes = await sandboxWrites();
  const subscription = await reads.subscriptions.retrieve(ids.subscriptionId);
  const anchorUnix = subscriptionAnchorUnix(subscription);
  if (anchorUnix == null) throw new Error("This subscription has no billing anchor.");
  if (rental.weeklyAmountCents == null) throw new Error("The weekly rate is not a readable amount.");
  const projected = projectBillingDayChange({
    weeklyAmountCents: rental.weeklyAmountCents,
    anchorUnix,
    targetWeekday: input.targetWeekday,
  });
  const page = await reads.invoices.list({ subscription: ids.subscriptionId, limit: 100 });
  const invoices = (page.data ?? []).map((invoice) => ({
    periodStarts: renewalPeriodStarts(invoice),
    status: typeof invoice.status === "string" ? invoice.status : null,
  }));
  const account = await stripeAccountId(writes);
  const supabase = await adminClient();
  return runApplyBillingDay({
    featureEnabled: true,
    journalEnabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    subscriptionId: ids.subscriptionId,
    trialEndUnix: projected.trialEndUnix,
    invoices,
    stripe: writes as SubscriptionWrite,
    begin: async () => beginOperation(supabase, {
      rental: input.rentalId,
      actor: input.actorId,
      sess: sessionId,
      action: "billing_day",
      account,
      snapshot: { subscription: ids.subscriptionId, trialEnd: projected.trialEndUnix, weekday: input.targetWeekday },
    }),
    finish: (operation) => finishOperation(supabase, {
      operation: operation.operationId,
      actor: input.actorId,
      sess: sessionId,
      account,
      subscription: operation.subscriptionId,
    }),
  });
}

export async function performGrantPaymentExtension(input: {
  actorId: string;
  claims: { session_id?: unknown } | null | undefined;
  rentalId: string;
  invoiceId: string;
  reason: string;
  newDue: string;
}) {
  const block = extensionRecordBlock({ feature: BILLING_ONE_TIME_EXTENSION_ENABLED, record: BILLING_EXTENSION_RECORD_ENABLED });
  if (block) throw new Error(block);
  const sessionId = sessionIdOf(input.claims);
  const rental = await loadBillingRental(input.rentalId);
  const ids = requireCustomerAndSubscription(rental.customerId, rental.subscriptionId);
  const writes = await sandboxWrites();
  const account = await stripeAccountId(writes);
  const supabase = await adminClient();
  return runGrantPaymentExtension({
    featureEnabled: true,
    recordEnabled: true,
    environment: BILLING_STRIPE_ENVIRONMENT,
    customerId: ids.customerId,
    subscriptionId: ids.subscriptionId,
    invoiceId: input.invoiceId,
    reason: input.reason,
    newDue: input.newDue,
    stripe: writes as InvoiceWrite,
    begin: async () => beginOperation(supabase, {
      rental: input.rentalId,
      actor: input.actorId,
      sess: sessionId,
      action: "extend_invoice",
      account,
      snapshot: {
        subscription: ids.subscriptionId,
        customer: ids.customerId,
        invoice: input.invoiceId,
        reason: input.reason,
        newDue: input.newDue,
      },
    }),
    finish: (operation) => finishOperation(supabase, {
      operation: operation.operationId,
      actor: input.actorId,
      sess: sessionId,
      account,
      subscription: operation.subscriptionId,
    }),
  });
}

async function beginOperation(supabase: any, args: Record<string, unknown>): Promise<BillingOperationHandle> {
  const { data, error } = await supabase.rpc("billing_operation_begin_v1", {
    ...args,
    environment: BILLING_STRIPE_ENVIRONMENT,
  });
  if (error) throw new Error(error.message || "The billing operation could not be recorded.");
  const operationId = typeof data?.id === "string" ? data.id : "";
  const state = data?.state === "complete" ? "complete" : "pending";
  const subscriptionId = typeof data?.snapshot?.subscription === "string"
    ? data.snapshot.subscription
    : typeof data?.result?.subscriptionId === "string" ? data.result.subscriptionId : "";
  if (!operationId || !subscriptionId) throw new Error("The billing operation could not be recorded.");
  return { operationId, state, subscriptionId };
}

async function finishOperation(supabase: any, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc("billing_operation_finish_v1", { ...args, environment: BILLING_STRIPE_ENVIRONMENT });
  if (error) throw new Error(error.message || "The billing operation could not be finished.");
}
