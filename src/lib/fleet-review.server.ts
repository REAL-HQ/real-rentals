/**
 * FLEET applicant review API.
 *
 *   POST /api/public/fleet/applicants          list | get (the review packet)
 *   POST /api/public/fleet/applicant-decision  approve | decline | needs_staff
 *   POST /api/public/fleet/profile-note        append a staff-visible note
 *
 * Bearer FLEET_API_KEY (src/lib/fleet-api.server.ts). Approve runs the exact
 * staff approval code path (approveApplicationCore in applications.functions)
 * and is refused while any hard blocker exists (src/lib/fleet-review.ts).
 * Decline sets applications.status to declined, the same write staff use,
 * audited as FLEET (automated). It sends the decline email and text unless
 * skip_notify is true. Notes are appended to applications.notes. Nothing
 * here writes insurance, screening, background-check or verification fields.
 *
 * Decisions are stored in public.fleet_review_decisions
 * (proposed/fleet-applicant-review-v1.sql) and every one is audited as
 * "FLEET (automated)". See docs/fleet-applicant-review.md.
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
import {
  assessForFleet,
  FLEET_ACTOR_LABEL,
  FLEET_REVIEW_STAGES,
  readyForReview,
  type FleetDoc,
} from "@/lib/fleet-review";
import { computeReadiness } from "@/lib/readiness";
import { fleetContactsFor, listDriverContacts } from "@/lib/driver-contacts.server";
import { last10Digits, normalizeDriverEmail } from "@/lib/driver-contacts";
import { listDriverAddresses } from "@/lib/driver-addresses.server";
import { APPLICATION_ADDRESS_LABEL, addressFromApplication, formatAddress } from "@/lib/driver-addresses";
import { readRentidSettings } from "@/lib/fleet-rentid.server";
import { appendNote } from "@/lib/blacklist";
import {
  declineApplicantSms,
  declineProfileLine,
  FLEET_NOTE_MAX,
  profileNoteLine,
} from "@/lib/fleet-profile-note";

type Admin = any;
const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
export const adminUrlFor = (id: string) => `${SITE()}/admin?tab=drivers&id=${encodeURIComponent(id)}`;

/** Answers FLEET sees. Payment identifiers, consent text and history blobs stay out. */
const ANSWER_COLS = [
  "id", "full_name", "email", "phone", "dob", "address", "city", "state", "zip",
  "license_number", "license_state", "license_expiration", "years_licensed", "license_valid",
  "platforms", "weekly_hours", "platform_active", "platform_status", "gig_status", "trips_completed", "rating",
  "start_date", "start_timing", "pickup_date", "pickup_time", "rental_term", "rental_length", "rental_duration",
  "rental_duration_days", "expected_duration", "drive_type", "vehicle_size", "vehicle_id", "weekly_rent",
  "payment_method", "consent_gps", "consent_background", "consent_prepay", "consent_terms", "sms_consent",
  "status", "contact_status", "source", "how_heard", "created_at", "updated_at", "current_step",
  "profile_screenshot_url", "trip_screenshots", "resubmission_count", "primary_application_id",
  "background_check_status", "mvr_status", "incident_count",
  "insurance_answer", "insurance_status", "full_coverage_insurance", "insurance_carrier", "insurance_expires_on",
  "insurance_rideshare_endorsement", "insurance_doc_url",
  "ai_score", "ai_tier", "ai_flags", "ai_summary", "scored_at",
  "deleted_at", "legal_hold", "card_last4", "card_on_file_at",
] as const;
const APP_SELECT = ANSWER_COLS.join(",");
const DOC_SELECT = "id,driver_id,category,label,file_name,mime_type,size_bytes,review_status,review_note,reviewed_at,is_current,created_at,expires_at,evidence_class,uploaded_by_role,storage_bucket,storage_path,visibility,source";
const SCREENING_SELECT =
  "lead_id,status,interview_completed_at,gig_apps,gig_account_status,months_on_platform,trip_count,driver_rating,drive_type,has_current_vehicle,needed_by_date,rate_confirmed,card_in_own_name,license_state,license_active,license_years,driver_age,has_personal_insurance,policy_active,rideshare_endorsement,insurance_name_matches_license,accidents_last_3yr,has_dui,major_violations,license_points,mvr_authorized,qualification_score,disqualified,disqualification_reason,insurance_verified,insurance_verified_at";

function maskLicense(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= 4 ? "****" : `${"*".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

/** Open Needs Staff flags by application (empty when the table is not installed yet). */
export async function openNeedsStaff(admin: Admin, ids: string[]): Promise<Map<string, { id: string; reason: string; created_at: string | null }>> {
  const out = new Map<string, { id: string; reason: string; created_at: string | null }>();
  if (!ids.length) return out;
  const res = await admin.from("fleet_review_decisions").select("id,application_id,reason,created_at,decision,resolved_at")
    .in("application_id", ids).eq("decision", "needs_staff").is("resolved_at", null);
  if (res.error) return out;
  for (const r of res.data ?? []) out.set(r.application_id, { id: r.id, reason: r.reason, created_at: r.created_at ?? null });
  return out;
}

function digits(p: unknown): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

async function priorDeclinedCount(admin: Admin, app: Record<string, any>): Promise<number> {
  const phones = new Set<string>();
  const emails = new Set<string>();
  const p = last10Digits(app.phone) ?? (digits(app.phone).length === 10 ? digits(app.phone) : "");
  if (p) phones.add(p);
  const e = normalizeDriverEmail(app.email);
  if (e) emails.add(e);
  try {
    for (const c of await listDriverContacts(admin, app.id)) {
      if (c.kind === "phone") {
        const d = last10Digits(c.value);
        if (d) phones.add(d);
      } else {
        const v = normalizeDriverEmail(c.value);
        if (v) emails.add(v);
      }
    }
  } catch {
    // table missing or unreadable: fall through with the primary only
  }
  if (!phones.size && !emails.size) return 0;
  const res = await admin.from("applications").select("id,phone,email,status").in("status", ["declined", "closed"]).limit(1000);
  if (res.error) return 0;
  const hits = new Set<string>();
  for (const r of (res.data ?? []) as any[]) {
    if (r.id === app.id) continue;
    if ((last10Digits(r.phone) && phones.has(last10Digits(r.phone)!)) || (normalizeDriverEmail(r.email) && emails.has(normalizeDriverEmail(r.email)!))) {
      hits.add(r.id);
    }
  }
  const ids = ((res.data ?? []) as any[]).map((r) => r.id).filter((id: string) => id !== app.id);
  if (ids.length) {
    const extra = await admin.from("driver_contacts").select("application_id,kind,value").in("application_id", ids);
    if (!extra.error) {
      for (const c of (extra.data ?? []) as any[]) {
        if (c.application_id === app.id) continue;
        if (c.kind === "phone" && last10Digits(c.value) && phones.has(last10Digits(c.value)!)) hits.add(c.application_id);
        if (c.kind === "email" && normalizeDriverEmail(c.value) && emails.has(normalizeDriverEmail(c.value)!)) hits.add(c.application_id);
      }
    }
  }
  return hits.size;
}

/** Everything FLEET needs to decide one applicant. Null when not found. */
export async function buildReviewPacket(admin: Admin, leadId: string, opts: { includeUrls?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const appRes = await admin.from("applications").select(APP_SELECT).eq("id", leadId).maybeSingle();
  if (appRes.error) throw new Error("Could not read the application.");
  const app = appRes.data as Record<string, any> | null;
  if (!app) return null;
  const { latestLicenseReading } = await import("@/lib/fleet-license.server");
  const [docsRes, scrRes, agRes, flags, prior, decisionsRes, licenseReading, rentid] = await Promise.all([
    admin.from("documents").select(DOC_SELECT).eq("driver_id", leadId),
    admin.from("driver_screenings").select(SCREENING_SELECT).eq("lead_id", leadId).limit(1),
    admin.from("agreements").select("id,status,sent_at,signed_at,voided_at").eq("application_id", leadId),
    openNeedsStaff(admin, [leadId]),
    priorDeclinedCount(admin, app),
    admin.from("fleet_review_decisions").select("id,decision,reason,decided_by,created_at,resolved_at,resolution_note").eq("application_id", leadId).order("created_at", { ascending: false }).limit(10),
    latestLicenseReading(admin, leadId).catch(() => null),
    readRentidSettings(admin),
  ]);
  const docs = ((docsRes.data ?? []) as any[]).filter((d) => d.is_current !== false);
  const screening = Array.isArray(scrRes.data) ? scrRes.data[0] ?? null : null;
  const readiness = computeReadiness(app, screening, docs);
  const open = flags.get(leadId) ?? null;
  const assessment = assessForFleet({
    app, screening, docs: docs as FleetDoc[], disqualifiers: readiness.disqualifiers, readinessState: readiness.state,
    openNeedsStaff: open, priorDeclined: prior, licenseReading, rentidRequired: rentid.require_for_approval, now,
  });

  let documents: any[] = docs.map((d) => ({
    id: d.id, category: d.category ?? "other", label: d.label ?? null, file_name: d.file_name ?? null, mime_type: d.mime_type ?? null,
    size_bytes: d.size_bytes ?? null, review_status: d.review_status ?? "uploaded", review_note: d.review_note ?? null,
    reviewed_at: d.reviewed_at ?? null, uploaded_at: d.created_at ?? null, expires_at: d.expires_at ?? null,
    evidence_class: d.evidence_class ?? null, uploaded_by_role: d.uploaded_by_role ?? null, url: null as string | null,
  }));
  if (opts.includeUrls && docs.length) {
    // The same 15-minute signer the back office uses (documents.functions.ts).
    const { withUrls } = await import("@/lib/documents.functions");
    const signed = await withUrls(admin, docs, true);
    const byId = new Map(signed.map((s: any) => [s.id, s.url]));
    documents = documents.map((d) => ({ ...d, url: byId.get(d.id) ?? null, url_expires_in_seconds: byId.get(d.id) ? 900 : null }));
  }

  const { license_number, insurance_carrier, insurance_doc_url, profile_screenshot_url, trip_screenshots, ...answers } = app;
  const tripShots = Array.isArray(trip_screenshots) ? trip_screenshots.length : 0;
  const contacts = await fleetContactsFor(admin, leadId, app);
  let addresses = await listDriverAddresses(admin, leadId).catch(() => []);
  if (!addresses.length) {
    const primary = addressFromApplication(app);
    if (primary) {
      addresses = [{
        id: "primary-address",
        application_id: app.id,
        line1: primary.line1 ?? "",
        line2: primary.line2 ?? null,
        city: primary.city,
        state: primary.state,
        zip: primary.zip,
        label: APPLICATION_ADDRESS_LABEL,
        source: "application",
        is_primary: true,
        created_by: null,
        created_at: app.created_at ?? "",
        updated_at: app.updated_at ?? "",
      }];
    }
  }
  return {
    lead_id: app.id,
    name: app.full_name ?? null,
    status: app.status ?? null,
    admin_url: adminUrlFor(app.id),
    contacts,
    addresses: addresses.map((r) => ({
      line1: r.line1 || null,
      city: r.city,
      state: r.state,
      zip: r.zip,
      label: r.label,
      source: r.source,
      is_primary: r.is_primary,
      display: formatAddress(r),
    })),
    answers: { ...answers, license_number_masked: maskLicense(license_number) },
    documents,
    // Every active file, counted per section, so a section with two files is
    // never read as one. Review each file in `documents`, not the newest only.
    documents_by_category: assessment.docs.files,
    // What FLEET read off the license photo (label "Read by FLEET from license
    // photo"). Never a verification: the field rep confirms at pickup.
    license_reading: licenseReading,
    gig_evidence: {
      platforms: app.platforms ?? null,
      gig_status: app.gig_status ?? null,
      trips_completed: app.trips_completed ?? null,
      rating: app.rating ?? null,
      profile_screenshot_on_application: !!profile_screenshot_url,
      trip_screenshots_on_application: tripShots,
      gig_profile_documents: documents.filter((d) => d.category === "gig_profile").length,
      trip_history_documents: documents.filter((d) => d.category === "trip_history").length,
    },
    screening: screening
      ? { ...screening, recorded_by_staff: !!screening.interview_completed_at }
      : null,
    checks: {
      background_check_status: app.background_check_status ?? null,
      mvr_status: app.mvr_status ?? null,
      incident_count: app.incident_count ?? null,
    },
    // Historical answers only. Renter insurance is not required — Real Rentals
    // provides it — so a "no" / "no full coverage" / missing document is never
    // a flag, a blocker, or a missing item. FLEET must not treat any of this
    // as verified unless insurance_verified_by_staff is true, and this packet
    // never marks anyone insured. Carrier names are never included.
    insurance: {
      required: false,
      provided_by_company: true,
      note: "Real Rentals provides insurance. A renter's own insurance is not required, and no insurance or no full coverage is not a flag or a missing item.",
      answer: app.insurance_answer ?? null,
      status: app.insurance_status ?? null,
      full_coverage_insurance: app.full_coverage_insurance ?? null,
      carrier_on_file: !!String(insurance_carrier ?? "").trim(),
      expires_on: app.insurance_expires_on ?? null,
      rideshare_endorsement: app.insurance_rideshare_endorsement ?? null,
      document_on_file: !!insurance_doc_url || documents.some((d) => d.category === "insurance"),
      insurance_verified_by_staff: screening?.insurance_verified === true,
    },
    analysis: {
      ai_score: app.ai_score ?? null,
      ai_tier: app.ai_tier ?? null,
      score_flags: app.ai_flags ?? null,
      score_summary: app.ai_summary ?? null,
      scored_at: app.scored_at ?? null,
      readiness: {
        state: readiness.state,
        label: readiness.stateLabel,
        qualification: readiness.qualification,
        coverage: readiness.coverage,
        verified_coverage: readiness.verifiedCoverage,
        disqualifiers: readiness.disqualifiers,
        attention: readiness.attention.map((f) => `${f.label}: ${f.detail}`),
        unknown: readiness.unknowns.map((f) => f.label),
      },
    },
    agreements: (agRes.data ?? []).map((g: any) => ({ id: g.id, status: g.status, sent_at: g.sent_at ?? null, signed_at: g.signed_at ?? null, voided_at: g.voided_at ?? null })),
    fleet_review: {
      open_needs_staff: open,
      history: decisionsRes.error ? [] : decisionsRes.data ?? [],
    },
    readiness_blockers: assessment.hard_blockers,
    assessment,
  };
}

const LIST_LIMIT_MAX = 100;

export async function listAwaitingReview(admin: Admin, opts: { readyOnly?: boolean; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), LIST_LIMIT_MAX);
  const res = await admin.from("applications").select(APP_SELECT)
    .in("status", [...FLEET_REVIEW_STAGES]).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(500);
  if (res.error) throw new Error("Could not read applications.");
  const apps = ((res.data ?? []) as any[]).filter((a) => !a.primary_application_id);
  const ids = apps.map((a) => a.id);
  const [docsRes, scrRes, flags, rentid] = await Promise.all([
    ids.length ? admin.from("documents").select("driver_id,category,review_status,is_current,created_at").in("driver_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("driver_screenings").select(SCREENING_SELECT).in("lead_id", ids) : Promise.resolve({ data: [] }),
    openNeedsStaff(admin, ids),
    readRentidSettings(admin),
  ]);
  const docsBy = new Map<string, any[]>();
  for (const d of (docsRes.data ?? []) as any[]) {
    if (d.is_current === false) continue;
    (docsBy.get(d.driver_id) ?? docsBy.set(d.driver_id, []).get(d.driver_id)!).push(d);
  }
  const scrBy = new Map<string, any>();
  for (const s of (scrRes.data ?? []) as any[]) if (!scrBy.has(s.lead_id)) scrBy.set(s.lead_id, s);
  const rows = apps.map((app) => {
    const docs = docsBy.get(app.id) ?? [];
    const screening = scrBy.get(app.id) ?? null;
    const readiness = computeReadiness(app, screening, docs);
    const open = flags.get(app.id) ?? null;
    const a = assessForFleet({ app, screening, docs, disqualifiers: readiness.disqualifiers, readinessState: readiness.state, openNeedsStaff: open, priorDeclined: 0, rentidRequired: rentid.require_for_approval, now });
    return {
      lead_id: app.id,
      name: app.full_name ?? null,
      status: app.status,
      applied_at: app.created_at ?? null,
      ready_for_review: a.ready_for_review,
      needs_staff_open: !!open,
      recommendation: a.recommendation,
      hard_blockers: a.hard_blockers.map((b) => b.code),
      escalations: a.escalations.map((e) => e.code),
      docs_missing: a.docs.missing_required,
      no_track_record: a.no_track_record,
      admin_url: adminUrlFor(app.id),
    };
  });
  const filtered = opts.readyOnly === false ? rows : rows.filter((r) => r.ready_for_review && !r.needs_staff_open);
  return { total: filtered.length, rows: filtered.slice(0, limit) };
}

/**
 * POST /api/public/fleet/applicants
 *   { "action": "list", "ready_only": true, "limit": 50 }
 *   { "action": "get", "lead_id": "…", "include_urls": false }
 */
export async function handleFleetApplicants(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const now = (deps.now ?? (() => new Date()))();
  const action = String(body.action ?? "list");
  try {
    if (action === "list") {
      const out = await listAwaitingReview(admin, { readyOnly: body.ready_only !== false, limit: body.limit, now });
      return fleetJson(200, { ok: true, ...out });
    }
    if (action === "get") {
      if (!UUID_RE.test(String(body.lead_id ?? ""))) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
      const packet = await buildReviewPacket(admin, String(body.lead_id), { includeUrls: body.include_urls === true, now });
      if (!packet) return fleetJson(404, { ok: false, error: "Applicant not found." });
      return fleetJson(200, { ok: true, packet });
    }
  } catch (e) {
    console.error("[fleet-review] read failed", String((e as Error)?.message ?? e));
    return fleetJson(503, { ok: false, error: "Could not read applicants." });
  }
  return fleetJson(400, { ok: false, error: "action must be list or get." });
}

type ApproveCore = (args: Parameters<typeof import("@/lib/applications.functions").approveApplicationCore>[0]) => ReturnType<typeof import("@/lib/applications.functions").approveApplicationCore>;
type DeclineEmail = (args: { to: string; firstName: string | null; applicationId: string; companyPhone: string }) => Promise<{ ok: boolean; blocked?: string | null }>;
type DeclineSms = (args: { to: string; body: string; kind?: string; applicationId?: string | null; requireConsent?: boolean }) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
export type DecisionDeps = FleetDeps & {
  approve?: ApproveCore;
  /** Test seam. Production uses sendApplicationDeclinedEmail. */
  sendDeclineEmail?: DeclineEmail;
  /** Test seam. Production uses sendSms. */
  sendDeclineSms?: DeclineSms;
  companyPhone?: (admin: Admin) => Promise<string>;
};

export type DeclineNotice = { email: string; sms: string };

function publicDecision(stored: string): "approve" | "needs_staff" | "decline" {
  if (stored === "approved") return "approve";
  if (stored === "declined") return "decline";
  return "needs_staff";
}

/** Optional profile note. null = omitted. "invalid" = wrong type or over the cap. */
function parseProfileNote(v: unknown): string | null | "invalid" {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > FLEET_NOTE_MAX) return "invalid";
  return s;
}

/** Only a JSON boolean true skips. Omitted and false send the notice. */
function parseSkipNotify(v: unknown): boolean | "invalid" {
  if (v == null || v === false) return false;
  if (v === true) return true;
  return "invalid";
}

async function appendProfileLines(admin: Admin, leadId: string, lines: string[]): Promise<{ ok: true; notes: string; added: boolean } | { ok: false; error: string }> {
  const res = await admin.from("applications").select("id,notes,deleted_at").eq("id", leadId).maybeSingle();
  if (res.error) return { ok: false, error: "Could not read the profile notes." };
  if (!res.data || res.data.deleted_at) return { ok: false, error: "Applicant not found." };
  let notes = String(res.data.notes ?? "");
  let added = false;
  for (const line of lines) {
    const next = appendNote(notes, line);
    if (next !== notes) added = true;
    notes = next;
  }
  if (!added) return { ok: true, notes, added: false };
  const upd = await admin.from("applications").update({ notes }).eq("id", leadId).is("deleted_at", null).select("id");
  if (upd.error || !Array.isArray(upd.data) || upd.data.length !== 1) return { ok: false, error: "Could not save the note." };
  return { ok: true, notes, added: true };
}

async function companyPhoneDisplay(admin: Admin, deps: DecisionDeps): Promise<string> {
  if (deps.companyPhone) return deps.companyPhone(admin);
  const { getBusinessPhone } = await import("@/lib/company.server");
  return (await getBusinessPhone(admin)).display;
}

async function deliverDeclineNotice(
  admin: Admin,
  deps: DecisionDeps,
  app: { id: string; name: string | null; email: string | null; phone: string | null },
  skip: boolean,
): Promise<DeclineNotice> {
  if (skip) return { email: "skipped", sms: "skipped" };
  const phone = await companyPhoneDisplay(admin, deps);
  let email: string = "no_email";
  const to = String(app.email ?? "").trim();
  if (to) {
    try {
      const send: DeclineEmail = deps.sendDeclineEmail ?? (async (args) => {
        const { sendApplicationDeclinedEmail } = await import("@/lib/email.server");
        return sendApplicationDeclinedEmail(args);
      });
      const result = await send({ to, firstName: app.name, applicationId: app.id, companyPhone: phone });
      email = result.ok ? "sent" : result.blocked === "blacklisted" ? "blacklisted" : result.blocked === "off" ? "off" : result.blocked === "held" ? "held" : "failed";
    } catch (e) {
      console.error("[fleet-review] decline email failed", String((e as Error)?.message ?? e));
      email = "failed";
    }
  }
  let sms = "no_phone";
  const rawPhone = String(app.phone ?? "").trim();
  if (rawPhone) {
    try {
      const send: DeclineSms = deps.sendDeclineSms ?? (async (args) => {
        const { sendSms } = await import("@/lib/sms.server");
        return sendSms(args);
      });
      const result = await send({
        to: rawPhone,
        body: declineApplicantSms(app.name, phone),
        kind: "application_declined",
        applicationId: app.id,
        requireConsent: true,
      });
      if (result.ok) sms = "sent";
      else if (result.reason === "opted_out") sms = "opted_out";
      else if (result.reason === "blacklisted") sms = "blacklisted";
      else if (result.reason === "invalid_phone") sms = "no_phone";
      else if (result.skipped) sms = "no_consent";
      else sms = "failed";
    } catch (e) {
      console.error("[fleet-review] decline text failed", String((e as Error)?.message ?? e));
      sms = "failed";
    }
  }
  return { email, sms };
}

/** FLEET has no staff session: on a database with the approval packet installed, approval stays with staff. */
const FLEET_NO_SESSION_RPC = async () => ({
  data: null,
  error: { code: "FLEET_NO_SESSION", message: "The approval check on this database needs a staff sign-in. FLEET cannot approve here; send needs_staff." },
});

/**
 * POST /api/public/fleet/applicant-decision
 *   { "lead_id": "…", "decision": "approve" | "decline" | "needs_staff", "reason": "…",
 *     "skip_notify": false, "note": "…", "escalation_codes": ["low_rating"], "idempotency_key": "…" }
 *
 * skip_notify applies only to decline. Omitted or false sends the decline
 * email and text. true skips both. The internal reason is never in the notice.
 */
export async function handleFleetApplicantDecision(request: Request, deps: DecisionDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const rawInput = String(body.decision ?? "").trim().toLowerCase();
  const raw = rawInput === "declined" ? "decline" : rawInput;
  if (raw !== "approve" && raw !== "decline" && raw !== "needs_staff") {
    return fleetJson(400, { ok: false, error: "decision must be approve, decline, or needs_staff." });
  }
  const reason = cleanText(body.reason, 1000);
  if (reason.length < 5) return fleetJson(400, { ok: false, error: "reason is required (at least 5 characters)." });
  const note = parseProfileNote(body.note);
  if (note === "invalid") return fleetJson(400, { ok: false, error: `note must be ${FLEET_NOTE_MAX} characters or fewer.` });
  const skipNotify = raw === "decline" ? parseSkipNotify(body.skip_notify) : false;
  if (skipNotify === "invalid") return fleetJson(400, { ok: false, error: "skip_notify must be true or false." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const codes = Array.isArray(body.escalation_codes) ? body.escalation_codes.map((c: unknown) => cleanText(c, 60)).filter(Boolean).slice(0, 30) : [];

  // Idempotent replay.
  if (idem) {
    const prior = await admin.from("fleet_review_decisions").select("id,application_id,decision,created_at").eq("idempotency_key", idem).maybeSingle();
    if (prior.error && !tableMissing(prior.error, "fleet_review_decisions")) return fleetJson(503, { ok: false, error: "Could not read decisions." });
    if (prior.data) {
      if (prior.data.application_id !== leadId) return fleetJson(409, { ok: false, error: "idempotency_key was already used for another applicant." });
      return fleetJson(200, { ok: true, duplicate: true, decision_id: prior.data.id, decision: publicDecision(prior.data.decision), lead_id: leadId });
    }
  }

  let packet: Awaited<ReturnType<typeof buildReviewPacket>>;
  try {
    packet = await buildReviewPacket(admin, leadId, { now });
  } catch {
    return fleetJson(503, { ok: false, error: "Could not read the applicant." });
  }
  if (!packet) return fleetJson(404, { ok: false, error: "Applicant not found." });
  const a = packet.assessment;

  const record = async (decision: "approved" | "needs_staff" | "declined", extra: Record<string, unknown> = {}) => {
    const row = {
      application_id: leadId,
      decision,
      reason,
      escalation_codes: codes,
      assessment: { hard_blockers: a.hard_blockers, escalations: a.escalations, recommendation: a.recommendation, ...extra },
      decided_by: FLEET_ACTOR_LABEL,
      idempotency_key: idem,
    };
    return admin.from("fleet_review_decisions").insert(row).select("id").single();
  };

  const saveNote = async (lines: string[]) => {
    if (!lines.length) return { saved: false as const };
    const wrote = await appendProfileLines(admin, leadId, lines);
    if (!wrote.ok) console.error("[fleet-review] profile note not saved", wrote.error);
    return { saved: wrote.ok && wrote.added, error: wrote.ok ? null : wrote.error };
  };

  if (raw === "decline") {
    const answers = packet.answers as { email?: string | null; phone?: string | null; deleted_at?: string | null };
    if (answers.deleted_at) return fleetJson(404, { ok: false, error: "Applicant not found." });
    if (String(packet.status) === "declined") {
      return fleetJson(200, {
        ok: true, duplicate: true, already_declined: true, decision: "decline", lead_id: leadId,
        skip_notify: skipNotify === true, decline_notice: { email: "skipped", sms: "skipped" }, admin_url: packet.admin_url,
      });
    }
    // Same guards as the staff status change: an active rental, or a status
    // of active, is ended through the rental workflow. Decline does not void
    // agreements, refund money, or write the blacklist.
    if (String(packet.status) === "active") {
      return fleetJson(409, { ok: false, error: "End the rental through the rental workflow first." });
    }
    const rentals = await admin.from("rentals").select("id").eq("application_id", leadId).eq("status", "active").limit(1);
    if (rentals.error) return fleetJson(503, { ok: false, error: "Could not check rentals." });
    if ((rentals.data ?? []).length) {
      return fleetJson(409, { ok: false, error: "Cannot change lifecycle while an active rental exists." });
    }
    const previous = packet.status == null ? null : String(packet.status);
    let updQuery = admin.from("applications").update({ status: "declined" }).eq("id", leadId).is("deleted_at", null);
    updQuery = previous == null ? updQuery.is("status", null) : updQuery.eq("status", previous);
    const upd = await updQuery.select("id");
    if (upd.error) return fleetJson(503, { ok: false, error: "Could not decline the application. Nothing was changed." });
    if (!Array.isArray(upd.data) || upd.data.length !== 1) {
      return fleetJson(409, { ok: false, error: "The application changed before it could be declined. Nothing was changed." });
    }
    const ins = await record("declined", { skip_notify: skipNotify === true });
    if (ins.error) console.error("[fleet-review] decline decision not recorded", ins.error?.code ?? "", ins.error?.message ?? "");
    const lines = [declineProfileLine(FLEET_ACTOR_LABEL, now, reason)];
    if (note) lines.push(profileNoteLine(FLEET_ACTOR_LABEL, now, note));
    const noted = await saveNote(lines);
    const declineNotice = await deliverDeclineNotice(admin, deps, {
      id: leadId,
      name: packet.name ?? null,
      email: answers.email ?? null,
      phone: answers.phone ?? null,
    }, skipNotify === true);
    await audit({
      action: "application.fleet_declined",
      summary: `Declined by ${FLEET_ACTOR_LABEL}: ${reason}`.slice(0, 300),
      entityType: "application",
      entityId: leadId,
      metadata: {
        decided_by: FLEET_ACTOR_LABEL,
        reason,
        previous_status: previous,
        status: "declined",
        skip_notify: skipNotify === true,
        decline_notice: declineNotice,
        decision_id: ins.data?.id ?? null,
        note: note ?? null,
      },
    });
    return fleetJson(201, {
      ok: true,
      decision: "decline",
      lead_id: leadId,
      decision_id: ins.data?.id ?? null,
      previous_status: previous,
      skip_notify: skipNotify === true,
      decline_notice: declineNotice,
      note_saved: noted.saved,
      admin_url: packet.admin_url,
    });
  }

  if (raw === "needs_staff") {
    const open = packet.fleet_review.open_needs_staff;
    if (open) {
      const noted = note ? await saveNote([profileNoteLine(FLEET_ACTOR_LABEL, now, note)]) : { saved: false };
      return fleetJson(200, { ok: true, duplicate: true, decision: "needs_staff", decision_id: open.id, lead_id: leadId, reason: open.reason, ...(note ? { note_saved: noted.saved } : {}) });
    }
    if (String(packet.status) === "approved" || String(packet.status) === "active") {
      return fleetJson(409, { ok: false, error: `Already ${packet.status}; nothing for staff to approve.` });
    }
    const ins = await record("needs_staff");
    if (ins.error || !ins.data) {
      if (tableMissing(ins.error, "fleet_review_decisions")) return fleetJson(503, { ok: false, error: "The staff queue is not set up yet (fleet_review_decisions). Nothing was changed." });
      if (String(ins.error?.code) === "23505") return fleetJson(409, { ok: false, error: "A Needs Staff flag is already open, or the idempotency_key was reused. Retry with action get." });
      return fleetJson(503, { ok: false, error: "Could not save the decision. Nothing was changed." });
    }
    const noted = note ? await saveNote([profileNoteLine(FLEET_ACTOR_LABEL, now, note)]) : { saved: false };
    await audit({
      action: "application.fleet_needs_staff",
      summary: `Sent to staff by ${FLEET_ACTOR_LABEL}: ${reason}`.slice(0, 300),
      entityType: "application",
      entityId: leadId,
      metadata: { decided_by: FLEET_ACTOR_LABEL, reason, escalation_codes: codes, decision_id: ins.data.id, ...(note ? { note } : {}) },
    });
    return fleetJson(201, { ok: true, decision: "needs_staff", decision_id: ins.data.id, lead_id: leadId, admin_url: packet.admin_url, ...(note ? { note_saved: noted.saved } : {}) });
  }

  // ---- approve
  if (String(packet.status) === "approved") {
    const noted = note ? await saveNote([profileNoteLine(FLEET_ACTOR_LABEL, now, note)]) : { saved: false };
    return fleetJson(200, { ok: true, duplicate: true, decision: "approve", lead_id: leadId, already_approved: true, ...(note ? { note_saved: noted.saved } : {}) });
  }
  if (a.hard_blockers.length) {
    return fleetJson(409, { ok: false, error: "Approval refused: hard blockers exist. Fix them or send needs_staff.", hard_blockers: a.hard_blockers });
  }
  // Not driving for a gig app yet: no trip/rating record, so FLEET approves
  // only a clean file. Any escalation means staff decide (Dolmar, t339u).
  if (a.no_track_record && a.escalations.length) {
    return fleetJson(409, {
      ok: false,
      error: "Approval refused: this applicant is not driving for a gig app yet, so FLEET can approve only a clean file. Send needs_staff with these reasons.",
      escalations: a.escalations,
    });
  }
  const approve: ApproveCore = deps.approve ?? (await import("@/lib/applications.functions")).approveApplicationCore;
  const res = await approve({
    admin,
    data: { id: leadId, sendAgreement: false },
    actor: null,
    createdBy: null,
    rpc: FLEET_NO_SESSION_RPC,
    decidedBy: { label: FLEET_ACTOR_LABEL, reason },
    // D30: FLEET says it sent its approval text (P12), so the approval email is skipped.
    ...(body.approval_text_sent === true ? { skipApprovalEmail: true } : {}),
  });
  if (!res.ok) return fleetJson(409, { ok: false, error: res.error ?? "Approval was refused." });
  const ins = await record("approved");
  if (ins.error) console.error("[fleet-review] approval decision not recorded", ins.error?.code ?? "", ins.error?.message ?? "");
  await audit({
    action: "application.fleet_approved",
    summary: `Approved by ${FLEET_ACTOR_LABEL}: ${reason}`.slice(0, 300),
    entityType: "application",
    entityId: leadId,
    metadata: { decided_by: FLEET_ACTOR_LABEL, reason, escalation_codes: codes, decision_id: ins.data?.id ?? null, approval_email: res.approvalEmail ?? null },
  });
  // The Approved stage is the application status itself; this is the trail
  // that says FLEET did it (shown as "By FLEET" on the profile).
  const { recordFleetLifecycleStep } = await import("@/lib/fleet-lifecycle.server");
  await recordFleetLifecycleStep(audit, { applicationId: leadId, step: "approved", evidence: reason, source: "applicant-decision", at: new Date(), extra: { decision_id: ins.data?.id ?? null } });
  const noted = note ? await saveNote([profileNoteLine(FLEET_ACTOR_LABEL, now, note)]) : { saved: false };
  return fleetJson(201, {
    ok: true,
    decision: "approve",
    lead_id: leadId,
    decision_id: ins.data?.id ?? null,
    approval_email: res.approvalEmail ?? null,
    next: "Approved. Agreements are sent separately; the Reserved step sends login details.",
    admin_url: packet.admin_url,
    ...(note ? { note_saved: noted.saved } : {}),
  });
}

/**
 * POST /api/public/fleet/profile-note
 *   { "lead_id": "…", "note": "…", "idempotency_key": "…" }
 *
 * Appends one line to applications.notes, attributed to FLEET (automated).
 * The same line on the same Eastern day is stored once. An idempotency key
 * replays the first result and is refused if it was used for someone else.
 */
export async function handleFleetProfileNote(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();
  const leadId = String(body.lead_id ?? "");
  if (!UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const note = parseProfileNote(body.note);
  if (note === "invalid" || !note) return fleetJson(400, { ok: false, error: `note is required (1 to ${FLEET_NOTE_MAX} characters).` });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  if (idem) {
    const prior = await admin.from("audit_log").select("id,entity_id,action,metadata").eq("action", "application.fleet_note").limit(1000);
    if (prior.error && !tableMissing(prior.error, "audit_log")) return fleetJson(503, { ok: false, error: "Could not read notes." });
    const hit = ((prior.data ?? []) as any[]).find((r) => r?.metadata?.idempotency_key === idem);
    if (hit) {
      if (hit.entity_id !== leadId) return fleetJson(409, { ok: false, error: "idempotency_key was already used for another applicant." });
      return fleetJson(200, { ok: true, duplicate: true, lead_id: leadId, note_id: hit.id ?? null });
    }
  }
  const line = profileNoteLine(FLEET_ACTOR_LABEL, now, note);
  const wrote = await appendProfileLines(admin, leadId, [line]);
  if (!wrote.ok) {
    const status = wrote.error === "Applicant not found." ? 404 : 503;
    return fleetJson(status, { ok: false, error: wrote.error });
  }
  if (!wrote.added) {
    return fleetJson(200, { ok: true, duplicate: true, lead_id: leadId, admin_url: adminUrlFor(leadId) });
  }
  await audit({
    action: "application.fleet_note",
    summary: `Note by ${FLEET_ACTOR_LABEL}: ${note}`.slice(0, 300),
    entityType: "application",
    entityId: leadId,
    metadata: { decided_by: FLEET_ACTOR_LABEL, note, ...(idem ? { idempotency_key: idem } : {}) },
  });
  return fleetJson(201, { ok: true, lead_id: leadId, note_saved: true, admin_url: adminUrlFor(leadId) });
}

// ---------------------------------------------------------------- ready-for-review sweep

/**
 * application_ready_for_review. There is no single moment an applicant
 * "finishes": Step 1 creates the row, and the documents arrive later from
 * many upload paths. So the every-minute FLEET cron sweeps recent activity
 * (applications updated, or vault documents added, in the last `windowMs`)
 * and queues the event once per applicant (dedupe key) the first time the
 * applicant is submitted (New/Reviewing/Complete) with the required
 * documents on file. Applicants who were already ready before this shipped
 * are found with action list.
 */
export async function sweepReadyForReview(admin: Admin, opts: { now?: Date; windowMs?: number } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowMs ?? 3 * 3600_000)).toISOString();
  const [updated, newDocs] = await Promise.all([
    admin.from("applications").select("id").in("status", [...FLEET_REVIEW_STAGES]).is("deleted_at", null).gte("updated_at", since).limit(200),
    admin.from("documents").select("driver_id").gte("created_at", since).limit(500),
  ]);
  const ids = new Set<string>();
  for (const r of (updated.data ?? []) as any[]) if (r.id) ids.add(r.id);
  for (const r of (newDocs.data ?? []) as any[]) if (r.driver_id) ids.add(r.driver_id);
  if (!ids.size) return [];
  const list = [...ids].slice(0, 200);
  const [apps, docs, existing] = await Promise.all([
    // gig_status decides which documents count as "ready" (hardDocCategoriesFor).
    admin.from("applications").select("id,full_name,phone,email,status,deleted_at,primary_application_id,created_at,gig_status").in("id", list),
    admin.from("documents").select("driver_id,category,review_status,is_current").in("driver_id", list),
    admin.from("fleet_webhook_deliveries").select("dedupe_key").in("dedupe_key", list.map((id) => `application_ready_for_review:${id}`)),
  ]);
  const seen = new Set(((existing.data ?? []) as any[]).map((r) => r.dedupe_key));
  const docsBy = new Map<string, any[]>();
  for (const d of (docs.data ?? []) as any[]) (docsBy.get(d.driver_id) ?? docsBy.set(d.driver_id, []).get(d.driver_id)!).push(d);
  const { enqueueFleetEvent } = await import("@/lib/fleet-webhook.server");
  const { toE164 } = await import("@/lib/sms.server");
  const queued: string[] = [];
  for (const app of (apps.data ?? []) as any[]) {
    const key = `application_ready_for_review:${app.id}`;
    if (seen.has(key) || app.primary_application_id) continue;
    const d = docsBy.get(app.id) ?? [];
    if (!readyForReview(app, d)) continue;
    const id = await enqueueFleetEvent(admin, {
      event_type: "application_ready_for_review",
      dedupe_key: key,
      application_id: app.id,
      payload: {
        event: "application_ready_for_review",
        lead_id: app.id,
        name: app.full_name ?? null,
        phone: toE164(app.phone),
        email: app.email ?? null,
        contacts: await fleetContactsFor(admin, app.id, app),
        stage: app.status,
        applied_at: app.created_at ?? null,
        ready_at: now.toISOString(),
        next: "POST /api/public/fleet/applicants {action:get, lead_id} for the review packet, then /api/public/fleet/applicant-decision.",
        admin_url: adminUrlFor(app.id),
      },
    });
    if (id) queued.push(id);
  }
  return queued;
}
