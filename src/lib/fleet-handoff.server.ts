/**
 * FLEET / AIVA handoff to staff: "a person has to take this one".
 *
 *   POST /api/public/fleet/handoff   (Bearer FLEET_API_KEY, JSON)
 *     { "action": "handoff", "lead_id"|"rental_id": "…",
 *       "reason": "complaint" | "injury" | "accident" | "payment_dispute" | "legal" | "staff_handling" | "other",
 *       "note": "what the renter said, in one or two lines", "source": "fleet" | "aiva",
 *       "idempotency_key": "optional" }
 *     { "action": "status", "lead_id"|"rental_id": "…" }
 *
 * A handoff is an open Needs Staff flag (public.fleet_review_decisions, already
 * installed) with the escalation code "handoff:<reason>". While it is open the
 * bots are paused for that person: /fleet/status says owner "staff", and every
 * FLEET action that messages the renter (resend-link) refuses. Only staff clear
 * it (Drivers → the red banner → Mark Handled). FLEET cannot clear a handoff.
 *
 * Optional staff text: app_settings "fleet_handoff" { "alert_sms": true }.
 * During Rosa's hours the text goes to the other company Quo line (the one
 * the renter is not already on). Outside her hours it goes to the Pickup
 * Schedule field-rep numbers, as before. Injuries and accidents always
 * include the field rep, at any hour; everything else 8 AM–9 PM ET only
 * (otherwise the flag waits for the morning). OFF by default. The text names
 * the person and the reason with an admin link; never a renter phone number.
 * Pass line_id (PN… or E.164) so the other line can be chosen.
 */
import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, tableMissing, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { planStaffHandoffSms, publicCoverage } from "@/lib/staff-coverage.server";

type Admin = any;
export const HANDOFF_REASONS = ["complaint", "injury", "accident", "payment_dispute", "legal", "staff_handling", "other"] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];
export const HANDOFF_PREFIX = "handoff:";
export const FLEET_HANDOFF_SETTINGS_KEY = "fleet_handoff";
const LABEL: Record<HandoffReason, string> = {
  complaint: "Complaint",
  injury: "Injury",
  accident: "Accident",
  payment_dispute: "Payment Dispute",
  legal: "Legal",
  staff_handling: "Staff Handling",
  other: "Other",
};
const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
const adminUrl = (id: string) => `${SITE()}/admin?tab=drivers&id=${encodeURIComponent(id)}`;

export type HandoffDeps = FleetDeps & {
  sendSms?: (a: { to: string; body: string; kind: string; requireConsent: false; applicationId: string; fromId?: string | null }) => Promise<{ ok?: boolean } | unknown>;
  alertNumbers?: () => Promise<string[]>;
};

export const isHandoffCode = (c: unknown) => String(c ?? "").startsWith(HANDOFF_PREFIX);

/** The open handoff for a lead, or null. "unavailable" when the table cannot be read (callers fail closed). */
export async function activeHandoff(admin: Admin, leadId: string): Promise<{ id: string; reason: string; codes: string[]; since: string | null } | null | "unavailable"> {
  const r = await admin.from("fleet_review_decisions").select("id,reason,escalation_codes,created_at").eq("application_id", leadId).eq("decision", "needs_staff").is("resolved_at", null).limit(1);
  if (r.error) return "unavailable";
  const row = (r.data ?? [])[0];
  if (!row) return null;
  const codes = (Array.isArray(row.escalation_codes) ? row.escalation_codes : []).map(String);
  if (!codes.some(isHandoffCode)) return null;
  return { id: row.id, reason: String(row.reason), codes, since: row.created_at ?? null };
}

async function resolveLead(admin: Admin, body: Record<string, any>): Promise<{ leadId: string; rentalId: string | null } | { status: number; error: string }> {
  if (body.lead_id != null) {
    if (!UUID_RE.test(String(body.lead_id))) return { status: 400, error: "lead_id must be a UUID." };
    const a = await admin.from("applications").select("id").eq("id", String(body.lead_id)).is("deleted_at", null).maybeSingle();
    if (a.error) return { status: 503, error: "Could not read applications." };
    if (!a.data) return { status: 404, error: "Lead not found." };
    return { leadId: a.data.id, rentalId: null };
  }
  if (body.rental_id != null) {
    if (!UUID_RE.test(String(body.rental_id))) return { status: 400, error: "rental_id must be a UUID." };
    const r = await admin.from("rentals").select("id,application_id").eq("id", String(body.rental_id)).maybeSingle();
    if (r.error) return { status: 503, error: "Could not read rentals." };
    if (!r.data) return { status: 404, error: "Rental not found." };
    if (!r.data.application_id) return { status: 409, error: "That rental has no application to flag. Tell staff directly." };
    return { leadId: r.data.application_id, rentalId: r.data.id };
  }
  return { status: 400, error: "Give lead_id or rental_id." };
}

async function alertSettingOn(admin: Admin): Promise<boolean> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", FLEET_HANDOFF_SETTINGS_KEY).maybeSingle();
  return !error && !!data?.value && (data.value as any).alert_sms === true;
}

export function handoffAlertText(a: { name: string | null; reason: HandoffReason; leadId: string }): string {
  const parts = String(a.name ?? "").trim().split(/\s+/).filter(Boolean);
  const who = parts.length ? `${parts[0]}${parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : ""}` : "A renter";
  return `REAL RENTALS staff alert: ${who} was handed off to staff (${LABEL[a.reason]}). Bots are paused for them until someone marks it handled. ${adminUrl(a.leadId)}`;
}

export async function handleFleetHandoff(request: Request, deps: HandoffDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();
  const action = String(body.action ?? "");
  if (action !== "handoff" && action !== "status") return fleetJson(400, { ok: false, error: "action must be handoff or status." });

  const who = await resolveLead(admin, body);
  if ("error" in who) return fleetJson(who.status, { ok: false, error: who.error });

  if (action === "status") {
    const h = await activeHandoff(admin, who.leadId);
    if (h === "unavailable") return fleetJson(503, { ok: false, error: "Could not read handoffs." });
    return fleetJson(200, { ok: true, lead_id: who.leadId, bots_paused: !!h, handoff: h ? { decision_id: h.id, reason: h.reason, codes: h.codes, since: h.since } : null });
  }

  const reason = String(body.reason ?? "") as HandoffReason;
  if (!HANDOFF_REASONS.includes(reason)) return fleetJson(400, { ok: false, error: `reason must be one of ${HANDOFF_REASONS.join(", ")}.` });
  const note = cleanText(body.note, 600);
  if (note.length < 5) return fleetJson(400, { ok: false, error: "note is required (at least 5 characters): what happened, in a line or two." });
  const source = String(body.source ?? "fleet").toLowerCase() === "aiva" ? "AIVA (automated)" : "FLEET (automated)";
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 printable characters." });
  const code = `${HANDOFF_PREFIX}${reason}`;

  if (idem) {
    const prior = await admin.from("fleet_review_decisions").select("id,application_id").eq("idempotency_key", idem).maybeSingle();
    if (!prior.error && prior.data) return fleetJson(200, { ok: true, duplicate: true, decision_id: prior.data.id, lead_id: prior.data.application_id, bots_paused: true });
  }

  // One open Needs Staff flag per person (unique index): add the handoff code to it.
  const open = await admin.from("fleet_review_decisions").select("id,escalation_codes").eq("application_id", who.leadId).eq("decision", "needs_staff").is("resolved_at", null).limit(1);
  if (open.error) {
    if (tableMissing(open.error, "fleet_review_decisions")) return fleetJson(503, { ok: false, error: "The Needs Staff table is not installed. Tell staff directly." });
    return fleetJson(503, { ok: false, error: "Could not read Needs Staff flags." });
  }
  let decisionId: string;
  let created = false;
  const existing = (open.data ?? [])[0];
  if (existing) {
    const codes = Array.from(new Set([...(Array.isArray(existing.escalation_codes) ? existing.escalation_codes.map(String) : []), code]));
    const up = await admin.from("fleet_review_decisions").update({ escalation_codes: codes }).eq("id", existing.id).is("resolved_at", null).select("id");
    if (up.error || !(up.data ?? []).length) return fleetJson(503, { ok: false, error: "Could not add the handoff to the open flag." });
    decisionId = existing.id;
  } else {
    const ins = await admin.from("fleet_review_decisions").insert({
      application_id: who.leadId,
      decision: "needs_staff",
      reason: cleanText(`Handoff (${LABEL[reason]}): ${note}`, 1000),
      escalation_codes: [code],
      assessment: { handoff: { reason, source, rental_id: who.rentalId, at: now.toISOString() } },
      decided_by: source,
      idempotency_key: idem,
    }).select("id").maybeSingle();
    if (ins.error) {
      if (String(ins.error.code) === "23505") return fleetJson(409, { ok: false, error: "A flag was opened at the same moment. Read status and retry." });
      return fleetJson(503, { ok: false, error: "Could not record the handoff." });
    }
    decisionId = ins.data?.id;
    created = true;
  }
  await audit({
    action: "application.bot_handoff",
    summary: `${source} handed this person to staff (${LABEL[reason]}); bots paused`,
    entityType: "application",
    entityId: who.leadId,
    metadata: { decision_id: decisionId, reason, source, rental_id: who.rentalId, note, added_to_open_flag: !created },
  });

  let alert: "sent" | "off" | "quiet_hours" | "failed" | "not_new" = "off";
  let coverage = null;
  const activeLine = body.line_id ?? body.from_phone_number_id ?? body.phone_number_id ?? null;
  if (!created) alert = "not_new";
  else if (await alertSettingOn(admin)) {
    const app = await admin.from("applications").select("full_name").eq("id", who.leadId).maybeSingle();
    const text = handoffAlertText({ name: app.data?.full_name ?? null, reason, leadId: who.leadId });
    const fieldRepNumbers = deps.alertNumbers ? await deps.alertNumbers() : undefined;
    const plan = await planStaffHandoffSms({ admin, now, reason, activeLine, fieldRepNumbers });
    coverage = publicCoverage(plan.coverage, plan);
    if (plan.quietHours) alert = "quiet_hours";
    else if (!plan.targets.length) alert = "failed";
    else {
      const send = deps.sendSms ?? (async (a: any) => (await import("@/lib/sms.server")).sendSms(a));
      let okAny = false;
      for (const t of plan.targets) {
        try {
          const r: any = await send({ to: t.to, body: text, kind: "fleet_handoff_staff", requireConsent: false, applicationId: who.leadId, fromId: t.fromId });
          if (r?.ok) okAny = true;
        } catch { /* reported below */ }
      }
      alert = okAny ? "sent" : "failed";
    }
  }
  return fleetJson(created ? 201 : 200, { ok: true, lead_id: who.leadId, decision_id: decisionId, bots_paused: true, added_to_open_flag: !created, staff_alert: alert, staff_coverage: coverage });
}
