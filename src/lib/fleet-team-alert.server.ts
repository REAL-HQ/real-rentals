/**
 * POST /api/public/fleet/team-alert (Bearer FLEET_API_KEY)
 *
 * For the bots (FLEET, the support bot, the phone assistant) to put a person
 * on something right away:
 *
 *   { "kind": "roadside_overnight", "summary": "Flat tire on I-4, car not drivable",
 *     "rental_id"?: "...", "lead_id"?: "...", "dedupe_key"?: "quo message id" }
 *     Only from 6 PM to 6 AM ET (D17); in the daytime staff handle roadside (409).
 *
 *   { "kind": "bot_handoff", "reason": "complaint" | "injury" | "payment_dispute" |
 *     "asked_for_person" | "outside_templates" | "no_answer", "summary": "...",
 *     "lead_id"?: "...", "rental_id"?: "...", "dedupe_key"?: "..." }
 *     (D29). The bot stops replying to that person and says a team member will
 *     follow up (docs/bot-rules.md).
 *
 *   { "kind": "applicant_approved", "lead_id": "...", "summary"?: "...",
 *     "line_id"?: "PN... (the company line FLEET texted the applicant on)",
 *     "approval_texted_at"?: "ISO time FLEET texted the approval" }
 *     Subject "APPROVED: <First Last> - Call To Review Terms"; the email shows
 *     "Approval texted 9:38 AM · No reply yet · Agreement not sent" and a
 *     tap-to-call link built from the application row.
 *     (Nov 17 2026) FLEET told an approved applicant a team member will reach
 *     out; this asks staff to call them, go over the terms and click Move
 *     Forward. Text: Rosa's hours -> the other company Quo line, otherwise the
 *     field-rep numbers; only 8 AM-9 PM ET (outside that it is email-only).
 *     Email: team@ always, plus rosa@drivereal.com during her hours. One alert
 *     per lead (a quiet-hours email-only alert leaves the daytime one open).
 *
 * Sends one team alert (team-alerts.server.ts): email to team@drivereal.com
 * anytime, and a text that follows staff coverage (other company Quo line
 * during Rosa's hours, field-rep numbers from Pickup Schedule settings
 * otherwise). Injuries also go to the field rep at any hour. Gated per kind
 * by app_settings.team_alerts (OFF by default). Any phone number in the
 * summary is removed. Staff phones are read from settings, never from the
 * request.
 */
import { cleanText, fleetAdmin, fleetJson, fleetRequestBody, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { isOvernightEt } from "@/lib/team-alerts";
import { withinTextingHours } from "@/lib/failed-payment-link";
import { shortProfileLink } from "@/lib/team-alert-copy";
import type { TeamAlertDeps } from "@/lib/team-alerts.server";

export const HANDOFF_REASONS = ["complaint", "injury", "payment_dispute", "asked_for_person", "outside_templates", "no_answer"] as const;

const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");

export async function handleFleetTeamAlert(request: Request, deps: FleetDeps & TeamAlertDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const now = (deps.now ?? (() => new Date()))();
  const kind = String(body.kind ?? "");
  if (kind !== "roadside_overnight" && kind !== "bot_handoff" && kind !== "applicant_approved") return fleetJson(400, { ok: false, error: 'kind must be "roadside_overnight", "bot_handoff" or "applicant_approved".' });
  const summary = cleanText(body.summary, 300);
  if (summary.length < 3 && kind !== "applicant_approved") return fleetJson(400, { ok: false, error: "summary is required." });
  for (const f of ["lead_id", "rental_id"] as const) if (body[f] != null && body[f] !== "" && !UUID_RE.test(String(body[f]))) return fleetJson(400, { ok: false, error: `${f} must be a UUID.` });
  const leadId = body.lead_id ? String(body.lead_id) : null;
  const rentalId = body.rental_id ? String(body.rental_id) : null;
  let dedupe = cleanText(body.dedupe_key, 120) || `${leadId ?? rentalId ?? "none"}:${now.toISOString().slice(0, 16)}`;

  const admin = await fleetAdmin(deps);
  const site = SITE();
  const link = leadId ? `${site}/admin?tab=drivers&id=${encodeURIComponent(leadId)}` : `${site}/admin?tab=issues`;
  const smsLink = leadId ? shortProfileLink(site, leadId) : link;
  const copyMod = await import("@/lib/team-alert-copy");
  let copy: import("@/lib/team-alert-copy").AlertCopy;
  let callPhone: string | null = null;
  if (kind === "applicant_approved") {
    if (!leadId) return fleetJson(400, { ok: false, error: "lead_id is required for applicant_approved." });
    const app = await admin.from("applications").select("id,status,full_name,phone,deleted_at").eq("id", leadId).maybeSingle();
    if (app.error) return fleetJson(503, { ok: false, error: "Could not read the applicant." });
    if (!app.data || app.data.deleted_at) return fleetJson(404, { ok: false, error: "Applicant not found." });
    if (String(app.data.status) !== "approved") return fleetJson(409, { ok: false, error: `Only an Approved applicant gets this alert (this one is ${app.data.status}).` });
    // One alert per lead. Outside 8 AM-9 PM ET it is email-only under its own
    // key, so the daytime alert (with the text) can still go once.
    dedupe = withinTextingHours(now) ? leadId : `${leadId}:email-only`;
    const textedRaw = String(body.approval_texted_at ?? "").trim();
    const textedAt = textedRaw && Number.isFinite(Date.parse(textedRaw)) ? new Date(Date.parse(textedRaw)).toISOString() : null;
    const replied = textedAt ? await repliedSince(admin, app.data.phone, textedAt) : null;
    let agreementSent: boolean | null = null;
    try {
      const has = (deps as any).hasOpenOrSigned ?? (await import("@/lib/agreements.functions")).hasOpenOrSignedAgreement;
      agreementSent = await has(admin, leadId);
    } catch { agreementSent = null; }
    // Staff-only email body: tap-to-call from the application row.
    callPhone = copyMod.displayPhone(app.data.phone)?.e164 ?? null;
    copy = copyMod.approvedApplicantCopy({ name: app.data.full_name, approvalTextedAt: textedAt, replied, agreementSent, smsLink, note: null });
  } else {
    const name = await personFor(admin, leadId, rentalId);
    if (kind === "roadside_overnight") {
      if (!isOvernightEt(now)) return fleetJson(409, { ok: false, error: "Roadside is staffed 6 AM to 6 PM ET; hand it to staff the normal way." });
      copy = copyMod.overnightRoadsideCopy({ summary, name, link: smsLink });
    } else {
      const reason = String(body.reason ?? "") as (typeof HANDOFF_REASONS)[number];
      if (!HANDOFF_REASONS.includes(reason)) return fleetJson(400, { ok: false, error: `reason must be one of ${HANDOFF_REASONS.join(", ")}.` });
      copy = copyMod.handoffCopy({ reason, summary, name, link: smsLink });
    }
  }
  const { sendTeamAlert } = await import("@/lib/team-alerts.server");
  const out = await sendTeamAlert(admin, {
    kind,
    dedupeKey: dedupe,
    title: copy.subject,
    status: copy.status,
    lines: copy.lines,
    smsLink,
    callPhone,
    link,
    rentalId,
    activeLine: body.line_id ?? body.from_phone_number_id ?? body.phone_number_id ?? null,
    handoffReason: kind === "bot_handoff" ? String(body.reason ?? "") : null,
  }, deps);
  const code = out.status === "no_table" ? 503 : out.status === "failed" ? 502 : 200;
  return fleetJson(code, { ok: out.status === "sent" || out.status === "partial" || out.status === "duplicate", ...out });
}

/** The person's name for the subject, from the lead or the rental's application. */
async function personFor(admin: any, leadId: string | null, rentalId: string | null): Promise<string | null> {
  try {
    let appId = leadId;
    if (!appId && rentalId) {
      const r = await admin.from("rentals").select("application_id").eq("id", rentalId).maybeSingle();
      appId = r?.data?.application_id ?? null;
    }
    if (!appId) return null;
    const a = await admin.from("applications").select("full_name").eq("id", appId).maybeSingle();
    return cleanText(a?.data?.full_name, 80) || null;
  } catch {
    return null;
  }
}

/** Has the applicant texted us since the approval text? null when it cannot be told. */
async function repliedSince(admin: any, phone: unknown, sinceIso: string): Promise<boolean | null> {
  const mine = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (mine.length !== 10) return null;
  try {
    const r = await admin.from("quo_events").select("from_e164,occurred_at").eq("event_type", "message.received").gte("occurred_at", sinceIso).limit(200);
    if (r?.error || !Array.isArray(r?.data)) return null;
    return r.data.some((m: any) => String(m.from_e164 ?? "").replace(/\D/g, "").slice(-10) === mine);
  } catch {
    return null;
  }
}
