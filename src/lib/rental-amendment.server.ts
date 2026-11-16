/**
 * Send a new / updated rental agreement to an ACTIVE rental, with a weekly
 * rate change that only takes effect once the renter signs.
 *
 *   POST /api/public/fleet/amend-agreement   (Bearer FLEET_API_KEY)
 *   Back office: Bookings → an active rental → Send Updated Agreement
 *
 * Order (every step must pass; a refusal stores and sends nothing):
 *   1. The rental is active and has an application; FLEET only: the
 *      Automations switch "Updated Agreements (FLEET)" is On, it is 8 AM–9 PM
 *      ET, and the person is not handed off to staff (bots paused).
 *   2. The new rate differs from today's, is inside $200–$1,000/week (outside
 *      that, FLEET is refused and staff must tick an acknowledgment), and the
 *      effective date is today or later (never retroactive).
 *   3. A rate increase has logged renter consent. FLEET's text consent must be
 *      a real inbound text on our Quo lines from the renter's phone that
 *      contains the quoted words.
 *   4. No other amendment or unsigned agreement is out for this rental, and
 *      the agreement the site would print has no blockers.
 *   5. The amendment is stored as pending_signature (public.rental_rate_amendments),
 *      then the agreement goes out through issueAgreement (same template, same
 *      e-sign flow), printing the new rate with an amendment notice. The old
 *      signed agreement stays on file and is linked as previous_agreement_id.
 *   6. On signing (esign.server.ts completeSigning → onAmendmentSigned) the
 *      apply date is fixed (effective date, or the next rent week if signed
 *      later) and apply_rental_rate_amendment changes rentals.weekly_rate on
 *      that date. Stripe is never called here: a rental with a Stripe
 *      subscription is flagged stripe_update_required for staff.
 * Everything is audit-logged. Idempotent on idempotency_key.
 */
import {
  cleanText,
  fleetAdmin,
  fleetAudit,
  fleetJson,
  fleetRequestBody,
  idempotencyKey,
  tableMissing,
  UUID_RE,
  type FleetDeps,
} from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
import { contractTodayIso } from "@/lib/agreement-dates";
import {
  AMENDMENT_CONSENT_CHANNELS,
  AMENDMENT_RATE_MAX,
  AMENDMENT_RATE_MIN,
  AMENDMENT_TEMPLATE_KEY,
  RENTAL_AMENDMENTS_KEY,
  amendmentPrep,
  parseAmendmentTerms,
  amendmentNoticeText,
  applyOnDate,
  parseMoney,
  parseRenterConsent,
  resolveEffectiveDate,
  withinRateBounds,
  type RenterConsent,
} from "@/lib/rental-amendment";

type Admin = any;
type Audit = (e: { action: string; summary: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }) => Promise<void>;
export const AMENDMENTS_TABLE = "rental_rate_amendments";
const OPEN_AGREEMENT = ["sent", "viewed", "signing"];

export type IssueAmendment = {
  weeklyRate: number;
  notice: string;
  /** Always no Reservation Fee / no deposit (amendmentPrep). */
  prep: import("@/lib/agreement-prep").AgreementPrep;
  /** v1.14 (AMENDMENT_TEMPLATE_KEY). */
  templateKey: string;
  vehicleId: string | null;
  rentalId: string;
  metadata: Record<string, unknown>;
};
export type AmendmentCheck = { blockers: { field: string; label: string; why: string }[]; weeklyRate: number | null; vehicleLabel: string | null };

export type AmendDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  handoff?: (admin: Admin, leadId: string) => Promise<{ id: string; reason: string } | null | "unavailable">;
  check?: (admin: Admin, applicationId: string, a: IssueAmendment) => Promise<AmendmentCheck>;
  issue?: (admin: Admin, applicationId: string, opts: { createdBy: string | null; amendment: IssueAmendment }) => Promise<{ id: string; url: string; delivery: { email: string; sms: string; delivered: boolean } }>;
  verifySms?: typeof verifySmsConsent;
  withinHours?: (now: Date) => boolean;
  notifyFleet?: (admin: Admin, payload: Record<string, unknown>) => Promise<unknown>;
};

export type ProposeInput = {
  rentalId: string;
  /** v1.14 choices (damage waiver, payment schedule/method, vehicle owner); default: from the agreement being amended. */
  termsRaw?: unknown;
  newWeeklyRate: unknown;
  effectiveDate: unknown;
  reason: unknown;
  consentRaw: unknown;
  source: "fleet" | "staff";
  requestedBy: string;
  requestedByUser: string | null;
  outOfBoundsAck: boolean;
  idempotencyKey: string | null;
};

type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { ok: false, error, ...extra } });

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9$'.]+/g, " ").trim();
const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);

/**
 * FLEET's text consent: an inbound message.received on our lines, from this
 * renter's phone, within 15 minutes of received_at, whose text contains the
 * quoted words. Looked up by message_id when given.
 */
export async function verifySmsConsent(admin: Admin, renterPhone: unknown, c: RenterConsent): Promise<{ ok: true; quo_event_id: string; body: string } | { ok: false; status: number; error: string }> {
  const mine = last10(renterPhone);
  if (mine.length !== 10) return { ok: false, status: 409, error: "The renter has no phone number on file to match the text against." };
  const t = Date.parse(c.received_at);
  let q = admin.from("quo_events").select("id,event_type,quo_resource_id,direction,from_e164,body,occurred_at,created_at").eq("event_type", "message.received");
  q = c.message_id
    ? q.eq("quo_resource_id", c.message_id)
    : q.gte("occurred_at", new Date(t - 15 * 60_000).toISOString()).lte("occurred_at", new Date(t + 15 * 60_000).toISOString());
  const res = await q.limit(25);
  if (res.error) {
    if (tableMissing(res.error, "quo_events")) return { ok: false, status: 503, error: "Text history is not set up (quo_events). Nothing was sent." };
    return { ok: false, status: 503, error: "Could not read the text history. Nothing was sent." };
  }
  const want = norm(c.quote);
  const rows = (Array.isArray(res.data) ? res.data : []) as any[];
  const hit = rows.find((m) => (!m.direction || m.direction === "incoming") && last10(m.from_e164) === mine && norm(m.body).includes(want));
  if (!hit) {
    return { ok: false, status: 409, error: "No inbound text from the renter's phone with those words was logged on our lines around received_at. Nothing was sent. Staff can record the consent and send it from the rental page.", reason: "consent_not_found" } as any;
  }
  const at = Date.parse(String(hit.occurred_at ?? hit.created_at ?? ""));
  if (Number.isFinite(at) && Math.abs(at - t) > 15 * 60_000) return { ok: false, status: 400, error: "renter_consent.received_at must be the time the text arrived." };
  return { ok: true, quo_event_id: String(hit.id), body: String(hit.body ?? "") };
}

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

/** The newest signed agreement for this applicant (the one being amended). */
async function previousSigned(admin: Admin, applicationId: string): Promise<{ id: string; signed_at: string | null; prep: unknown } | null> {
  const r = await admin.from("agreements").select("id,status,signed_at,voided_at,created_at,merge_data").eq("application_id", applicationId).eq("status", "signed").order("signed_at", { ascending: false }).limit(1);
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return row && !row.voided_at ? { id: row.id, signed_at: row.signed_at ?? null, prep: (row.merge_data as any)?._prep ?? null } : null;
}

/** An open amendment whose agreement was voided or expired no longer blocks a new one. */
async function openAmendment(admin: Admin, rentalId: string, now: Date): Promise<{ id: string; agreement_id: string | null } | null | "missing" | "error"> {
  const r = await admin.from(AMENDMENTS_TABLE).select("id,agreement_id,status").eq("rental_id", rentalId).eq("status", "pending_signature").limit(5);
  if (r.error) return tableMissing(r.error, AMENDMENTS_TABLE) ? "missing" : "error";
  for (const row of (r.data ?? []) as any[]) {
    if (row.agreement_id) {
      const ag = await admin.from("agreements").select("id,status,voided_at,token_expires_at").eq("id", row.agreement_id).maybeSingle();
      const a = ag.data;
      const dead = !a || a.voided_at || a.status === "voided" || (a.status !== "signed" && a.token_expires_at && Date.parse(a.token_expires_at) < now.getTime());
      if (dead) {
        await admin.from(AMENDMENTS_TABLE).update({ status: "voided", note: "The amended agreement was voided or expired unsigned.", updated_at: now.toISOString() }).eq("id", row.id).eq("status", "pending_signature");
        continue;
      }
    }
    return { id: row.id, agreement_id: row.agreement_id ?? null };
  }
  return null;
}

/** Shared by FLEET and the staff button. */
export async function proposeRentalAmendment(admin: Admin, input: ProposeInput, deps: Omit<AmendDeps, "now" | "audit"> & { audit: Audit; now: Date }): Promise<Result> {
  const { audit, now } = deps;
  const fleet = input.source === "fleet";
  if (!UUID_RE.test(input.rentalId)) return fail(400, "rental_id must be a UUID.");

  if (fleet) {
    const gate = await (deps.gate ?? defaultGate)(admin, RENTAL_AMENDMENTS_KEY).catch(() => "held" as const);
    if (gate === "off") return fail(409, "The Updated Agreements (FLEET) switch is Off (Back Office → Automations).", { reason: "switched_off" });
    if (gate !== "send") return fail(503, "Automation switches could not be read; try again later.", { reason: "controls_unreadable" });
    const inHours = deps.withinHours ?? (await import("@/lib/failed-payment-link")).withinTextingHours;
    if (!inHours(now)) return fail(409, "Updated agreements are only sent 8 AM to 9 PM Eastern. Nothing was stored; try again then.", { reason: "quiet_hours" });
  }

  // Idempotency first: a repeat never sends twice.
  let retryId: string | null = null;
  if (input.idempotencyKey) {
    const prior = await admin.from(AMENDMENTS_TABLE).select("id,rental_id,agreement_id,status,new_weekly_rate,effective_date").eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (prior.error) {
      if (tableMissing(prior.error, AMENDMENTS_TABLE)) return fail(503, "Updated agreements are not set up yet (proposed/rental-rate-amendments-v1.sql). Nothing was sent.", { reason: "not_installed" });
      return fail(503, "Could not read amendments.");
    }
    if (prior.data) {
      if (prior.data.rental_id !== input.rentalId) return fail(409, "idempotency_key was already used for another rental.");
      if (prior.data.status !== "send_failed") return { status: 200, body: { ok: true, duplicate: true, amendment_id: prior.data.id, agreement_id: prior.data.agreement_id ?? null, status: prior.data.status } };
      retryId = prior.data.id;
    }
  }

  const rr = await admin.from("rentals").select("id,application_id,status,weekly_rate,next_payment_due,vehicle_id,stripe_subscription_id").eq("id", input.rentalId).maybeSingle();
  if (rr.error) return fail(503, "Could not read the rental.");
  const rental = rr.data;
  if (!rental) return fail(404, "Rental not found.");
  if (rental.status !== "active") return fail(409, `Only an active rental can get an updated agreement (this one is ${rental.status}). For a new rental use send-agreement.`);
  if (!rental.application_id) return fail(409, "This rental has no application on file. Staff must handle it.");
  const leadId = String(rental.application_id);
  const oldRate = Number(rental.weekly_rate);
  if (!(oldRate > 0)) return fail(409, "The rental has no current weekly rate. Staff must handle it.");

  const app = await admin.from("applications").select("id,status,full_name,email,phone,deleted_at").eq("id", leadId).maybeSingle();
  if (app.error) return fail(503, "Could not read the renter.");
  if (!app.data || app.data.deleted_at) return fail(404, "Renter not found.");

  if (fleet) {
    const h = await (deps.handoff ?? (async (a: Admin, id: string) => (await import("@/lib/fleet-handoff.server")).activeHandoff(a, id)))(admin, leadId);
    if (h === "unavailable") return fail(503, "Could not check for a staff handoff; nothing sent.");
    if (h) return fail(423, "This person is handed off to staff; bots are paused.", { reason: "staff_handling", handoff: { decision_id: h.id, reason: h.reason } });
  }

  const newRate = parseMoney(input.newWeeklyRate);
  if (newRate === null) return fail(400, "new_weekly_rate must be a positive amount.");
  if (Math.abs(newRate - oldRate) < 0.005) return fail(400, `The rental is already $${oldRate}/week.`);
  const inBounds = withinRateBounds(newRate);
  if (!inBounds && fleet) return fail(409, `$${newRate}/week is outside $${AMENDMENT_RATE_MIN}–$${AMENDMENT_RATE_MAX}. Staff must send this one.`, { reason: "needs_staff" });
  if (!inBounds && !input.outOfBoundsAck) return fail(409, `$${newRate}/week is outside $${AMENDMENT_RATE_MIN}–$${AMENDMENT_RATE_MAX}. Confirm it is intended.`, { reason: "out_of_bounds" });

  const today = contractTodayIso(now);
  const eff = resolveEffectiveDate(input.effectiveDate, today, rental.next_payment_due ?? null);
  if (!eff.ok) return fail(400, eff.error);
  const terms = parseAmendmentTerms(input.termsRaw ?? null);
  if (!terms.ok) return fail(400, terms.error);
  const reason = cleanText(input.reason, 1000);
  if (reason.length < 5) return fail(400, "reason is required (why the agreement is changing).");

  const increase = newRate > oldRate;
  let consent: (RenterConsent & { quo_event_id?: string | null; verified: boolean; recorded_by: string }) | null = null;
  if (input.consentRaw != null || increase) {
    const { STAFF_CONSENT_CHANNELS } = await import("@/lib/rental-amendment");
    const c = parseRenterConsent(input.consentRaw, now, fleet ? AMENDMENT_CONSENT_CHANNELS : STAFF_CONSENT_CHANNELS);
    if (!c.ok) return fail(400, increase && input.consentRaw == null ? "A rate increase needs renter_consent (logged renter agreement) before it is sent." : c.error);
    consent = { ...c.value, verified: false, quo_event_id: null, recorded_by: input.requestedBy };
    if (fleet && c.value.channel === "sms") {
      const v = await (deps.verifySms ?? verifySmsConsent)(admin, app.data.phone, c.value);
      if (!v.ok) return fail(v.status, v.error, { reason: (v as any).reason ?? "consent_unverified" });
      consent.verified = true;
      consent.quo_event_id = v.quo_event_id;
    }
  }

  const open = await openAmendment(admin, rental.id, now);
  if (open === "missing") return fail(503, "Updated agreements are not set up yet (proposed/rental-rate-amendments-v1.sql). Nothing was sent.", { reason: "not_installed" });
  if (open === "error") return fail(503, "Could not read amendments.");
  if (open && open.id !== retryId) return fail(409, "An updated agreement is already out for this rental and not signed yet. Void it first or wait for the signature.", { amendment_id: open.id, agreement_id: open.agreement_id });
  const unsigned = await admin.from("agreements").select("id,status,voided_at").eq("application_id", leadId).in("status", OPEN_AGREEMENT).limit(5);
  if (unsigned.error) return fail(503, "Could not read agreements.");
  const otherOpen = ((unsigned.data ?? []) as any[]).find((a) => !a.voided_at);
  if (otherOpen) return fail(409, "An unsigned agreement is already out for this renter. Void it or wait for the signature.", { agreement_id: otherOpen.id });

  const prev = await previousSigned(admin, leadId);
  const issueAmendment: IssueAmendment = {
    weeklyRate: newRate,
    notice: amendmentNoticeText({ oldRate, newRate, effectiveDate: eff.value, previousSignedAt: prev?.signed_at ?? null }),
    vehicleId: rental.vehicle_id ?? null,
    rentalId: rental.id,
    metadata: {},
    // v1.14, never a Reservation Fee or deposit: the rental is active and week 1 is paid.
    prep: amendmentPrep(prev?.prep ?? null, terms.value),
    templateKey: AMENDMENT_TEMPLATE_KEY,
  };
  let check: AmendmentCheck;
  try {
    check = await (deps.check ?? (await import("@/lib/agreements.functions")).amendmentSendCheck)(admin, leadId, issueAmendment);
  } catch (e) {
    return fail(409, `The agreement cannot be prepared: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
  }
  if (check.blockers.length) {
    const v114 = check.blockers.filter((b) => ["damage_waiver", "payment_method", "vehicle_owner", "payment_amount"].includes(b.field) || /damage waiver|payment|vehicle owner/i.test(b.label));
    return fail(409, `The agreement has missing details. Nothing was sent.${v114.length ? " For v1.14 pass terms.damage_waiver, terms.payment_schedule, terms.payment_method and terms.vehicle_owner (the agreement being amended did not record them)." : ""}`, { blockers: check.blockers });
  }
  if (check.weeklyRate === null || Math.abs(check.weeklyRate - newRate) > 0.004) return fail(409, "The agreement would not print the new rate. Nothing was sent.", { agreement_weekly_rate: check.weeklyRate });

  // Store first: no record, no send.
  const row = {
    rental_id: rental.id,
    application_id: leadId,
    old_weekly_rate: oldRate,
    new_weekly_rate: newRate,
    effective_date: eff.value,
    reason,
    renter_consent: consent,
    status: "pending_signature",
    source: input.source,
    requested_by: input.requestedBy,
    requested_by_user: input.requestedByUser,
    out_of_bounds_ack: !inBounds,
    previous_agreement_id: prev?.id ?? null,
    idempotency_key: input.idempotencyKey,
    stripe_update_required: !!rental.stripe_subscription_id,
  };
  let amendmentId: string;
  if (retryId) {
    const { idempotency_key: _keep, ...retryRow } = row;
    const u = await admin.from(AMENDMENTS_TABLE).update({ ...retryRow, note: null, updated_at: now.toISOString() }).eq("id", retryId).eq("status", "send_failed");
    if (u.error) return fail(409, "Another updated agreement is already out for this rental.");
    amendmentId = retryId;
  } else {
    const ins = await admin.from(AMENDMENTS_TABLE).insert(row).select("id").single();
    if (ins.error || !ins.data) {
      if (tableMissing(ins.error, AMENDMENTS_TABLE)) return fail(503, "Updated agreements are not set up yet (proposed/rental-rate-amendments-v1.sql). Nothing was sent.", { reason: "not_installed" });
      if (String(ins.error?.code) === "23505") return fail(409, "An updated agreement is already out for this rental, or idempotency_key was reused. Nothing was sent.");
      return fail(503, "Could not store the amendment. Nothing was sent.");
    }
    amendmentId = String(ins.data.id);
  }
  issueAmendment.metadata = { kind: "rate_change", template_key: AMENDMENT_TEMPLATE_KEY, reservation_fee: "not_applicable", new_deposit: 0, rental_amendment_id: amendmentId, amends_agreement_id: prev?.id ?? null, old_weekly_rate: oldRate, new_weekly_rate: newRate, effective_date: eff.value };

  let sent: Awaited<ReturnType<NonNullable<AmendDeps["issue"]>>>;
  try {
    const issue = deps.issue ?? (await import("@/lib/agreements.functions")).issueAgreement;
    sent = await issue(admin, leadId, { createdBy: input.requestedByUser, amendment: issueAmendment });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await admin.from(AMENDMENTS_TABLE).update({ status: "send_failed", note: msg, updated_at: now.toISOString() }).eq("id", amendmentId);
    await audit({ action: "rental.rate_amendment_send_failed", summary: `Updated agreement not sent (${input.requestedBy}): ${msg}`, entityType: "rental", entityId: rental.id, metadata: { amendment_id: amendmentId, application_id: leadId } });
    return fail(409, `The updated agreement was not sent: ${msg}`, { amendment_id: amendmentId });
  }
  await admin.from(AMENDMENTS_TABLE).update({ agreement_id: sent.id, updated_at: now.toISOString() }).eq("id", amendmentId);
  await audit({
    action: "rental.rate_amendment_sent",
    summary: `Updated agreement sent by ${input.requestedBy}: $${oldRate} → $${newRate}/week from ${eff.value} (pending the renter's signature)`,
    entityType: "rental",
    entityId: rental.id,
    metadata: {
      amendment_id: amendmentId,
      application_id: leadId,
      agreement_id: sent.id,
      previous_agreement_id: prev?.id ?? null,
      old_weekly_rate: oldRate,
      new_weekly_rate: newRate,
      effective_date: eff.value,
      reason,
      source: input.source,
      out_of_bounds_ack: !inBounds,
      consent: consent ? { channel: consent.channel, received_at: consent.received_at, message_id: consent.message_id, call_id: consent.call_id, quo_event_id: consent.quo_event_id ?? null, verified: consent.verified } : null,
      delivery: sent.delivery,
    },
  });
  return {
    status: 201,
    body: {
      ok: true,
      amendment_id: amendmentId,
      rental_id: rental.id,
      lead_id: leadId,
      agreement_id: sent.id,
      previous_agreement_id: prev?.id ?? null,
      status: "pending_signature",
      old_weekly_rate: oldRate,
      new_weekly_rate: newRate,
      effective_date: eff.value,
      effective_date_defaulted: eff.defaulted,
      next_payment_due: rental.next_payment_due ?? null,
      stripe_update_required: !!rental.stripe_subscription_id,
      consent_verified: consent?.verified ?? null,
      delivery: sent.delivery,
    },
  };
}

/** Amendments for a rental, newest first (FLEET status / back office). */
export async function listRentalAmendments(admin: Admin, rentalId: string): Promise<Result> {
  const r = await admin.from(AMENDMENTS_TABLE).select("id,status,old_weekly_rate,new_weekly_rate,effective_date,apply_on,agreement_id,previous_agreement_id,source,requested_by,stripe_update_required,signed_at,applied_at,note,created_at").eq("rental_id", rentalId).order("created_at", { ascending: false }).limit(20);
  if (r.error) {
    if (tableMissing(r.error, AMENDMENTS_TABLE)) return fail(503, "Updated agreements are not set up yet.", { reason: "not_installed" });
    return fail(503, "Could not read amendments.");
  }
  return { status: 200, body: { ok: true, rental_id: rentalId, amendments: r.data ?? [] } };
}

async function applyOne(admin: Admin, audit: Audit, a: { id: string; rental_id: string; application_id: string; old_weekly_rate: number; new_weekly_rate: number; apply_on: string; stripe_update_required?: boolean }, today: string): Promise<string> {
  const { data, error } = await admin.rpc("apply_rental_rate_amendment", { _id: a.id, _today: today });
  if (error) {
    console.error("[rental-amendment] apply failed", error.message);
    return "error";
  }
  const result = String(data);
  if (result === "applied") {
    await audit({
      action: "rental.rate_amendment_applied",
      summary: `Weekly rate changed $${a.old_weekly_rate} → $${a.new_weekly_rate} from ${a.apply_on} (signed amendment)`,
      entityType: "rental",
      entityId: a.rental_id,
      metadata: { amendment_id: a.id, application_id: a.application_id, apply_on: a.apply_on, stripe_update_required: !!a.stripe_update_required },
    });
    if (a.stripe_update_required) {
      await audit({ action: "rental.rate_amendment_stripe_review", summary: "This rental has a Stripe subscription: staff must update its weekly amount in Stripe (not changed automatically).", entityType: "rental", entityId: a.rental_id, metadata: { amendment_id: a.id } });
    }
  } else if (result === "conflict") {
    await audit({ action: "rental.rate_amendment_conflict", summary: "Signed rate change not applied: the rental ended or its rate changed. Staff must review.", entityType: "rental", entityId: a.rental_id, metadata: { amendment_id: a.id } });
  }
  return result;
}

/**
 * Called by completeSigning for every signed agreement. Returns true when the
 * agreement is an amendment (callers then skip the first-signing steps:
 * Reservation Fee, initial payment link, reservation confirmation, and the
 * agreement_signed_by_renter FLEET event). Never throws.
 */
export async function onAmendmentSigned(admin: Admin, agreementId: string, deps: { now?: Date; audit?: Audit; notifyFleet?: AmendDeps["notifyFleet"] } = {}): Promise<boolean> {
  const now = deps.now ?? new Date();
  const audit: Audit = deps.audit ?? (async (e) => (await import("@/lib/audit.server")).logAudit(null, e));
  const ag = await admin.from("agreements").select("id,metadata,signed_at").eq("id", agreementId).maybeSingle();
  const meta = (ag.data?.metadata ?? {}) as Record<string, any>;
  const r = await admin.from(AMENDMENTS_TABLE).select("id,rental_id,application_id,status,old_weekly_rate,new_weekly_rate,effective_date,previous_agreement_id,stripe_update_required").eq("agreement_id", agreementId).maybeSingle();
  const a = r.error ? null : r.data;
  if (!a) return Boolean(meta.amendment);
  if (a.status !== "pending_signature") return true;
  const rental = await admin.from("rentals").select("id,next_payment_due,stripe_subscription_id").eq("id", a.rental_id).maybeSingle();
  const signedAt = ag.data?.signed_at ? new Date(ag.data.signed_at) : now;
  const signedDay = contractTodayIso(signedAt);
  const applyOn = applyOnDate(String(a.effective_date), signedDay, rental.data?.next_payment_due ?? null);
  const stripe = !!rental.data?.stripe_subscription_id || !!a.stripe_update_required;
  const upd = await admin.from(AMENDMENTS_TABLE).update({ status: "signed", signed_at: signedAt.toISOString(), apply_on: applyOn, stripe_update_required: stripe, updated_at: now.toISOString() }).eq("id", a.id).eq("status", "pending_signature");
  if (upd.error) {
    console.error("[rental-amendment] mark signed failed", upd.error.message);
    return true;
  }
  await audit({
    action: "rental.rate_amendment_signed",
    summary: `Renter signed the updated agreement: $${a.old_weekly_rate} → $${a.new_weekly_rate}/week from ${applyOn}`,
    entityType: "rental",
    entityId: a.rental_id,
    metadata: { amendment_id: a.id, agreement_id: agreementId, previous_agreement_id: a.previous_agreement_id ?? null, effective_date: a.effective_date, apply_on: applyOn },
  });
  const today = contractTodayIso(now);
  const result = applyOn <= today ? await applyOne(admin, audit, { ...a, apply_on: applyOn, stripe_update_required: stripe }, today) : "scheduled";
  const payload = {
    event: "agreement_amendment_signed",
    amendment_id: a.id,
    agreement_id: agreementId,
    previous_agreement_id: a.previous_agreement_id ?? null,
    rental_id: a.rental_id,
    lead_id: a.application_id,
    old_weekly_rate: Number(a.old_weekly_rate),
    new_weekly_rate: Number(a.new_weekly_rate),
    effective_date: a.effective_date,
    apply_on: applyOn,
    rate_status: result === "applied" ? "applied" : ["scheduled", "not_due", "waiting_prior_weeks", "week_in_progress"].includes(result) ? "scheduled" : result,
    stripe_update_required: stripe,
    signed_at: signedAt.toISOString(),
  };
  try {
    await (deps.notifyFleet ?? defaultNotifyFleet)(admin, payload);
  } catch (e) {
    console.error("[rental-amendment] FLEET notify failed", String((e as Error)?.message ?? e));
  }
  return true;
}

async function defaultNotifyFleet(admin: Admin, payload: Record<string, unknown>) {
  const { enqueueFleetEvent, dispatchFleetWebhooks } = await import("@/lib/fleet-webhook.server");
  const id = await enqueueFleetEvent(admin, { event_type: "agreement_amendment_signed", dedupe_key: `agreement_amendment_signed:${payload.agreement_id}`, application_id: (payload.lead_id as string) ?? null, payload });
  if (id) await dispatchFleetWebhooks(admin, { ids: [id] }, { timeoutMs: 5000 });
}

/**
 * Cron (every 5 minutes with the automations sweep): applies signed
 * amendments whose date has arrived, and retires open ones whose agreement
 * was voided. No table yet → does nothing.
 */
export async function applyDueRentalAmendments(admin: Admin, deps: { now?: Date; audit?: Audit } = {}): Promise<{ applied: number; conflicts: number; voided: number; skipped?: string }> {
  const now = deps.now ?? new Date();
  const audit: Audit = deps.audit ?? (async (e) => (await import("@/lib/audit.server")).logAudit(null, e));
  const today = contractTodayIso(now);
  const due = await admin.from(AMENDMENTS_TABLE).select("id,rental_id,application_id,old_weekly_rate,new_weekly_rate,apply_on,stripe_update_required,status").eq("status", "signed").lte("apply_on", today).limit(50);
  if (due.error) return { applied: 0, conflicts: 0, voided: 0, skipped: tableMissing(due.error, AMENDMENTS_TABLE) ? "not_installed" : "unreadable" };
  let applied = 0, conflicts = 0, voided = 0;
  for (const a of (due.data ?? []) as any[]) {
    const r = await applyOne(admin, audit, a, today);
    if (r === "applied") applied++;
    if (r === "conflict") conflicts++;
  }
  const pend = await admin.from(AMENDMENTS_TABLE).select("id,rental_id").eq("status", "pending_signature").limit(50);
  for (const p of (pend.data ?? []) as any[]) {
    const before = await openAmendment(admin, p.rental_id, now);
    if (before === null) voided++;
  }
  return { applied, conflicts, voided };
}

/**
 * POST /api/public/fleet/amend-agreement
 *   { "rental_id": "…", "new_weekly_rate": 375, "effective_date": "2026-11-23",
 *     "reason": "…", "renter_consent": { "channel": "sms", "received_at": "…", "quote": "…", "message_id": "…" },
 *     "idempotency_key": "…" }
 *   { "action": "status", "rental_id": "…" }
 */
export async function handleFleetAmendAgreement(request: Request, deps: AmendDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const now = (deps.now ?? (() => new Date()))();
  const rentalId = String(body.rental_id ?? "").trim();
  if (!UUID_RE.test(rentalId)) return fleetJson(400, { ok: false, error: "rental_id must be a UUID." });
  if (body.action === "status") {
    const r = await listRentalAmendments(admin, rentalId);
    return fleetJson(r.status, r.body);
  }
  if (body.action != null && body.action !== "send") return fleetJson(400, { ok: false, error: "action must be send (default) or status." });
  if (body.mode != null && body.mode !== "amendment") return fleetJson(400, { ok: false, error: "mode must be amendment (or omitted)." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  try {
    const r = await proposeRentalAmendment(admin, {
      rentalId,
      newWeeklyRate: body.new_weekly_rate,
      termsRaw: body.terms ?? null,
      effectiveDate: body.effective_date,
      reason: body.reason,
      consentRaw: body.renter_consent ?? null,
      source: "fleet",
      requestedBy: FLEET_ACTOR_LABEL,
      requestedByUser: null,
      outOfBoundsAck: false,
      idempotencyKey: idem,
    }, { ...deps, audit: fleetAudit(deps) as Audit, now });
    return fleetJson(r.status, r.body);
  } catch (e) {
    console.error("[fleet-amend-agreement] failed", String((e as Error)?.message ?? e));
    return fleetJson(503, { ok: false, error: "Could not send the updated agreement." });
  }
}
