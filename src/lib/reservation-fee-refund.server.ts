/**
 * Idempotent Reservation Fee refund: one Stripe refund per paid fee, an audit
 * row, the rental marked refunded, and a FLEET reservation_refunded event.
 *
 * Used by: staff "Refund Reservation" (manager/owner), POST /api/public/fleet/refund-reservation,
 * and the auto-refund when the Renter Policy is marked declined (Automations
 * switch "Auto-Refund Reservation On Insurance Decline", default OFF).
 *
 * Never issues a refund without one of the six refundable reasons. Never names
 * the insurance broker or carrier. A fee kept for a missed pickup is refused.
 */
import { RESERVATION_FEE_REASON } from "@/lib/reservation-fee";
import {
  AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY,
  RESERVATION_FEE_REFUND_POLICY_STAFF,
  isReservationFeeRefundReason,
  parseReservationFeeRefundReason,
  refundReasonFromNotes,
  type ReservationFeeRefundReason,
} from "@/lib/reservation-fee-refund";
import { fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";

type Admin = any;
type StripeLike = any;

export type RefundReservationSource = "staff" | "fleet" | "auto_insurance_decline";

export type RefundReservationActor = { userId: string | null; email: string | null; role?: string | null };

export type RefundReservationInput = {
  paymentId?: string | null;
  applicationId?: string | null;
  rentalId?: string | null;
  reason: unknown;
  note?: string | null;
  source: RefundReservationSource;
  actor: RefundReservationActor;
};

export type RefundReservationOk = {
  status: "refunded" | "already";
  paymentId: string;
  applicationId: string | null;
  rentalId: string | null;
  amount: number;
  reason: ReservationFeeRefundReason;
  stripeRefundId: string | null;
  refundRowId: string | null;
};
export type RefundReservationBlocked = {
  status: "blocked";
  code:
    | "no_reason"
    | "not_found"
    | "not_reservation_fee"
    | "not_paid"
    | "kept"
    | "no_stripe"
    | "stripe_failed"
    | "switched_off"
    | "controls_unreadable";
  error: string;
};
export type RefundReservationResult = RefundReservationOk | RefundReservationBlocked;

export type RefundReservationDeps = {
  settingsGate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  stripe?: StripeLike | null;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  enqueue?: (admin: Admin, row: { event_type: string; dedupe_key: string; application_id?: string | null; payload: Record<string, unknown> }) => Promise<string | null>;
  now?: () => Date;
};

const auditOf = (deps: RefundReservationDeps) =>
  deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));

async function stripeOf(deps: RefundReservationDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { stripeClient } = await import("@/lib/reservation-fee-core.server");
  return stripeClient({});
}

function cleanNote(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return s || null;
}

function isKept(notes: string | null | undefined): boolean {
  return /\bkept:/.test(String(notes ?? ""));
}

function appendNote(existing: string | null | undefined, addition: string): string {
  const cur = String(existing ?? "").trim();
  return cur ? `${cur} ${addition}`.trim() : addition;
}

async function findReservationFeePayment(
  admin: Admin,
  input: { paymentId?: string | null; applicationId?: string | null; rentalId?: string | null },
): Promise<{ payment: any; applicationId: string | null; rentalId: string | null } | { error: RefundReservationBlocked }> {
  let payment: any = null;
  let applicationId = input.applicationId ?? null;
  let rentalId = input.rentalId ?? null;

  if (input.paymentId) {
    const { data } = await admin
      .from("payments")
      .select("id,driver_id,rental_id,amount,status,reason,notes,refunded_amount,stripe_payment_intent_id")
      .eq("id", input.paymentId)
      .maybeSingle();
    payment = data ?? null;
    if (!payment) return { error: { status: "blocked", code: "not_found", error: "Reservation Fee payment not found." } };
  } else {
    if (!applicationId && rentalId) {
      const { data: rental } = await admin.from("rentals").select("id,application_id").eq("id", rentalId).maybeSingle();
      if (!rental) return { error: { status: "blocked", code: "not_found", error: "Rental not found." } };
      applicationId = rental.application_id ?? null;
    }
    if (!applicationId) return { error: { status: "blocked", code: "not_found", error: "Say which applicant, rental or Reservation Fee payment to refund." } };
    const r = await admin
      .from("payments")
      .select("id,driver_id,rental_id,amount,status,reason,notes,refunded_amount,stripe_payment_intent_id,created_at")
      .eq("driver_id", applicationId)
      .eq("reason", RESERVATION_FEE_REASON)
      .limit(10);
    const rows = ((r?.data ?? []) as any[]).filter((p) => p.status !== "void");
    payment =
      rows.find((p) => (p.status === "paid" || p.status === "refunded") && !isKept(p.notes)) ??
      rows.find((p) => p.status === "paid" || p.status === "refunded") ??
      rows[0] ??
      null;
    if (!payment) return { error: { status: "blocked", code: "not_found", error: "No Reservation Fee was found for this applicant." } };
  }

  if (String(payment.reason ?? "") !== RESERVATION_FEE_REASON && !/reservation_fee:/.test(String(payment.notes ?? ""))) {
    return { error: { status: "blocked", code: "not_reservation_fee", error: "Only a Reservation Fee can be refunded this way." } };
  }
  applicationId = applicationId ?? payment.driver_id ?? null;
  rentalId = rentalId ?? payment.rental_id ?? null;
  return { payment, applicationId, rentalId };
}

async function existingRefundRow(admin: Admin, paymentId: string): Promise<any | null> {
  const { data, error } = await admin.from("reservation_fee_refunds").select("*").eq("payment_id", paymentId).maybeSingle();
  if (error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|not find/i.test(String(error.message ?? "")))) return null;
  if (error) {
    console.error("[reservation-fee-refund] lookup failed", error.message);
    return null;
  }
  return data ?? null;
}

async function recordRefundRow(
  admin: Admin,
  row: {
    payment_id: string;
    application_id: string | null;
    rental_id: string | null;
    amount: number;
    reason: string;
    note: string | null;
    stripe_refund_id: string | null;
    stripe_payment_intent_id: string | null;
    source: string;
    refunded_by: string | null;
    refunded_by_email: string | null;
    refunded_at: string;
  },
): Promise<string | null> {
  const ins = await admin.from("reservation_fee_refunds").insert(row).select("id").maybeSingle();
  if (!ins.error && ins.data?.id) return String(ins.data.id);
  if (ins.error && (ins.error.code === "23505" || /duplicate/i.test(String(ins.error.message ?? "")))) {
    const existing = await existingRefundRow(admin, row.payment_id);
    return existing?.id ? String(existing.id) : null;
  }
  if (ins.error && (ins.error.code === "42P01" || ins.error.code === "PGRST205" || /does not exist|not find/i.test(String(ins.error.message ?? "")))) {
    return null;
  }
  if (ins.error) console.error("[reservation-fee-refund] could not write refund row", ins.error.message);
  return ins.data?.id ? String(ins.data.id) : null;
}

async function applyLocalRefund(
  admin: Admin,
  payment: any,
  args: { amount: number; reason: ReservationFeeRefundReason; stripeRefundId: string | null; chargeId: string | null; pi: string | null },
): Promise<void> {
  const refunds = args.stripeRefundId ? [{ id: args.stripeRefundId, amount: args.amount, status: "succeeded" }] : [];
  if (args.pi) {
    const rpc = await admin.rpc("apply_payment_refund", {
      _payment_ids: [payment.id],
      _cumulative: args.amount,
      _refunds: refunds,
      _charge_id: args.chargeId,
      _pi: args.pi,
    });
    if (!rpc?.error) {
      await admin.from("payments").update({ notes: appendNote(payment.notes, `refunded:${args.reason}`) }).eq("id", payment.id);
      return;
    }
    // Fall through and write the row directly if the RPC is missing or refused.
    if (rpc.error && rpc.error.code !== "PGRST202" && rpc.error.code !== "42883") {
      console.error("[reservation-fee-refund] apply_payment_refund failed", rpc.error.message);
    }
  }
  await admin
    .from("payments")
    .update({
      status: "refunded",
      refunded_amount: args.amount,
      refunded_at: new Date().toISOString(),
      notes: appendNote(payment.notes, `refunded:${args.reason}`),
      net_collected: 0,
      balance_due: 0,
    })
    .eq("id", payment.id);
}

async function markRentalRefunded(admin: Admin, rentalId: string | null, applicationId: string | null): Promise<string | null> {
  const mark = async (id: string) => {
    await admin.from("rentals").update({ reservation_deposit_status: "refunded" }).eq("id", id);
    return id;
  };
  if (rentalId) return mark(rentalId);
  if (!applicationId) return null;
  const r = await admin.from("rentals").select("id,status").eq("application_id", applicationId).eq("status", "reserved").limit(1);
  const res = ((r?.data ?? []) as any[])[0];
  return res?.id ? mark(res.id) : null;
}

async function maybeReverseWeek1Credit(admin: Admin, stripe: StripeLike, payment: any, applicationId: string | null): Promise<void> {
  if (!/credited_week1/.test(String(payment.notes ?? "")) || /credit_reversed:/.test(String(payment.notes ?? ""))) return;
  let customer: string | null = null;
  if (payment.rental_id) {
    const { data: rental } = await admin.from("rentals").select("stripe_customer_id").eq("id", payment.rental_id).maybeSingle();
    customer = rental?.stripe_customer_id ?? null;
  }
  if (!customer && applicationId) {
    const { data: app } = await admin.from("applications").select("stripe_customer_id").eq("id", applicationId).maybeSingle();
    customer = app?.stripe_customer_id ?? null;
  }
  if (!customer) return;
  await stripe.customers.createBalanceTransaction(
    customer,
    {
      amount: Math.round(Number(payment.amount) * 100),
      currency: "usd",
      description: "Reverse Reservation Fee week-1 credit after refund",
      metadata: { paymentId: payment.id, reason: "reservation_fee_credit_reversal" },
    },
    { idempotencyKey: `reservation-fee-credit-reversal:${payment.id}` },
  );
  await admin.from("payments").update({ notes: appendNote(payment.notes, `credit_reversed:${payment.id}`) }).eq("id", payment.id);
  payment.notes = appendNote(payment.notes, `credit_reversed:${payment.id}`);
}

async function enqueueRefundedEvent(
  admin: Admin,
  deps: RefundReservationDeps,
  p: { applicationId: string | null; amount: number; reason: string; stripeRefundId: string | null; paymentId: string },
): Promise<void> {
  const enqueue =
    deps.enqueue ??
    (async (a: Admin, row: any) => {
      const { enqueueFleetEvent } = await import("@/lib/fleet-webhook.server");
      return enqueueFleetEvent(a, row);
    });
  try {
    await enqueue(admin, {
      event_type: "reservation_refunded",
      dedupe_key: `reservation_refunded:${p.paymentId}`,
      application_id: p.applicationId,
      payload: {
        event: "reservation_refunded",
        lead_id: p.applicationId,
        application_id: p.applicationId,
        amount: p.amount,
        reason: p.reason,
        stripe_refund_id: p.stripeRefundId,
      },
    });
  } catch (e) {
    console.error("[reservation-fee-refund] webhook enqueue failed", String((e as Error)?.message ?? e));
  }
}

/**
 * One refund per Reservation Fee. Safe to call again: a second call returns
 * the existing refund and does not create another Stripe refund.
 */
export async function refundReservationFee(
  admin: Admin,
  input: RefundReservationInput,
  deps: RefundReservationDeps = {},
): Promise<RefundReservationResult> {
  const reason = parseReservationFeeRefundReason(input.reason);
  if (!reason) {
    return { status: "blocked", code: "no_reason", error: `Choose a refundable reason. ${RESERVATION_FEE_REFUND_POLICY_STAFF}` };
  }
  const found = await findReservationFeePayment(admin, input);
  if ("error" in found) return found.error;
  const { payment } = found;
  let { applicationId, rentalId } = found;
  const amount = Math.round(Number(payment.amount ?? 0) * 100) / 100;
  const note = cleanNote(input.note);

  if (isKept(payment.notes)) {
    return {
      status: "blocked",
      code: "kept",
      error: `The Reservation Fee was kept for a missed pickup and is not refundable. ${RESERVATION_FEE_REFUND_POLICY_STAFF}`,
    };
  }

  const alreadyRow = await existingRefundRow(admin, payment.id);
  const alreadyRefunded =
    payment.status === "refunded" || Number(payment.refunded_amount ?? 0) >= amount - 0.009 || alreadyRow;
  if (alreadyRefunded) {
    const existingReason =
      parseReservationFeeRefundReason(alreadyRow?.reason) ?? refundReasonFromNotes(payment.notes) ?? reason;
    return {
      status: "already",
      paymentId: payment.id,
      applicationId,
      rentalId: rentalId ?? alreadyRow?.rental_id ?? null,
      amount,
      reason: existingReason,
      stripeRefundId: alreadyRow?.stripe_refund_id ?? null,
      refundRowId: alreadyRow?.id ?? null,
    };
  }

  if (payment.status !== "paid") {
    return { status: "blocked", code: "not_paid", error: "Only a paid Reservation Fee can be refunded." };
  }

  const pi = payment.stripe_payment_intent_id ?? null;
  if (!pi) {
    return {
      status: "blocked",
      code: "no_stripe",
      error: "This Reservation Fee was not charged through Stripe, so it cannot be refunded here. Return the money the same way it was paid.",
    };
  }

  const stripe = await stripeOf(deps);
  if (!stripe?.refunds?.create) {
    return { status: "blocked", code: "stripe_failed", error: "Card refunds are not configured. Nothing was refunded." };
  }

  try {
    await maybeReverseWeek1Credit(admin, stripe, payment, applicationId);
  } catch (e) {
    console.error("[reservation-fee-refund] week-1 credit reversal failed", e);
    return { status: "blocked", code: "stripe_failed", error: "The week-1 credit could not be reversed, so the Reservation Fee was not refunded. Try again or refund it in Stripe." };
  }

  let refund: any;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: pi,
        amount: Math.round(amount * 100),
        reason: "requested_by_customer",
        metadata: {
          paymentId: payment.id,
          applicationId: applicationId ?? "",
          reason,
          source: input.source,
        },
      },
      { idempotencyKey: `reservation-fee-refund:${payment.id}` },
    );
  } catch (e: any) {
    console.error("[reservation-fee-refund] Stripe refund failed", e);
    return { status: "blocked", code: "stripe_failed", error: "Stripe could not refund the Reservation Fee. Nothing was changed." };
  }
  const stripeRefundId = refund?.id ? String(refund.id) : null;
  const now = (deps.now ?? (() => new Date()))().toISOString();

  await applyLocalRefund(admin, payment, {
    amount,
    reason,
    stripeRefundId,
    chargeId: refund?.charge ? String(refund.charge) : null,
    pi,
  });
  const markedRental = await markRentalRefunded(admin, rentalId, applicationId);
  rentalId = markedRental ?? rentalId;

  const refundRowId = await recordRefundRow(admin, {
    payment_id: payment.id,
    application_id: applicationId,
    rental_id: rentalId,
    amount,
    reason,
    note,
    stripe_refund_id: stripeRefundId,
    stripe_payment_intent_id: pi,
    source: input.source,
    refunded_by: input.actor.userId,
    refunded_by_email: input.actor.email,
    refunded_at: now,
  });

  await auditOf(deps)({
    action: "payment.reservation_fee_refunded",
    summary: `Reservation Fee $${amount.toFixed(2)} refunded (${reason})`,
    entityType: "payment",
    entityId: payment.id,
    metadata: {
      reason,
      note,
      source: input.source,
      stripe_refund_id: stripeRefundId,
      application_id: applicationId,
      rental_id: rentalId,
      amount,
      actor_email: input.actor.email,
      automatic: input.source !== "staff",
    },
  }).catch((e) => console.error("[reservation-fee-refund] audit failed", e));

  await enqueueRefundedEvent(admin, deps, { applicationId, amount, reason, stripeRefundId, paymentId: payment.id });

  return {
    status: "refunded",
    paymentId: payment.id,
    applicationId,
    rentalId,
    amount,
    reason,
    stripeRefundId,
    refundRowId,
  };
}

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

/**
 * When the Renter Policy is marked declined, refund the paid Reservation Fee
 * if the Automations switch is On. Fail closed if the switch cannot be read.
 * Idempotent: a second decline does not refund twice.
 */
export async function maybeAutoRefundReservationOnInsuranceDecline(
  admin: Admin,
  input: { applicationId: string; note?: string | null; actor: RefundReservationActor },
  deps: RefundReservationDeps = {},
): Promise<RefundReservationResult | { status: "skipped"; code: "switched_off" | "controls_unreadable" | "no_paid_fee"; error: string }> {
  const gate = await (deps.settingsGate ?? defaultGate)(admin, AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY).catch(() => "held" as const);
  if (gate === "off") return { status: "skipped", code: "switched_off", error: "Auto-Refund Reservation On Insurance Decline is Off." };
  if (gate !== "send") return { status: "skipped", code: "controls_unreadable", error: "Automation switches could not be read; the Reservation Fee was not refunded." };
  const result = await refundReservationFee(
    admin,
    {
      applicationId: input.applicationId,
      reason: "insurance_declined",
      note: input.note ?? "Renter Policy declined.",
      source: "auto_insurance_decline",
      actor: input.actor,
    },
    deps,
  );
  if (result.status === "blocked" && (result.code === "not_found" || result.code === "not_paid")) {
    return { status: "skipped", code: "no_paid_fee", error: result.error };
  }
  return result;
}

/**
 * Staff or FLEET marks the Renter Policy declined. Records the status (when
 * the column is installed) and, if the auto-refund switch is On, refunds the
 * Reservation Fee.
 */
export async function markRenterPolicyDeclined(
  admin: Admin,
  input: { applicationId: string; note?: string | null; actor: RefundReservationActor },
  deps: RefundReservationDeps = {},
): Promise<{ ok: true; refund: Awaited<ReturnType<typeof maybeAutoRefundReservationOnInsuranceDecline>> }> {
  const note = cleanNote(input.note);
  const patch: Record<string, unknown> = { renter_policy_status: "declined" };
  const upd = await admin.from("applications").update(patch).eq("id", input.applicationId).select("id");
  if (upd.error && !(upd.error.code === "42703" || /renter_policy_status|schema cache/i.test(String(upd.error.message ?? "")))) {
    throw new Error("Could not record that the Renter Policy was declined.");
  }
  await auditOf(deps)({
    action: "insurance.renter_policy_declined",
    summary: "Renter Policy declined",
    entityType: "application",
    entityId: input.applicationId,
    metadata: { note, decided_by: input.actor.userId, decided_by_email: input.actor.email, automatic: false },
  }).catch((e) => console.error("[reservation-fee-refund] decline audit failed", e));
  const refund = await maybeAutoRefundReservationOnInsuranceDecline(admin, input, deps);
  return { ok: true, refund };
}

export async function loadRenterPolicyStatus(admin: Admin, applicationId: string): Promise<"pending" | "issued" | "declined" | null> {
  const { data, error } = await admin.from("applications").select("renter_policy_status").eq("id", applicationId).maybeSingle();
  if (error || !data) return null;
  const s = String((data as any).renter_policy_status ?? "");
  return s === "pending" || s === "issued" || s === "declined" ? s : null;
}

/** Lookup used by the Next Step row: paid / pending / refunded:<reason>. */
export async function reservationFeeStatusForApplication(
  admin: Admin,
  applicationId: string,
): Promise<{ status: string | null; reason: ReservationFeeRefundReason | null; paymentId: string | null }> {
  const r = await admin
    .from("payments")
    .select("id,status,reason,notes,refunded_amount")
    .eq("driver_id", applicationId)
    .eq("reason", RESERVATION_FEE_REASON)
    .limit(10);
  let rows = ((r?.data ?? []) as any[]).filter((p) => p.status !== "void");
  if (!rows.length) {
    // A fee paid before the rental existed carries rental_id NULL and may sit
    // under a different driver id; find it through the application's rentals.
    const rentals = await admin.from("rentals").select("id,reservation_deposit_payment_id").eq("application_id", applicationId).limit(10);
    const rentalRows = ((rentals as any)?.data ?? []) as any[];
    const payIds = rentalRows.map((x) => x.reservation_deposit_payment_id).filter(Boolean);
    const rentalIds = rentalRows.map((x) => x.id).filter(Boolean);
    const ors = [...payIds.map((id) => `id.eq.${id}`), ...rentalIds.map((id) => `rental_id.eq.${id}`), ...rentalIds.map((id) => `notes.like.reservation_fee:${id}%`)];
    if (ors.length) {
      const more = await admin.from("payments").select("id,status,reason,notes,refunded_amount").eq("reason", RESERVATION_FEE_REASON).or(ors.join(",")).limit(10);
      rows = (((more as any)?.data ?? []) as any[]).filter((p) => p.status !== "void");
    }
  }
  const row =
    rows.find((p) => p.status === "refunded" || Number(p.refunded_amount ?? 0) > 0) ??
    rows.find((p) => p.status === "paid" && !isKept(p.notes)) ??
    rows.find((p) => p.status === "pending" || p.status === "unpaid" || p.status === "current") ??
    null;
  if (!row) return { status: null, reason: null, paymentId: null };
  if (row.status === "refunded" || Number(row.refunded_amount ?? 0) > 0) {
    const reason = refundReasonFromNotes(row.notes);
    return { status: reason ? `refunded:${reason}` : "refunded", reason, paymentId: row.id };
  }
  if (row.status === "paid") return { status: "paid", reason: null, paymentId: row.id };
  if (row.status === "waived") return { status: "waived", reason: null, paymentId: row.id };
  return { status: "pending", reason: null, paymentId: row.id };
}

export async function handleFleetRefundReservation(request: Request, deps: FleetDeps & RefundReservationDeps = {}): Promise<Response> {
  const got = await fleetRequestBody(request, deps);
  if ("response" in got) return got.response;
  const body = got.body;
  const key = idempotencyKey(body.idempotency_key);
  if (key === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1–120 printable characters." });
  const lead = String(body.lead_id ?? body.application_id ?? "").trim();
  const rentalId = String(body.rental_id ?? "").trim();
  const paymentId = String(body.payment_id ?? "").trim();
  if (lead && !UUID_RE.test(lead)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  if (rentalId && !UUID_RE.test(rentalId)) return fleetJson(400, { ok: false, error: "rental_id must be a UUID." });
  if (paymentId && !UUID_RE.test(paymentId)) return fleetJson(400, { ok: false, error: "payment_id must be a UUID." });
  if (!lead && !rentalId && !paymentId) return fleetJson(400, { ok: false, error: "Send lead_id (or application_id), rental_id or payment_id." });
  if (!isReservationFeeRefundReason(body.reason)) {
    return fleetJson(400, {
      ok: false,
      error: `reason must be one of: insurance_declined, no_vehicle, failed_inspection, terms_changed, post_payment_denial, duplicate_or_mistaken_charge. ${RESERVATION_FEE_REFUND_POLICY_STAFF}`,
      reason: "no_reason",
    });
  }
  const admin = await fleetAdmin(deps);
  const result = await refundReservationFee(
    admin,
    {
      paymentId: paymentId || null,
      applicationId: lead || null,
      rentalId: rentalId || null,
      reason: body.reason,
      note: body.note ?? null,
      source: "fleet",
      actor: { userId: null, email: "FLEET (automated)", role: "fleet" },
    },
    { ...deps, audit: deps.audit ?? fleetAudit(deps) },
  );
  if (result.status === "blocked") {
    const status = result.code === "not_found" ? 404 : result.code === "no_reason" ? 400 : result.code === "stripe_failed" ? 502 : 409;
    return fleetJson(status, { ok: false, error: result.error, reason: result.code });
  }
  const bodyOut = {
    ok: true,
    already: result.status === "already",
    lead_id: result.applicationId,
    application_id: result.applicationId,
    payment_id: result.paymentId,
    rental_id: result.rentalId,
    amount: result.amount,
    reason: result.reason,
    stripe_refund_id: result.stripeRefundId,
    refund_id: result.refundRowId,
  };
  return fleetJson(result.status === "already" ? 200 : 201, bodyOut);
}
