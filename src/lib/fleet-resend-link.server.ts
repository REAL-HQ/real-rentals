/**
 * FLEET resends a renter's link: the agreement signing link, or the private
 * upload link for missing files.
 *
 *   POST /api/public/fleet/resend-link   (Bearer FLEET_API_KEY, JSON)
 *     { "kind": "signing", "agreement_id"|"lead_id": "…", "idempotency_key": "optional" }
 *     { "kind": "upload",  "lead_id": "…",                "idempotency_key": "optional" }
 *
 * Same wording renters already get: the signing link goes out exactly as the
 * staff "Resend" button sends it (same email, same text), and the upload link
 * uses the approved Missing-Items step-1 message. Texts come from the 888 line
 * through sendSms (consent and STOP always checked).
 *
 * Refused (nothing sent) when:
 *   - the Automations switch "FLEET Link Resends" (fleet_link_resends) is not On  → 409 switched_off (Off by default)
 *   - outside 8 AM–9 PM ET                                                        → 409 quiet_hours
 *   - the person is handed off to staff (bots paused)                              → 423
 *   - signing: the agreement is not sent/viewed (draft, being signed, signed, voided),
 *     was prepared without required details, was (re)sent under 4 hours ago, or
 *     FLEET already resent it 3 times in 7 days (staff should call)               → 409 / 429
 *   - upload: the application is not open, nothing is missing, or a missing-items
 *     message went out in the last 24 hours                                        → 409 / 429
 *
 * Every resend is audited ("FLEET (automated)"). See docs/fleet-resend-link.md.
 */
import { fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { withinTextingHours } from "@/lib/failed-payment-link";
import { firstNameOf, missingItems, outreachEmail, outreachSms, MISSING_ITEMS_KIND } from "@/lib/missing-items";
import { notDrivingGigYet } from "@/lib/fleet-review";

type Admin = any;
export const FLEET_LINK_RESENDS_KEY = "fleet_link_resends";
export const UPLOAD_RESEND_KIND = "missing_items_resend";
export const UPLOAD_RESEND_WORKFLOW = "fleet_upload_link_resend";
export const SIGNING_MIN_GAP_MS = 4 * 3600_000;
export const SIGNING_MAX_FLEET_RESENDS_7D = 3;
export const UPLOAD_MIN_GAP_MS = 24 * 3600_000;
const UPLOAD_OPEN = ["partial", "new", "reviewing", "complete"];
/** Mirrors AGREEMENT_REQUIRED_KEYS in agreements.functions.ts (a reissue must meet the send bar). */
export const SIGNING_REQUIRED_KEYS = [
  "driver_name", "driver_email", "driver_phone", "driver_address",
  "license_number", "license_state", "license_expiration",
  "vehicle", "vehicle_vin", "vehicle_color",
  "weekly_rate", "deposit_amount", "start_date", "return_date",
] as const;

export type ResendDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  deliverSigning?: (admin: Admin, args: { id: string; url: string; email: string | null; phone: string | null; name: string | null; vehicle: string | null; applicationId: string | null; actor: null }) => Promise<{ email: string; sms: string; delivered: boolean }>;
  mintUploadLink?: (admin: Admin, applicationId: string) => Promise<string>;
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string } }) => Promise<{ ok: boolean; error?: string; blocked?: string }>;
  sendSms?: (a: { to: string; body: string; kind: string; applicationId: string }) => Promise<{ ok: boolean; reason?: string; error?: string; skipped?: boolean }>;
  companyPhone?: (admin: Admin) => Promise<string>;
  siteUrl?: () => string;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function common(admin: Admin, deps: ResendDeps, now: Date, leadId: string | null): Promise<Response | null> {
  const gate = await (deps.gate ?? defaultGate)(admin, FLEET_LINK_RESENDS_KEY).catch(() => "held" as const);
  if (gate === "off") return fleetJson(409, { ok: false, error: "The FLEET Link Resends switch is Off (Back Office → Automations).", reason: "switched_off" });
  if (gate !== "send") return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later.", reason: "controls_unreadable" });
  if (!withinTextingHours(now)) return fleetJson(409, { ok: false, error: "Links are only resent 8 AM to 9 PM Eastern.", reason: "quiet_hours" });
  if (leadId) {
    const { activeHandoff } = await import("@/lib/fleet-handoff.server");
    const h = await activeHandoff(admin, leadId);
    if (h === "unavailable") return fleetJson(503, { ok: false, error: "Could not check for a staff handoff; nothing sent." });
    if (h) return fleetJson(423, { ok: false, error: "This person is handed off to staff; bots are paused.", reason: "staff_handling", handoff: { decision_id: h.id, reason: h.reason } });
  }
  return null;
}

async function resendSigning(admin: Admin, body: Record<string, any>, deps: ResendDeps, now: Date): Promise<Response> {
  let ag: any = null;
  if (body.agreement_id != null) {
    if (!UUID_RE.test(String(body.agreement_id))) return fleetJson(400, { ok: false, error: "agreement_id must be a UUID." });
    const r = await admin.from("agreements").select("id,application_id,status,sent_at,signer_email,merge_data,voided_at").eq("id", String(body.agreement_id)).maybeSingle();
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read agreements." });
    ag = r.data;
  } else if (body.lead_id != null) {
    if (!UUID_RE.test(String(body.lead_id))) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
    const r = await admin.from("agreements").select("id,application_id,status,sent_at,signer_email,merge_data,voided_at,created_at").eq("application_id", String(body.lead_id)).in("status", ["sent", "viewed"]).is("voided_at", null).order("created_at", { ascending: false }).limit(1);
    if (r.error) return fleetJson(503, { ok: false, error: "Could not read agreements." });
    ag = (r.data ?? [])[0] ?? null;
  } else return fleetJson(400, { ok: false, error: "Give agreement_id or lead_id." });
  if (!ag) return fleetJson(404, { ok: false, error: "No unsigned agreement out for this person." });
  if (ag.voided_at || !["sent", "viewed"].includes(String(ag.status))) {
    return fleetJson(409, { ok: false, error: `The agreement is ${ag.status}; only a sent or viewed agreement can be resent.`, status: ag.status });
  }

  const blocked = await common(admin, deps, now, ag.application_id ?? null);
  if (blocked) return blocked;

  const md = (ag.merge_data ?? {}) as Record<string, unknown>;
  const gaps = SIGNING_REQUIRED_KEYS.filter((k) => !String(md[k] ?? "").trim());
  if (gaps.length) return fleetJson(409, { ok: false, error: `Prepared without ${gaps.join(", ").replace(/_/g, " ")}. Staff must void and prepare a new one.`, gaps });

  if (ag.sent_at && now.getTime() - new Date(ag.sent_at).getTime() < SIGNING_MIN_GAP_MS) {
    const retry = new Date(new Date(ag.sent_at).getTime() + SIGNING_MIN_GAP_MS).toISOString();
    return fleetJson(429, { ok: false, error: "Sent less than 4 hours ago.", retry_after: retry });
  }
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const prior = await admin.from("audit_log").select("id,metadata").eq("action", "document.resent").eq("entity_id", ag.id).gte("created_at", since).limit(20);
  const fleetResends = ((prior.data ?? []) as any[]).filter((r) => r?.metadata?.by === "FLEET").length;
  if (fleetResends >= SIGNING_MAX_FLEET_RESENDS_7D) return fleetJson(429, { ok: false, error: "FLEET already resent this 3 times this week. Staff should call.", reason: "resend_cap" });

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const stamp = now.toISOString();
  const exp = new Date(now.getTime() + 30 * 86400_000).toISOString();
  // Conditional: never resurrect a draft, a signing/signed/voided document. The old link stops working.
  const upd = await admin.from("agreements").update({ token_hash: tokenHash, token_expires_at: exp, sent_at: stamp }).eq("id", ag.id).in("status", ["sent", "viewed"]).is("voided_at", null).select("id");
  if (upd.error || !(upd.data ?? []).length) return fleetJson(409, { ok: false, error: "The agreement changed while resending; nothing sent." });
  await admin.from("esign_recipients").update({ token_hash: tokenHash, token_expires_at: exp, sent_at: stamp }).eq("document_id", ag.id).eq("role", "signer");
  await fleetAudit(deps)({ action: "document.resent", summary: "Signing link reissued by FLEET (automated)", entityType: "esign_document", entityId: ag.id, metadata: { by: "FLEET", lead_id: ag.application_id ?? null } });

  let phone: string | null = null;
  if (ag.application_id) {
    const a = await admin.from("applications").select("phone").eq("id", ag.application_id).maybeSingle();
    phone = (a.data?.phone as string | null) ?? null;
  }
  const site = (deps.siteUrl ?? (() => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "")))();
  const deliver = deps.deliverSigning ?? (async (a, args) => (await import("@/lib/esign.server")).deliverSigningLink(a, args));
  const delivery = await deliver(admin, {
    id: ag.id,
    url: `${site}/sign/${token}`,
    email: (ag.signer_email as string | null) ?? null,
    phone,
    name: (md.driver_name as string | null) ?? null,
    vehicle: (md.vehicle as string | null) || null,
    applicationId: ag.application_id ?? null,
    actor: null,
  });
  // The raw link is never returned or logged.
  return fleetJson(200, { ok: true, kind: "signing", agreement_id: ag.id, lead_id: ag.application_id ?? null, email: delivery.email, sms: delivery.sms, delivered: delivery.delivered, link_expires_at: exp });
}

async function resendUpload(admin: Admin, body: Record<string, any>, deps: ResendDeps, now: Date): Promise<Response> {
  if (!UUID_RE.test(String(body.lead_id ?? ""))) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const leadId = String(body.lead_id);
  const a = await admin.from("applications")
    .select("id,full_name,status,email,phone,sms_consent,sms_opt_out_at,license_photo_url,profile_screenshot_url,income_proof_url,vehicle_size,pickup_date,expected_duration,gig_status,drive_type,deleted_at,primary_application_id,legal_hold")
    .eq("id", leadId).maybeSingle();
  if (a.error) return fleetJson(503, { ok: false, error: "Could not read the application." });
  const app = a.data;
  if (!app || app.deleted_at) return fleetJson(404, { ok: false, error: "Lead not found." });
  if (!UPLOAD_OPEN.includes(String(app.status)) || app.primary_application_id) return fleetJson(409, { ok: false, error: `The application is ${app.status}; no upload link to send.` });

  const blocked = await common(admin, deps, now, leadId);
  if (blocked) return blocked;

  const d = await admin.from("documents").select("category,review_status,is_current").eq("driver_id", leadId);
  if (d.error) return fleetJson(503, { ok: false, error: "Could not read documents." });
  const items = missingItems(app, d.data ?? []);
  if (!items.length) return fleetJson(409, { ok: false, error: "Nothing is missing.", reason: "nothing_missing" });

  const since = new Date(now.getTime() - UPLOAD_MIN_GAP_MS).toISOString();
  const [recentMsg, recentLog] = await Promise.all([
    admin.from("outbound_messages").select("id,created_at").eq("application_id", leadId).in("kind", [MISSING_ITEMS_KIND, UPLOAD_RESEND_KIND]).gte("created_at", since).limit(1),
    admin.from("applicant_outreach_log").select("id,created_at").eq("application_id", leadId).gte("created_at", since).limit(1),
  ]);
  if ((recentMsg.data ?? []).length || (recentLog.data ?? []).length) {
    return fleetJson(429, { ok: false, error: "A missing-items message went out in the last 24 hours.", reason: "recently_sent" });
  }

  const mint = deps.mintUploadLink ?? (async (adm: Admin, id: string) => {
    const { issueResumeToken, resumeUrl } = await import("@/lib/resume-tokens.server");
    return resumeUrl(await issueResumeToken(adm, id));
  });
  const link = await mint(admin, leadId);
  const companyPhone = await (deps.companyPhone ?? (async (adm: Admin) => (await (await import("@/lib/company.server")).getBusinessPhone(adm)).display))(admin);
  const vars = { firstName: firstNameOf(app.full_name), items, link, companyPhone, closeInDays: null, notDrivingYet: notDrivingGigYet(app) };

  let email: "sent" | "failed" | "not_attempted" = "not_attempted";
  let sms: "sent" | "failed" | "not_attempted" = "not_attempted";
  const { sendRenterEmail, sendRenterSms } = await import("@/lib/driver-contacts.server");
  const { subject, body: text } = outreachEmail(1, vars);
  const html = (await import("@/lib/automations.server")).renderAutomationEmailHtml(text, link);
  const sendEmail = deps.sendEmail ?? (async (x) => (await import("@/lib/email.server")).sendEmail(x));
  const mail = await sendRenterEmail({
    admin, applicationId: leadId, subject, html, track: { workflow: UPLOAD_RESEND_WORKFLOW }, sendEmail, app,
  });
  if (mail.sent > 0) {
    email = "sent";
    for (const to of mail.targets) {
      await admin.from("outbound_messages").insert({ channel: "email", to_address: to, subject, body: text, status: "sent", provider: "resend", kind: UPLOAD_RESEND_KIND, application_id: leadId });
    }
  } else if (mail.targets.length) email = "failed";
  const sendSms = deps.sendSms ?? (async (x) => (await import("@/lib/sms.server")).sendSms(x) as any);
  const texts = await sendRenterSms({ admin, applicationId: leadId, body: outreachSms(1, vars), kind: UPLOAD_RESEND_KIND, sendSms, app });
  if (texts.sent > 0) sms = "sent";
  else if (texts.results.some((r) => r && r.ok === false && !r.skipped)) sms = "failed";
  await fleetAudit(deps)({ action: "application.upload_link_resent", summary: "Upload link resent by FLEET (automated)", entityType: "application", entityId: leadId, metadata: { by: "FLEET", items, email, sms } });
  return fleetJson(200, { ok: true, kind: "upload", lead_id: leadId, missing: items, email, sms, delivered: email === "sent" || sms === "sent" });
}

export async function handleFleetResendLink(request: Request, deps: ResendDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  if (idempotencyKey(body.idempotency_key) === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 printable characters." });
  const admin = await fleetAdmin(deps);
  const now = (deps.now ?? (() => new Date()))();
  const kind = String(body.kind ?? "");
  try {
    if (kind === "signing") return await resendSigning(admin, body, deps, now);
    if (kind === "upload") return await resendUpload(admin, body, deps, now);
  } catch (e) {
    console.error("[fleet-resend-link] failed", String((e as Error)?.message ?? e));
    return fleetJson(503, { ok: false, error: "Could not resend the link." });
  }
  return fleetJson(400, { ok: false, error: "kind must be signing or upload." });
}
