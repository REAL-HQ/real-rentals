// Stores a succeeded Stripe payment the matcher could not assign, and lets a
// Manager assign it to one rental or dismiss it. Assigning writes one payments
// row through the same one-off path (oldest unpaid period, unique payment
// intent / invoice). Dismissing writes no payment. Phone numbers are not stored.
import type { OneOffIdentity } from "@/lib/one-off-payment";
import { unmatchedWhyLabel, type UnmatchedPaymentRow, type UnmatchedWhy } from "@/lib/unmatched-payments";

type Admin = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function storeUnmatchedPayment(admin: Admin, id: OneOffIdentity, why: UnmatchedWhy): Promise<void> {
  const intent = text(id.paymentIntentId);
  const invoice = text((id as { invoiceId?: string | null }).invoiceId);
  const charge = text(id.chargeId);
  if (!intent && !invoice && !charge) return;
  try {
    if (intent) {
      const prior = await admin.from("unmatched_stripe_payments").select("id").eq("stripe_payment_intent_id", intent).limit(1);
      if (prior?.data?.length) return;
    }
    if (invoice) {
      const prior = await admin.from("unmatched_stripe_payments").select("id").eq("stripe_invoice_id", invoice).limit(1);
      if (prior?.data?.length) return;
    }
    if (charge) {
      const prior = await admin.from("unmatched_stripe_payments").select("id").eq("stripe_charge_id", charge).limit(1);
      if (prior?.data?.length) return;
    }
    const ins = await admin.from("unmatched_stripe_payments").insert({
      stripe_payment_intent_id: intent,
      stripe_invoice_id: invoice,
      stripe_charge_id: charge,
      stripe_customer_id: id.customerIds[0] ?? null,
      amount_cents: id.amountCents,
      currency: (id.currency || "usd").slice(0, 8),
      renter_name: id.renterName ? id.renterName.slice(0, 200) : null,
      email: id.emails[0] ?? null,
      why,
      status: "open",
    });
    if (ins?.error && String(ins.error.code) !== "23505") {
      console.error("[unmatched-payments] store failed", ins.error.message ?? ins.error);
    }
  } catch (err) {
    console.error("[unmatched-payments] store failed", err);
  }
}

function rowOf(r: Record<string, any>): UnmatchedPaymentRow {
  const why = r.why === "ambiguous" ? "ambiguous" : "no_match";
  const status = r.status === "assigned" || r.status === "dismissed" ? r.status : "open";
  return {
    id: String(r.id),
    status,
    why,
    amountCents: Number(r.amount_cents) || 0,
    currency: String(r.currency || "usd"),
    renterName: text(r.renter_name),
    email: text(r.email),
    stripePaymentIntentId: text(r.stripe_payment_intent_id),
    stripeInvoiceId: text(r.stripe_invoice_id),
    stripeChargeId: text(r.stripe_charge_id),
    stripeCustomerId: text(r.stripe_customer_id),
    rentalId: text(r.rental_id),
    paymentId: text(r.payment_id),
    note: text(r.note),
    createdAt: text(r.created_at),
  };
}

export async function listUnmatchedPayments(admin: Admin): Promise<UnmatchedPaymentRow[]> {
  const res = await admin.from("unmatched_stripe_payments").select("*").eq("status", "open").order("created_at", { ascending: true }).limit(200);
  if (res?.error) throw new Error("Could not read Unmatched Payments.");
  return ((res?.data ?? []) as Record<string, any>[]).map(rowOf);
}

async function openRow(admin: Admin, id: string): Promise<Record<string, any>> {
  if (!UUID.test(id)) throw new Error("That Unmatched Payment was not found.");
  const res = await admin.from("unmatched_stripe_payments").select("*").eq("id", id).maybeSingle();
  const row = res?.data;
  if (!row) throw new Error("That Unmatched Payment was not found.");
  if (row.status !== "open") throw new Error(`This payment is already ${row.status === "assigned" ? "Assigned" : "Dismissed"}.`);
  return row;
}

export async function dismissUnmatchedPayment(admin: Admin, input: { id: string; note: string; actorId: string }): Promise<void> {
  const note = input.note.trim();
  if (note.length < 3) throw new Error("Enter a Dismiss Reason.");
  const row = await openRow(admin, input.id);
  const upd = await admin.from("unmatched_stripe_payments").update({
    status: "dismissed",
    note: note.slice(0, 500),
    dismissed_by: input.actorId,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("status", "open").select("id");
  if (upd?.error || !(upd?.data?.length)) throw new Error("Could not dismiss that payment.");
  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(null, {
      action: "payment.unmatched_dismissed",
      summary: `Dismissed unmatched Stripe payment ${row.stripe_payment_intent_id || row.stripe_invoice_id || row.stripe_charge_id || row.id}`,
      entityType: "payment",
      entityId: row.id,
      metadata: { why: unmatchedWhyLabel(row.why), note: note.slice(0, 200) },
    });
  } catch { /* the dismiss already stuck */ }
}

export async function assignUnmatchedPayment(admin: Admin, input: { id: string; rentalId: string; actorId: string }): Promise<{ paymentId: string | null }> {
  if (!UUID.test(input.rentalId)) throw new Error("Enter the rental id.");
  const row = await openRow(admin, input.id);
  const rentalRes = await admin.from("rentals").select("id, application_id, vehicle_id, status, stripe_customer_id, weekly_rate, next_payment_due, payment_status").eq("id", input.rentalId).maybeSingle();
  const rental = rentalRes?.data;
  if (!rental) throw new Error("That rental was not found.");
  const intent = text(row.stripe_payment_intent_id);
  const invoice = text(row.stripe_invoice_id);
  let existing: { id: string; rental_id?: string | null } | null = null;
  if (intent) {
    const found = await admin.from("payments").select("id, rental_id").eq("stripe_payment_intent_id", intent).limit(1);
    existing = found?.data?.[0] ?? null;
  }
  if (!existing && invoice) {
    const found = await admin.from("payments").select("id, rental_id").eq("stripe_invoice_id", invoice).limit(1);
    existing = found?.data?.[0] ?? null;
  }
  let paymentId = existing?.id ?? null;
  if (!existing) {
    const { insertMatchedOneOff } = await import("@/lib/one-off-payment.server");
    const identity: OneOffIdentity & { invoiceId?: string | null } = {
      paymentIntentId: intent ?? "",
      chargeId: text(row.stripe_charge_id),
      sessionId: null,
      paymentLinkId: null,
      rentalId: rental.id,
      applicationIds: [],
      plates: [],
      forDate: null,
      weeks: [],
      renterName: text(row.renter_name),
      customerIds: text(row.stripe_customer_id) ? [String(row.stripe_customer_id)] : [],
      emails: text(row.email) ? [String(row.email)] : [],
      phones: [],
      billingNames: [],
      amountCents: Number(row.amount_cents) || 0,
      currency: String(row.currency || "usd"),
      paidAt: row.created_at ? Math.floor(Date.parse(row.created_at) / 1000) : null,
      purpose: null,
      reason: null,
      receiptUrl: null,
      paymentMethod: null,
      invoiceId: invoice,
    };
    const written = await insertMatchedOneOff(admin, identity, rental, "staff");
    paymentId = written.paymentId;
  }
  const upd = await admin.from("unmatched_stripe_payments").update({
    status: "assigned",
    rental_id: rental.id,
    payment_id: paymentId,
    assigned_by: input.actorId,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("status", "open").select("id");
  if (upd?.error || !(upd?.data?.length)) throw new Error("The payment was recorded but the queue could not be updated. Refresh and check Payments.");
  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(null, {
      action: "payment.unmatched_assigned",
      summary: `Assigned unmatched Stripe payment to rental ${rental.id}`,
      entityType: "rental",
      entityId: rental.id,
      metadata: { unmatched_id: row.id, payment_id: paymentId },
    });
  } catch { /* assignment already stuck */ }
  return { paymentId };
}
