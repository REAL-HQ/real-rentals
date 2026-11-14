// Server half of Stripe ↔ rental linking (rules in stripe-link.ts).
//
//  ensureApplicationStripeCustomer  one customer per application: reuse the
//      saved id, else an existing Stripe customer for this application or email,
//      else create one. Saved to applications.stripe_customer_id.
//  linkStripeObjectToRental  webhook: metadata, then customer id. Writes only
//      empty columns, so replays and out-of-order events are no-ops.
//  linkRentalOnActivation  copy the application's Stripe ids to the new rental,
//      attach its one active subscription, and import already-paid invoices.
//  runStripeLinkReconciliation  daily read-only check (switch default OFF).
//
// Nothing here cancels, refunds, charges or edits anything in Stripe. The only
// Stripe write is customers.create when no customer exists yet.
import {
  matchStripeToRental,
  nextDueAfterPaidWeeks,
  paidInvoiceOf,
  paymentRowForPaidInvoice,
  reconcileReportIsEmpty,
  reconcileStripeLinks,
  type LinkCandidate,
  type LinkMatch,
  type PaidInvoice,
  type ReconcileReport,
  type StripeRef,
} from "@/lib/stripe-link";
import { easternParts } from "@/lib/rent-reminders";

type Admin = any;

/** The Stripe client the app's checkouts use, or null when Stripe is not configured (nothing is linked). */
export async function stripeForLinking(): Promise<StripeLike | null> {
  const { checkoutStripeEnv } = await import("@/lib/initial-payment.server");
  const env = checkoutStripeEnv();
  if (!env) return null;
  const { createStripeClient } = await import("@/lib/stripe.server");
  return createStripeClient(env, { timeout: 10000 });
}
type StripeLike = any;

const cleanEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "") || null;

/**
 * The application's one Stripe customer. Order: saved id → a sibling application
 * with the same email → a Stripe customer tagged with this applicationId → the
 * only Stripe customer with this email → a new customer. Never creates a second
 * customer when one already exists for the renter.
 */
export async function ensureApplicationStripeCustomer(
  admin: Admin,
  stripe: StripeLike,
  app: { id: string; full_name?: string | null; email?: string | null; phone?: string | null; stripe_customer_id?: string | null },
): Promise<string> {
  if (app.stripe_customer_id) return app.stripe_customer_id;
  const save = async (id: string) => {
    await admin.from("applications").update({ stripe_customer_id: id }).eq("id", app.id).is("stripe_customer_id", null);
    return id;
  };
  const email = cleanEmail(app.email);
  if (email) {
    const { data: sibling } = await admin
      .from("applications")
      .select("stripe_customer_id")
      .eq("email", app.email)
      .not("stripe_customer_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (sibling?.stripe_customer_id) return save(sibling.stripe_customer_id as string);
    const listed = await stripe.customers.list({ email, limit: 10 });
    const found: any[] = (listed?.data ?? []).filter((c: any) => !c.deleted);
    const tagged = found.filter((c) => c.metadata?.applicationId === app.id || c.metadata?.application_id === app.id);
    if (tagged.length === 1) return save(tagged[0].id);
    if (found.length === 1) return save(found[0].id);
  }
  const created = await stripe.customers.create(
    {
      ...(app.email && { email: app.email }),
      ...(app.full_name && { name: app.full_name }),
      ...(app.phone && { phone: app.phone }),
      metadata: { applicationId: app.id },
    },
    { idempotencyKey: `application-customer:${app.id}` },
  );
  return save(created.id);
}

/** Approval hook: make sure the approved application has its customer. Never throws. */
export async function ensureCustomerAtApproval(admin: Admin, stripe: StripeLike, applicationId: string): Promise<string | null> {
  try {
    const { data: app } = await admin
      .from("applications")
      .select("id, full_name, email, phone, stripe_customer_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return null;
    return await ensureApplicationStripeCustomer(admin, stripe, app);
  } catch (err) {
    console.error("[stripe-link] approval customer failed", { applicationId, err: String((err as Error)?.message ?? err) });
    return null;
  }
}

async function activeCandidates(admin: Admin): Promise<LinkCandidate[] | null> {
  const rentals = await admin.from("rentals").select("id, application_id, stripe_customer_id, stripe_subscription_id").eq("status", "active");
  if (rentals.error) return null;
  const list: any[] = rentals.data ?? [];
  const appIds = [...new Set(list.map((r) => r.application_id).filter(Boolean))];
  const apps = appIds.length ? await admin.from("applications").select("id, stripe_customer_id").in("id", appIds) : { data: [], error: null };
  if (apps.error) return null;
  const appCus = new Map<string, string | null>((apps.data ?? []).map((a: any) => [a.id, a.stripe_customer_id ?? null]));
  return list.map((r) => ({
    rentalId: r.id,
    applicationId: r.application_id ?? null,
    stripeCustomerId: r.stripe_customer_id ?? null,
    applicationStripeCustomerId: r.application_id ? appCus.get(r.application_id) ?? null : null,
    stripeSubscriptionId: r.stripe_subscription_id ?? null,
  }));
}

export type LinkOutcome = LinkMatch | { kind: "error" };

/**
 * Link a Stripe customer / subscription to its rental by metadata, then customer
 * id. Fills only empty columns. "duplicate" leaves the rental untouched.
 */
export async function linkStripeObjectToRental(admin: Admin, ref: StripeRef): Promise<LinkOutcome> {
  const candidates = await activeCandidates(admin);
  if (!candidates) return { kind: "error" };
  const match = matchStripeToRental(ref, candidates);
  if (match.kind !== "link" && match.kind !== "already") return match;
  const cand = candidates.find((c) => c.rentalId === match.rentalId)!;
  const customerId = ref.customerId ?? null;
  const subscriptionId = ref.subscriptionId ?? null;
  const patch: Record<string, unknown> = {};
  if (customerId && !cand.stripeCustomerId) patch.stripe_customer_id = customerId;
  if (subscriptionId && !cand.stripeSubscriptionId) {
    patch.stripe_subscription_id = subscriptionId;
    patch.autopay_active = true;
  }
  if (Object.keys(patch).length) {
    let q = admin.from("rentals").update(patch).eq("id", match.rentalId);
    if (patch.stripe_subscription_id) q = q.is("stripe_subscription_id", null);
    const upd = await q.select("id");
    if (upd.error) return { kind: "error" };
    if (patch.stripe_subscription_id && upd.data?.length) {
      await admin.from("notifications").insert({
        title: "Subscription Linked",
        body: `Stripe subscription ${subscriptionId} linked to rental ${String(match.rentalId).slice(0, 8)} (by ${match.by}).`,
        kind: "payment",
        read: false,
      }).then(() => {}, () => {});
    }
  }
  if (customerId && cand.applicationId && !cand.applicationStripeCustomerId) {
    await admin.from("applications").update({ stripe_customer_id: customerId }).eq("id", cand.applicationId).is("stripe_customer_id", null)
      .then(() => {}, () => {});
  }
  return match;
}

/** Every paid invoice for a customer (newest first), normalised. */
export async function listPaidInvoices(stripe: StripeLike, params: { customer?: string; createdGte?: number; max?: number }): Promise<PaidInvoice[]> {
  const out: PaidInvoice[] = [];
  const max = params.max ?? 300;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.invoices.list({
      status: "paid",
      limit: 100,
      ...(params.customer ? { customer: params.customer } : {}),
      ...(params.createdGte ? { created: { gte: params.createdGte } } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data: any[] = page?.data ?? [];
    for (const inv of data) {
      const p = paidInvoiceOf(inv);
      if (p) out.push(p);
    }
    if (!page?.has_more || !data.length || out.length >= max) break;
    startingAfter = data[data.length - 1].id;
  }
  return out;
}

/** Insert payments rows for paid invoices. Duplicate invoice ids are skipped (unique index). */
export async function importPaidInvoices(
  admin: Admin,
  rental: { id: string; application_id: string | null; vehicle_id: string | null },
  invoices: PaidInvoice[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  if (!invoices.length) return { inserted, skipped };
  const existing = await admin.from("payments").select("stripe_invoice_id").in("stripe_invoice_id", invoices.map((i) => i.id));
  if (existing.error) throw new Error(existing.error.message);
  const have = new Set((existing.data ?? []).map((r: any) => r.stripe_invoice_id));
  for (const inv of invoices) {
    if (have.has(inv.id)) { skipped++; continue; }
    const res = await admin.from("payments").insert(paymentRowForPaidInvoice(inv, rental));
    if (res.error) {
      if (res.error.code === "23505") { skipped++; continue; }
      throw new Error(res.error.message);
    }
    inserted++;
  }
  return { inserted, skipped };
}

export type ActivationLink = {
  customerId: string | null;
  subscriptionId: string | null;
  imported: number;
  nextDue: string | null;
  error?: string;
};

/**
 * After activation: copy the application's customer to the rental (finding or
 * creating it if needed), attach the customer's one active subscription when
 * the rental has none, import paid invoices billed on or after the rental's
 * start minus 2 days, and move next_payment_due past the paid weeks. Never throws.
 */
export async function linkRentalOnActivation(admin: Admin, stripe: StripeLike, rentalId: string): Promise<ActivationLink> {
  const out: ActivationLink = { customerId: null, subscriptionId: null, imported: 0, nextDue: null };
  try {
    const { data: rental } = await admin
      .from("rentals")
      .select("id, application_id, vehicle_id, status, start_date, weekly_rate, next_payment_due, stripe_customer_id, stripe_subscription_id")
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental || rental.status !== "active") return { ...out, error: "rental_not_active" };
    let customerId: string | null = rental.stripe_customer_id ?? null;
    if (!customerId && rental.application_id) {
      const { data: app } = await admin
        .from("applications")
        .select("id, full_name, email, phone, stripe_customer_id")
        .eq("id", rental.application_id)
        .maybeSingle();
      if (app) customerId = await ensureApplicationStripeCustomer(admin, stripe, app);
    }
    if (!customerId) return { ...out, error: "no_customer" };
    out.customerId = customerId;

    let subscriptionId: string | null = rental.stripe_subscription_id ?? null;
    if (!subscriptionId) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 3 });
      const active: any[] = subs?.data ?? [];
      if (active.length === 1) subscriptionId = active[0].id;
    }
    out.subscriptionId = subscriptionId;

    const patch: Record<string, unknown> = {};
    if (!rental.stripe_customer_id) patch.stripe_customer_id = customerId;
    if (subscriptionId && !rental.stripe_subscription_id) { patch.stripe_subscription_id = subscriptionId; patch.autopay_active = true; }

    const { addDaysIso } = await import("@/lib/rent-reminders");
    const since = rental.start_date ? addDaysIso(String(rental.start_date).slice(0, 10), -2) : null;
    const paid = (await listPaidInvoices(stripe, { customer: customerId, max: 100 }))
      .filter((i) => !since || i.createdOn >= since);
    const imp = await importPaidInvoices(admin, rental, paid);
    out.imported = imp.inserted;

    const nextDue = nextDueAfterPaidWeeks(rental.next_payment_due ?? null, paid.map((p) => ({ createdOn: p.createdOn, amount: p.amountPaid })), Number(rental.weekly_rate ?? 0));
    if (nextDue && nextDue !== rental.next_payment_due) { patch.next_payment_due = nextDue; patch.payment_status = "current"; }
    out.nextDue = nextDue;

    if (Object.keys(patch).length) {
      let q = admin.from("rentals").update(patch).eq("id", rentalId);
      if (patch.stripe_subscription_id) q = q.is("stripe_subscription_id", null);
      const upd = await q;
      if (upd?.error) out.error = upd.error.message;
    }
    return out;
  } catch (err) {
    console.error("[stripe-link] activation link failed", { rentalId, err: String((err as Error)?.message ?? err) });
    return { ...out, error: String((err as Error)?.message ?? err) };
  }
}

/** Lookback window for the daily check. */
export const RECONCILE_DAYS = 14;

/** Build the reconciliation report (read-only). */
export async function buildStripeLinkReport(admin: Admin, stripe: StripeLike, now: Date): Promise<ReconcileReport> {
  const gte = Math.floor(now.getTime() / 1000) - RECONCILE_DAYS * 86400;
  const invoices = await listPaidInvoices(stripe, { createdGte: gte });
  const ids = invoices.map((i) => i.id);
  const recorded = ids.length ? await admin.from("payments").select("stripe_invoice_id").in("stripe_invoice_id", ids) : { data: [], error: null };
  if (recorded.error) throw new Error(recorded.error.message);
  const rentals = await admin.from("rentals").select("id, status, application_id, stripe_customer_id");
  if (rentals.error) throw new Error(rentals.error.message);
  const apps = await admin.from("applications").select("id, stripe_customer_id").not("stripe_customer_id", "is", null);
  if (apps.error) throw new Error(apps.error.message);
  const appCus = new Map<string, string>((apps.data ?? []).map((a: any) => [a.id, a.stripe_customer_id]));
  const active = new Set<string>();
  const known = new Set<string>();
  for (const r of rentals.data ?? []) {
    const ids2 = [r.stripe_customer_id, r.application_id ? appCus.get(r.application_id) : null].filter(Boolean) as string[];
    for (const c of ids2) { known.add(c); if (r.status === "active") active.add(c); }
  }
  return reconcileStripeLinks({
    invoices,
    recordedInvoiceIds: new Set((recorded.data ?? []).map((r: any) => r.stripe_invoice_id)),
    activeCustomerIds: active,
    knownCustomerIds: known,
  });
}

/**
 * Daily check, called from ops-reminders only when the stripe_link_reconciliation
 * switch is on. Emails team@ once per ET day, and only when something is off.
 */
export async function runStripeLinkReconciliation(
  admin: Admin,
  deps: { stripe: StripeLike; now?: Date; send?: (r: ReconcileReport & { today: string }) => Promise<{ ok: boolean }> },
): Promise<{ sent: boolean; report: ReconcileReport | null; reason?: string }> {
  const now = deps.now ?? new Date();
  const today = easternParts(now).date;
  const kind = `stripe_link_reconciliation:${today}`;
  const prior = await admin.from("outbound_messages").select("id").eq("kind", kind).limit(1);
  if (prior.error) return { sent: false, report: null, reason: "ledger_unavailable" };
  if (prior.data?.length) return { sent: false, report: null, reason: "already_sent" };
  const report = await buildStripeLinkReport(admin, deps.stripe, now);
  if (reconcileReportIsEmpty(report)) return { sent: false, report, reason: "nothing_to_link" };
  const send = deps.send ?? (async (r) => (await import("@/lib/email.server")).sendTeamStripeLinkReconciliationEmail(r));
  const res = await send({ ...report, today });
  await admin.from("outbound_messages").insert({
    channel: "email", to_address: "team@drivereal.com", subject: "Stripe Payments To Link",
    body: `${report.missing.length} unrecorded, ${report.unlinkedCustomers.length} unlinked`,
    status: res.ok ? "sent" : "skipped", provider: "resend", kind, sent_at: new Date().toISOString(),
  }).then(() => {}, () => {});
  return { sent: res.ok, report };
}
