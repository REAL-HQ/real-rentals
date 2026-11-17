/**
 * FLEET applicant review API.
 *
 *   POST /api/public/fleet/applicants          list | get (the review packet)
 *   POST /api/public/fleet/applicant-decision  approve | needs_staff
 *
 * Bearer FLEET_API_KEY (src/lib/fleet-api.server.ts). Approve runs the exact
 * staff approval code path (approveApplicationCore in applications.functions)
 * and is refused while any hard blocker exists (src/lib/fleet-review.ts).
 * FLEET can never decline: it sends needs_staff with a reason, which puts the
 * applicant in the staff queue (Drivers → Needs Staff). Nothing here writes
 * insurance, screening, background-check or verification fields.
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
import { readRentidSettings } from "@/lib/fleet-rentid.server";

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
  return {
    lead_id: app.id,
    name: app.full_name ?? null,
    status: app.status ?? null,
    admin_url: adminUrlFor(app.id),
    contacts,
    answers: { ...answers, license_number_masked: maskLicense(license_number) },
    documents,
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
export type DecisionDeps = FleetDeps & { approve?: ApproveCore };

/** FLEET has no staff session: on a database with the approval packet installed, approval stays with staff. */
const FLEET_NO_SESSION_RPC = async () => ({
  data: null,
  error: { code: "FLEET_NO_SESSION", message: "The approval check on this database needs a staff sign-in. FLEET cannot approve here; send needs_staff." },
});

/**
 * POST /api/public/fleet/applicant-decision
 *   { "lead_id": "…", "decision": "approve" | "needs_staff", "reason": "…",
 *     "escalation_codes": ["young_driver"], "idempotency_key": "…" }
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
  const raw = String(body.decision ?? "").trim().toLowerCase();
  if (raw === "decline" || raw === "declined" || raw === "reject") {
    return fleetJson(400, { ok: false, error: "FLEET cannot decline. Send decision needs_staff with the reason, and staff will decide." });
  }
  if (raw !== "approve" && raw !== "needs_staff") return fleetJson(400, { ok: false, error: "decision must be approve or needs_staff." });
  const reason = cleanText(body.reason, 1000);
  if (reason.length < 5) return fleetJson(400, { ok: false, error: "reason is required (at least 5 characters)." });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });
  const codes = Array.isArray(body.escalation_codes) ? body.escalation_codes.map((c: unknown) => cleanText(c, 60)).filter(Boolean).slice(0, 30) : [];

  // Idempotent replay.
  if (idem) {
    const prior = await admin.from("fleet_review_decisions").select("id,application_id,decision,created_at").eq("idempotency_key", idem).maybeSingle();
    if (prior.error && !tableMissing(prior.error, "fleet_review_decisions")) return fleetJson(503, { ok: false, error: "Could not read decisions." });
    if (prior.data) {
      if (prior.data.application_id !== leadId) return fleetJson(409, { ok: false, error: "idempotency_key was already used for another applicant." });
      return fleetJson(200, { ok: true, duplicate: true, decision_id: prior.data.id, decision: prior.data.decision === "approved" ? "approve" : "needs_staff", lead_id: leadId });
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

  const record = async (decision: "approved" | "needs_staff") => {
    const row = {
      application_id: leadId,
      decision,
      reason,
      escalation_codes: codes,
      assessment: { hard_blockers: a.hard_blockers, escalations: a.escalations, recommendation: a.recommendation },
      decided_by: FLEET_ACTOR_LABEL,
      idempotency_key: idem,
    };
    return admin.from("fleet_review_decisions").insert(row).select("id").single();
  };

  if (raw === "needs_staff") {
    const open = packet.fleet_review.open_needs_staff;
    if (open) return fleetJson(200, { ok: true, duplicate: true, decision: "needs_staff", decision_id: open.id, lead_id: leadId, reason: open.reason });
    if (String(packet.status) === "approved" || String(packet.status) === "active") {
      return fleetJson(409, { ok: false, error: `Already ${packet.status}; nothing for staff to approve.` });
    }
    const ins = await record("needs_staff");
    if (ins.error || !ins.data) {
      if (tableMissing(ins.error, "fleet_review_decisions")) return fleetJson(503, { ok: false, error: "The staff queue is not set up yet (fleet_review_decisions). Nothing was changed." });
      if (String(ins.error?.code) === "23505") return fleetJson(409, { ok: false, error: "A Needs Staff flag is already open, or the idempotency_key was reused. Retry with action get." });
      return fleetJson(503, { ok: false, error: "Could not save the decision. Nothing was changed." });
    }
    await audit({
      action: "application.fleet_needs_staff",
      summary: `Sent to staff by ${FLEET_ACTOR_LABEL}: ${reason}`.slice(0, 300),
      entityType: "application",
      entityId: leadId,
      metadata: { decided_by: FLEET_ACTOR_LABEL, reason, escalation_codes: codes, decision_id: ins.data.id },
    });
    return fleetJson(201, { ok: true, decision: "needs_staff", decision_id: ins.data.id, lead_id: leadId, admin_url: packet.admin_url });
  }

  // ---- approve
  if (String(packet.status) === "approved") {
    return fleetJson(200, { ok: true, duplicate: true, decision: "approve", lead_id: leadId, already_approved: true });
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
  return fleetJson(201, {
    ok: true,
    decision: "approve",
    lead_id: leadId,
    decision_id: ins.data?.id ?? null,
    approval_email: res.approvalEmail ?? null,
    next: "Approved. Agreements are sent separately; the Reserved step sends login details.",
    admin_url: packet.admin_url,
  });
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
