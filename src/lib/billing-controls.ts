import { tierAllows, type StaffTier } from "./roles";
import {
  BILLING_DAY_APPLY_OFF,
  BILLING_DAY_CHANGE_OFF,
  BILLING_EXTENSION_RECORD_OFF,
  BILLING_ONE_TIME_EXTENSION_OFF,
} from "./billing-controls-flag";

const ET = "America/New_York";
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PORTAL_NOT_CONFIGURED = "Portal not configured.";
export const RENEWAL_INVOICE_EXISTS = "The next renewal invoice already exists, so the billing day was not changed.";
export const LIVE_STRIPE_REFUSED = "Live Stripe is refused.";
export const PAYMENT_METHOD_EMAIL_SUBJECT = "Update Your Payment Method";
export const DRIVER_EMAIL_MISSING = "This driver has no email on file.";
export const SUBSCRIPTION_ID_UNCHANGED = "The subscription id changed, so the rental was not updated.";

export type BillingPreviewInvoice = {
  kind: "trial" | "renewal";
  amountCents: number;
  atUnix: number;
  dateEt: string;
  creditsCents: number;
  prorations: [];
};

export type PreviewProration = { amountCents: number | null; description: string };

export type PreviewLineRead = {
  amountDueCents: number | null;
  creditsCents: number;
  prorations: PreviewProration[];
};

export type PaymentMethodVerifyResult = {
  selectedOnSubscription: boolean;
  subscriptionDefaultId: string | null;
  customerDefaultId: string | null;
  attachedNotDefaultId: string | null;
  attachedIds: string[];
};

export type BillingExtensionView = {
  invoiceId: string;
  amountDueCents: number | null;
  originalDue: string;
  newDue: string;
  reporting: "outstanding" | "collected";
  label: "Extended" | "Collected";
};

type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export function billingControlsRoleAllowed(tier: StaffTier | null): boolean {
  return tierAllows(tier, "manager");
}

export function billingDefaultRoleAllowed(tier: StaffTier | null): boolean {
  return tierAllows(tier, "owner");
}

export function assertBillingStripeMode(environment: string): "sandbox" {
  if (environment !== "sandbox") throw new Error(LIVE_STRIPE_REFUSED);
  return "sandbox";
}

export function billingDayApplyBlock(flags: { feature: boolean; journal: boolean }): string | null {
  if (!flags.feature) return BILLING_DAY_CHANGE_OFF;
  if (!flags.journal) return BILLING_DAY_APPLY_OFF;
  return null;
}

export function extensionRecordBlock(flags: { feature: boolean; record: boolean }): string | null {
  if (!flags.feature) return BILLING_ONE_TIME_EXTENSION_OFF;
  if (!flags.record) return BILLING_EXTENSION_RECORD_OFF;
  return null;
}

/** Non-negative dollars with at most two decimal places, as integer cents. Null stays null. */
export function weeklyRateCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

export function etParts(unixSeconds: number): EtParts {
  if (!Number.isSafeInteger(unixSeconds)) throw new Error("The billing instant is not a whole second.");
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[read("weekday")];
  if (weekday === undefined) throw new Error("The billing weekday could not be read.");
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday,
  };
}

export function etDate(unixSeconds: number): string {
  const parts = etParts(unixSeconds);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function unixFromEt(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  let guess = Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = etParts(guess);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = Math.floor((wanted - got) / 1000);
    if (delta === 0) return guess;
    guess += delta;
  }
  const check = etParts(guess);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) {
    throw new Error("The Eastern Time instant could not be resolved.");
  }
  return guess;
}

function addCalendarDays(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function calendarDayNumber(parts: EtParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

/** Next target weekday strictly after the anchor's Eastern Time date, at the same clock time. */
export function nextWeekdayUnix(anchorUnix: number, targetWeekday: number): number {
  if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) throw new Error("Choose a billing day.");
  const parts = etParts(anchorUnix);
  let delta = (targetWeekday - parts.weekday + 7) % 7;
  if (delta === 0) delta = 7;
  const next = addCalendarDays(parts.year, parts.month, parts.day, delta);
  return unixFromEt(next.year, next.month, next.day, parts.hour, parts.minute, parts.second);
}

/** Saturday 24 Oct 2026 11:41 America/New_York. October 2026 is EDT, so this is 15:41 UTC. */
export function saturdayBillingAnchorUnix(): number {
  return unixFromEt(2026, 10, 24, 11, 41, 0);
}

/**
 * Local schedule for a weekly amount moved to the next target weekday.
 * The $0 trial row is the anchor date and is not a charge. The next two rows
 * are the weekly amount. A Stripe week is 7 * 24 hours, so the second renewal
 * can shift an hour across the Eastern Time change and still land on the Monday date.
 * Proration lists stay empty. This does not charge the gap days.
 */
export function projectBillingDayChange(input: {
  weeklyAmountCents: number;
  anchorUnix: number;
  targetWeekday: number;
}): { trialEndUnix: number; gapDays: number; invoices: BillingPreviewInvoice[]; prorations: [] } {
  if (!Number.isSafeInteger(input.weeklyAmountCents) || input.weeklyAmountCents < 0) {
    throw new Error("The weekly amount is not a readable number of cents.");
  }
  const trialEndUnix = nextWeekdayUnix(input.anchorUnix, input.targetWeekday);
  const secondUnix = trialEndUnix + WEEK_SECONDS;
  const gapDays = calendarDayNumber(etParts(trialEndUnix)) - calendarDayNumber(etParts(input.anchorUnix));
  const row = (kind: "trial" | "renewal", amountCents: number, atUnix: number): BillingPreviewInvoice => ({
    kind,
    amountCents,
    atUnix,
    dateEt: etDate(atUnix),
    creditsCents: 0,
    prorations: [],
  });
  return {
    trialEndUnix,
    gapDays,
    invoices: [
      row("trial", 0, input.anchorUnix),
      row("renewal", input.weeklyAmountCents, trialEndUnix),
      row("renewal", input.weeklyAmountCents, secondUnix),
    ],
    prorations: [],
  };
}

export function readPreviewLines(invoice: {
  amount_due?: unknown;
  lines?: { data?: Array<{ amount?: unknown; proration?: unknown; description?: unknown }> } | null;
}): PreviewLineRead {
  const lines = invoice.lines?.data ?? [];
  let credits = 0;
  const prorations: PreviewProration[] = [];
  for (const line of lines) {
    const amount = typeof line.amount === "number" && Number.isSafeInteger(line.amount) ? line.amount : null;
    if (amount != null && amount < 0) credits += -amount;
    if (line.proration === true) {
      prorations.push({
        amountCents: amount,
        description: typeof line.description === "string" ? line.description : "",
      });
    }
  }
  const amountDue = typeof invoice.amount_due === "number" && Number.isSafeInteger(invoice.amount_due) ? invoice.amount_due : null;
  return { amountDueCents: amountDue, creditsCents: credits, prorations };
}

export function renewalPeriodStarts(invoice: {
  period_start?: unknown;
  lines?: { data?: Array<{ period?: { start?: unknown } }> } | null;
}): number[] {
  const starts: number[] = [];
  if (typeof invoice.period_start === "number" && Number.isSafeInteger(invoice.period_start)) starts.push(invoice.period_start);
  for (const line of invoice.lines?.data ?? []) {
    const start = line.period?.start;
    if (typeof start === "number" && Number.isSafeInteger(start) && !starts.includes(start)) starts.push(start);
  }
  return starts;
}

export function renewalInvoiceBlocksApply(
  invoices: Array<{ periodStarts: number[]; status: string | null }>,
  trialEndUnix: number,
): boolean {
  return invoices.some((invoice) => invoice.status !== "void" && invoice.status !== "uncollectible" && invoice.periodStarts.includes(trialEndUnix));
}

function requireOperationId(operationId: string, label: string): string {
  if (!UUID_RE.test(operationId)) throw new Error(`${label} operation id must be a UUID.`);
  return operationId;
}

export function billingDayIdempotencyKey(operationId: string): string {
  return `rr:${requireOperationId(operationId, "Billing day")}:billing-day`;
}

export function extensionIdempotencyKey(operationId: string): string {
  return `rr:${requireOperationId(operationId, "Payment extension")}:extend`;
}

export function paymentMethodDefaultIdempotencyKey(subscriptionId: string, paymentMethodId: string): string {
  if (!subscriptionId || !paymentMethodId) throw new Error("Choose a subscription and a payment method.");
  return `rr:pm-default:${subscriptionId}:${paymentMethodId}`;
}

export function paymentMethodPortalParams(customerId: string, returnUrl: string): {
  customer: string;
  return_url: string;
  flow_data: { type: "payment_method_update" };
} {
  if (!customerId) throw new Error("This rental has no Stripe customer.");
  if (!returnUrl) throw new Error("The return address is missing.");
  return { customer: customerId, return_url: returnUrl, flow_data: { type: "payment_method_update" } };
}

export function portalConfigurationMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const blob = `${message} ${code}`.toLowerCase();
  return blob.includes("no configuration provided")
    || blob.includes("default configuration has not been created")
    || blob.includes("portal configuration")
    || code === "billing_portal_configuration";
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

export function verifyPaymentMethod(input: {
  subscriptionDefaultId: string | null;
  customerDefaultId: string | null;
  attachedIds: string[];
}): PaymentMethodVerifyResult {
  const subscriptionDefaultId = input.subscriptionDefaultId;
  const customerDefaultId = input.customerDefaultId;
  const attached = input.attachedIds.filter((id) => id);
  const selectedOnSubscription = Boolean(subscriptionDefaultId && attached.includes(subscriptionDefaultId));
  const customerDiffers = customerDefaultId && attached.includes(customerDefaultId) && customerDefaultId !== subscriptionDefaultId;
  const attachedNotDefaultId = customerDiffers
    ? customerDefaultId
    : attached.find((id) => id !== subscriptionDefaultId) ?? null;
  return { selectedOnSubscription, subscriptionDefaultId, customerDefaultId, attachedNotDefaultId, attachedIds: attached };
}

export function subscriptionDefaultId(subscription: { default_payment_method?: unknown }): string | null {
  return idOf(subscription.default_payment_method);
}

export function customerInvoiceDefaultId(customer: { invoice_settings?: { default_payment_method?: unknown } | null }): string | null {
  return idOf(customer.invoice_settings?.default_payment_method);
}

export function subscriptionAnchorUnix(subscription: {
  current_period_end?: unknown;
  billing_cycle_anchor?: unknown;
  items?: unknown;
}): number | null {
  const fromItems = itemPeriodEnds(subscription.items);
  const top = wholeSecond(subscription.current_period_end);
  if (fromItems.disagree) return null;
  if (fromItems.end !== null && top !== null && fromItems.end !== top) return null;
  return fromItems.end ?? top ?? wholeSecond(subscription.billing_cycle_anchor);
}

function wholeSecond(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function itemPeriodEnds(items: unknown): { end: number | null; disagree: boolean } {
  const data = items && typeof items === "object" && "data" in items && Array.isArray((items as { data?: unknown }).data)
    ? (items as { data: unknown[] }).data
    : null;
  if (!data || data.length === 0) return { end: null, disagree: false };
  const ends = data.map((item) => wholeSecond(item && typeof item === "object" ? (item as { current_period_end?: unknown }).current_period_end : null));
  if (ends.some((end) => end === null)) return { end: null, disagree: true };
  if (new Set(ends).size !== 1) return { end: null, disagree: true };
  return { end: ends[0] ?? null, disagree: false };
}

/** One invoice only. Does not pause the subscription or move the anchor. */
export function extensionProviderUpdate(): { auto_advance: false } {
  return { auto_advance: false };
}

export function extensionCollectionState(input: { paid: boolean; status: string | null }): "outstanding" | "collected" {
  if (input.paid || input.status === "paid") return "collected";
  return "outstanding";
}

export function extensionCollectionView(input: {
  invoiceId: string;
  amountDueCents: number | null;
  originalDue: string;
  newDue: string;
  paid: boolean;
  status: string | null;
}): BillingExtensionView {
  const reporting = extensionCollectionState(input);
  return {
    invoiceId: input.invoiceId,
    amountDueCents: input.amountDueCents,
    originalDue: input.originalDue,
    newDue: input.newDue,
    reporting,
    label: reporting === "collected" ? "Collected" : "Extended",
  };
}

export function withBillingExtensions<T extends object>(
  report: T,
  rows: BillingExtensionView[] | null,
  enabled: boolean,
): T | (T & { extensions: BillingExtensionView[] }) {
  if (!enabled || rows == null) return report;
  return { ...report, extensions: rows };
}

export function readableCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** Proposed-table missing is only Postgres 42P01 or PostgREST PGRST205. */
export function extensionReadWarning(code: string | null | undefined): string {
  if (code === "42P01" || code === "PGRST205") return "Payment extension records are not installed.";
  return "Payment extensions could not be read.";
}
