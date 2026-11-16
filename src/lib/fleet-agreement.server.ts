/**
 * FLEET sends the rental agreement after the phone call, once the applicant
 * has confirmed the terms.
 *
 *   POST /api/public/fleet/send-agreement   (Bearer FLEET_API_KEY)
 *
 * Order, and every step must pass before the next:
 *   1. The applicant is Approved, no agreement is out or signed, and the
 *      agreement the site would send has no blockers (vehicle, weekly rate,
 *      start date, deposit, approved template, ...).
 *   2. The terms FLEET says the applicant confirmed (weekly rate, deposit,
 *      start date, vehicle) match exactly what the agreement will print.
 *      A mismatch sends nothing: fix the record in the back office or send
 *      it to staff.
 *   3. The confirmation is stored (public.agreement_terms_confirmations).
 *   4. The agreement goes out through issueAgreement, the same function
 *      staff Approve-and-send uses. The company signer comes from Settings
 *      (Company eSign Signer) and is not touched here.
 * Audited as "FLEET (automated)". Idempotent on idempotency_key.
 */
import { withAutoSendDefaults, type AgreementPrep } from "@/lib/agreement-prep";
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

type Admin = any;
type SendCheck = Awaited<ReturnType<typeof import("@/lib/agreements.functions").agreementSendCheck>>;
export type AgreementDeps = FleetDeps & {
  check?: (admin: Admin, applicationId: string) => Promise<SendCheck>;
  hasOpenOrSigned?: (admin: Admin, applicationId: string) => Promise<boolean>;
  verifySms?: typeof verifySmsConfirmation;
  issue?: (admin: Admin, applicationId: string, opts: { createdBy: null; prep?: AgreementPrep }) => Promise<{ id: string; url: string; delivery: { email: string; sms: string; delivered: boolean } }>;
  reservationFee?: { enabled: boolean; amount: number };
};

/**
 * With the Reservation Fee switch on (t299s1618), FLEET's agreement records a
 * Required Reservation Fee so a template that prints it says "$50, applied to
 * your first payment", and signing charges it (reservation-fee.server.ts).
 * Off: no prep, exactly as before.
 */
export function fleetAgreementPrep(fee: { enabled: boolean; amount: number }, deposit: number | null): AgreementPrep {
  // v1.14 is the agreement sent (Dolmar t319u). FLEET's quote has no Damage
  // Waiver and rent is weekly by card, so those are the defaults it prints.
  return withAutoSendDefaults({
    drivers: { mode: "none", list: [] },
    reservation: fee.enabled ? { mode: "required", amount: fee.amount } : { mode: "not_required", amount: null },
    deposit: deposit && deposit > 0 ? { mode: "required", amount: deposit, reason: "" } : { mode: "none", amount: null, reason: "" },
  });
}

const MAX_CONFIRMATION_AGE_DAYS = 7;

function money(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export type TermsConfirmation = {
  confirmed_at: string;
  channel: "call" | "sms";
  call_id: string | null;
  message_id: string | null;
  summary: string;
  weekly_rate: number;
  deposit: number;
  start_date: string;
  vehicle_id: string;
};

export function parseTermsConfirmation(raw: any, now: Date): { ok: true; value: TermsConfirmation } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "terms_confirmation is required." };
  const at = String(raw.confirmed_at ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(at)) return { ok: false, error: "terms_confirmation.confirmed_at must be an ISO timestamp with a time zone." };
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return { ok: false, error: "terms_confirmation.confirmed_at is not a valid time." };
  if (t > now.getTime() + 5 * 60_000) return { ok: false, error: "terms_confirmation.confirmed_at is in the future." };
  if (now.getTime() - t > MAX_CONFIRMATION_AGE_DAYS * 86400_000) return { ok: false, error: `The confirmation is older than ${MAX_CONFIRMATION_AGE_DAYS} days. Confirm the terms again.` };
  const channel = String(raw.channel ?? "").toLowerCase();
  if (channel !== "call" && channel !== "sms") return { ok: false, error: "terms_confirmation.channel must be call or sms." };
  const callId = cleanText(raw.call_id, 120) || null;
  const messageId = cleanText(raw.message_id, 120) || null;
  if (channel === "call" && !callId) return { ok: false, error: "terms_confirmation.call_id is required for a call." };
  if (channel === "sms" && !messageId) return { ok: false, error: "terms_confirmation.message_id is required for a text." };
  const summary = cleanText(raw.summary, 2000);
  if (summary.length < 10) return { ok: false, error: "terms_confirmation.summary is required (what the applicant agreed to)." };
  const weekly = money(raw.weekly_rate);
  if (weekly === null || weekly <= 0) return { ok: false, error: "terms_confirmation.weekly_rate must be a positive amount." };
  const deposit = money(raw.deposit);
  if (deposit === null) return { ok: false, error: "terms_confirmation.deposit must be an amount (0 if none)." };
  const start = String(raw.start_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, error: "terms_confirmation.start_date must be YYYY-MM-DD." };
  const vehicleId = String(raw.vehicle_id ?? "").trim();
  if (!UUID_RE.test(vehicleId)) return { ok: false, error: "terms_confirmation.vehicle_id must be the vehicle's id (UUID)." };
  return { ok: true, value: { confirmed_at: new Date(t).toISOString(), channel, call_id: callId, message_id: messageId, summary, weekly_rate: weekly, deposit, start_date: start, vehicle_id: vehicleId } };
}

/** A short affirmative reply ("YES", "Yes I confirm", "ok"), with no hedge or refusal in it. */
const AFFIRMATIVE = /^\s*(y|ya|yes|yess+|yeah|yep|yup|ok|okay|confirm|confirmed|i confirm|i agree|agree|agreed|sounds good|deal|correct)\b/i;
const NEGATIVE = /\b(no|not|nope|don'?t|dont|can'?t|cant|stop|cancel|wait|later|change|question|how|what|why)\b|\?/i;
export function isYesReply(body: unknown): boolean {
  const t = String(body ?? "").trim();
  return t.length > 0 && t.length <= 160 && AFFIRMATIVE.test(t) && !NEGATIVE.test(t);
}
const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);

/**
 * A text confirmation must be a real inbound text on one of our Quo lines,
 * from this applicant's phone, that reads as a plain YES, received no more
 * than 10 minutes after FLEET says it was confirmed and within the last 7
 * days. Looked up by the Quo message id FLEET passes as message_id.
 */
export async function verifySmsConfirmation(admin: Admin, appPhone: unknown, conf: TermsConfirmation, now: Date): Promise<{ ok: true; occurred_at: string | null } | { ok: false; status: number; error: string }> {
  const res = await admin.from("quo_events").select("id,event_type,quo_resource_id,direction,from_e164,body,occurred_at,created_at")
    .eq("quo_resource_id", conf.message_id).eq("event_type", "message.received").limit(1);
  if (res.error) {
    if (tableMissing(res.error, "quo_events")) return { ok: false, status: 503, error: "Text history is not set up (quo_events). Nothing was sent." };
    return { ok: false, status: 503, error: "Could not read the text history. Nothing was sent." };
  }
  const m = Array.isArray(res.data) ? res.data[0] : null;
  if (!m) return { ok: false, status: 409, error: "No inbound text with that message_id was received on our lines. Nothing was sent." };
  if (m.direction && m.direction !== "incoming") return { ok: false, status: 409, error: "That message_id is not a text from the applicant. Nothing was sent." };
  const mine = last10(appPhone);
  if (mine.length !== 10 || last10(m.from_e164) !== mine) return { ok: false, status: 409, error: "That text did not come from this applicant's phone number. Nothing was sent." };
  if (!isYesReply(m.body)) return { ok: false, status: 409, error: "That text is not a plain YES. Nothing was sent: ask again, or hand it to staff." };
  const at = Date.parse(String(m.occurred_at ?? m.created_at ?? ""));
  if (Number.isFinite(at)) {
    if (now.getTime() - at > MAX_CONFIRMATION_AGE_DAYS * 86400_000) return { ok: false, status: 409, error: `That YES is older than ${MAX_CONFIRMATION_AGE_DAYS} days. Confirm the terms again.` };
    if (Math.abs(Date.parse(conf.confirmed_at) - at) > 10 * 60_000) return { ok: false, status: 400, error: "terms_confirmation.confirmed_at must be the time the YES text arrived." };
  }
  return { ok: true, occurred_at: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

/** Differences between what was confirmed and what the agreement will print. */
export function termsMismatches(confirmed: TermsConfirmation, check: SendCheck): { field: string; confirmed: unknown; agreement: unknown }[] {
  const out: { field: string; confirmed: unknown; agreement: unknown }[] = [];
  if (check.weeklyRate === null || Math.abs(check.weeklyRate - confirmed.weekly_rate) > 0.004) out.push({ field: "weekly_rate", confirmed: confirmed.weekly_rate, agreement: check.weeklyRate });
  if (check.deposit === null || Math.abs(check.deposit - confirmed.deposit) > 0.004) out.push({ field: "deposit", confirmed: confirmed.deposit, agreement: check.deposit });
  if (check.startDate !== confirmed.start_date) out.push({ field: "start_date", confirmed: confirmed.start_date, agreement: check.startDate });
  if (check.vehicleId !== confirmed.vehicle_id) out.push({ field: "vehicle_id", confirmed: confirmed.vehicle_id, agreement: check.vehicleId });
  return out;
}

/**
 * POST /api/public/fleet/send-agreement
 *   { "lead_id": "…", "idempotency_key": "…",
 *     "terms_confirmation": { "confirmed_at": "2026-11-16T15:04:00-05:00", "channel": "call",
 *       "call_id": "AC…", "summary": "…", "weekly_rate": 325, "deposit": 0,
 *       "start_date": "2026-11-18", "vehicle_id": "…" } }
 */
export async function handleFleetSendAgreement(request: Request, deps: AgreementDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  let leadId = String(body.lead_id ?? "").trim();
  if (!leadId && body.rental_id) {
    if (!UUID_RE.test(String(body.rental_id))) return fleetJson(400, { ok: false, error: "rental_id must be a UUID." });
    const r = await admin.from("rentals").select("id,application_id").eq("id", String(body.rental_id)).maybeSingle();
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read rentals." });
    if (!r.data?.application_id) return fleetJson(404, { ok: false, error: "Rental not found or has no application." });
    leadId = r.data.application_id;
  }
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const conf = parseTermsConfirmation(body.terms_confirmation, now);
  if (!conf.ok) return fleetJson(400, { ok: false, error: conf.error });

  let retryConfirmationId: string | null = null;
  if (idem) {
    const prior = await admin.from("agreement_terms_confirmations").select("id,application_id,agreement_id").eq("idempotency_key", idem).maybeSingle();
    if (prior.error && !tableMissing(prior.error, "agreement_terms_confirmations")) return fleetJson(503, { ok: false, error: "Could not read confirmations." });
    if (prior.data) {
      if (prior.data.application_id !== leadId) return fleetJson(409, { ok: false, error: "idempotency_key was already used for another applicant." });
      if (prior.data.agreement_id) return fleetJson(200, { ok: true, duplicate: true, lead_id: leadId, confirmation_id: prior.data.id, agreement_id: prior.data.agreement_id });
      // Stored before, but the send failed: retry the send on the same record.
      retryConfirmationId = prior.data.id;
    }
  }

  const app = await admin.from("applications").select("id,status,full_name,email,phone,deleted_at").eq("id", leadId).maybeSingle();
  if (app.error) return fleetJson(503, { ok: false, error: "Could not read the applicant." });
  if (!app.data || app.data.deleted_at) return fleetJson(404, { ok: false, error: "Applicant not found." });
  if (String(app.data.status) !== "approved") return fleetJson(409, { ok: false, error: `Only an Approved applicant can be sent an agreement (this one is ${app.data.status}).` });

  const hasOpenOrSigned = deps.hasOpenOrSigned ?? (await import("@/lib/agreements.functions")).hasOpenOrSignedAgreement;
  if (await hasOpenOrSigned(admin, leadId)) return fleetJson(409, { ok: false, error: "An agreement is already out or signed for this applicant. Nothing was sent." });

  let check: SendCheck;
  try {
    check = await (deps.check ?? (await import("@/lib/agreements.functions")).agreementSendCheck)(admin, leadId);
  } catch (e) {
    return fleetJson(409, { ok: false, error: `The agreement cannot be prepared: ${String((e as Error)?.message ?? e).slice(0, 300)}` });
  }
  if (!check.vehicleId) return fleetJson(409, { ok: false, error: "No vehicle is assigned to this applicant. Nothing was sent.", blockers: check.blockers });
  if (!check.weeklyRate) return fleetJson(409, { ok: false, error: "No weekly rate is set. Nothing was sent.", blockers: check.blockers });
  if (check.blockers.length) return fleetJson(409, { ok: false, error: "The agreement has missing details. Nothing was sent.", blockers: check.blockers });
  const mismatches = termsMismatches(conf.value, check);
  if (mismatches.length) {
    return fleetJson(409, {
      ok: false,
      error: "The confirmed terms do not match what the agreement would say. Nothing was sent. Fix the record or send it to staff.",
      mismatches,
      agreement_terms: { weekly_rate: check.weeklyRate, deposit: check.deposit, start_date: check.startDate, vehicle_id: check.vehicleId, vehicle: check.vehicleLabel },
    });
  }

  // A YES text must be a real inbound text from this applicant (t298s1611).
  if (conf.value.channel === "sms") {
    const sms = await (deps.verifySms ?? verifySmsConfirmation)(admin, app.data.phone, conf.value, now);
    if (!sms.ok) return fleetJson(sms.status, { ok: false, error: sms.error });
  }

  // Store the confirmation first; no record, no send.
  const ins = retryConfirmationId ? { data: { id: retryConfirmationId }, error: null } : await admin.from("agreement_terms_confirmations").insert({
    application_id: leadId,
    ...conf.value,
    vehicle_label: check.vehicleLabel,
    recorded_by: FLEET_ACTOR_LABEL,
    idempotency_key: idem,
  }).select("id").single();
  if (ins.error || !ins.data) {
    if (tableMissing(ins.error, "agreement_terms_confirmations")) return fleetJson(503, { ok: false, error: "Terms confirmations are not set up yet. Nothing was sent." });
    if (String(ins.error?.code) === "23505") return fleetJson(409, { ok: false, error: "Duplicate idempotency_key; retry with the same key after a moment." });
    return fleetJson(503, { ok: false, error: "Could not store the confirmation. Nothing was sent." });
  }
  const confirmationId = ins.data.id as string;

  let sent: Awaited<ReturnType<NonNullable<AgreementDeps["issue"]>>>;
  try {
    const issue = deps.issue ?? (await import("@/lib/agreements.functions")).issueAgreement;
    const fee = deps.reservationFee ?? (await (await import("@/lib/reservation-fee.server")).loadReservationFeeSettings(admin));
    const prep = fleetAgreementPrep(fee, check.deposit);
    sent = await issue(admin, leadId, { createdBy: null, prep });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await audit({ action: "agreement.fleet_send_failed", summary: `Agreement not sent by ${FLEET_ACTOR_LABEL}: ${msg}`, entityType: "application", entityId: leadId, metadata: { confirmation_id: confirmationId } });
    return fleetJson(409, { ok: false, error: `The agreement was not sent: ${msg}`, confirmation_id: confirmationId });
  }
  await admin.from("agreement_terms_confirmations").update({ agreement_id: sent.id, agreement_sent_at: now.toISOString() }).eq("id", confirmationId);
  await audit({
    action: "agreement.fleet_sent",
    summary: `Rental agreement sent by ${FLEET_ACTOR_LABEL} after the applicant confirmed terms by ${conf.value.channel}`,
    entityType: "application",
    entityId: leadId,
    metadata: {
      decided_by: FLEET_ACTOR_LABEL,
      agreement_id: sent.id,
      confirmation_id: confirmationId,
      channel: conf.value.channel,
      call_id: conf.value.call_id,
      message_id: conf.value.message_id,
      terms: { weekly_rate: conf.value.weekly_rate, deposit: conf.value.deposit, start_date: conf.value.start_date, vehicle_id: conf.value.vehicle_id },
    },
  });
  // Lifecycle trail. A confirmed YES text or call is a real two-way exchange,
  // so it also fills a blank contacted_at. Agreement completes only on signing;
  // this records that FLEET sent it.
  {
    const { recordFleetLifecycleStep, stampContactedByFleet } = await import("@/lib/fleet-lifecycle.server");
    const how = conf.value.channel === "sms" ? "a YES text" : `a ${conf.value.channel}`;
    await stampContactedByFleet(admin, audit, { applicationId: leadId, evidence: `Applicant confirmed terms by ${how}.`, source: "send-agreement", at: now });
    await recordFleetLifecycleStep(audit, { applicationId: leadId, step: "agreement", evidence: `Agreement sent for signature after the applicant confirmed terms by ${how}.`, source: "send-agreement", at: now, extra: { agreement_id: sent.id } });
  }
  // The signing URL carries the renter's token: it is never returned to FLEET.
  return fleetJson(201, {
    ok: true,
    lead_id: leadId,
    agreement_id: sent.id,
    confirmation_id: confirmationId,
    delivery: sent.delivery,
    terms: { weekly_rate: check.weeklyRate, deposit: check.deposit, start_date: check.startDate, vehicle: check.vehicleLabel },
  });
}
