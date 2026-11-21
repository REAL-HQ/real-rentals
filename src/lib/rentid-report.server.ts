/**
 * Server side of RentID reports (see src/lib/rentid-report.ts for the why).
 *
 *   saveRentidReport   the one writer of public.rentid_reports (staff form + FLEET)
 *   listRentidReports  a driver's reports, newest first, with a short-lived file link
 *   handleFleetRentidReport  POST /api/public/fleet/rentid-report
 *
 * Never a decision: nothing here writes applications.background_check_status,
 * mvr_status, driver_screenings, insurance, review_status or any approval. The
 * stored file is team only and saved "uploaded" (not reviewed). Every write is
 * in the audit log. Needs supabase/migrations/20261121193000_rentid_reports.sql
 * (NOT applied); until then reads say "not installed" and writes refuse.
 */
import {
  RENTID_MAX_CASES,
  cleanCases,
  dedupeCases,
  hasResult,
  parseReportRef,
  matchApplicantByName,
  normalizeCriminalResult,
  normalizeIdentityResult,
  normalizeLicenseStatus,
  normalizeOrderId,
  normalizeState,
  orderKey,
  type RentidCase,
  type RentidCriminalResult,
  type RentidIdentityResult,
  type RentidLicenseStatus,
  type RentidReport,
  type RentidReportWithFile,
} from "@/lib/rentid-report";
export type { RentidReportWithFile };

import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";

type Admin = any;
export const RENTID_REPORTS_TABLE = "rentid_reports";
export const RENTID_REPORT_AUDIT_ACTION = "screening.rentid_report_recorded";
export const RENTID_REPORT_IMPORTS_KEY = "rentid_report_imports";
export const RENTID_NOT_INSTALLED = "RentID Reports are not installed yet (migration 20261121193000_rentid_reports.sql). Nothing was saved.";

export class RentidReportError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

export function isMissingTable(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (/rentid_reports/.test(msg) && /does not exist|could not find|schema cache/i.test(msg));
}

export type SaveRentidReportInput = {
  applicationId: string;
  orderId: string;
  /** rent-id.io report page link or its req_… id. */
  reportRef?: string | null;
  renterName?: string | null;
  products?: string[] | null;
  orderedAt?: string | null;
  checkedAt?: string | null;
  licenseStatus?: RentidLicenseStatus | null;
  licenseState?: string | null;
  criminalRecord?: RentidCriminalResult | null;
  criminalCaseCount?: number | null;
  criminalCases?: RentidCase[] | null;
  identityResult?: RentidIdentityResult | null;
  documentId?: string | null;
  note?: string | null;
  source: "staff" | "fleet";
  recordedBy?: string | null;
  recordedByLabel: string;
};

type Audit = (e: { action: string; summary: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;

const COLS = "id,application_id,order_id,order_key,report_ref,status,renter_name,products,ordered_at,checked_at,license_status,license_state,criminal_record,criminal_case_count,criminal_cases,identity_result,document_id,source,recorded_by_label,note,created_at,updated_at";

/** Insert or update one report (one row per driver per RentID order). */
export async function saveRentidReport(admin: Admin, input: SaveRentidReportInput, audit: Audit, now: Date = new Date()): Promise<{ report: RentidReport; created: boolean }> {
  const orderId = normalizeOrderId(input.orderId);
  if (!orderId) throw new RentidReportError(400, "Enter The RentID Order Number (INV-… Or The 8-Character Order).");
  const okey = orderKey(orderId);
  let reportRef: string | null = null;
  if (input.reportRef) {
    const parsedRef = parseReportRef(input.reportRef);
    if (!parsedRef) throw new RentidReportError(400, "The RentID Report Link Should Look Like rent-id.io/rentid/req_…_j<order>.");
    if (parsedRef.order !== okey) throw new RentidReportError(400, `The RentID Report Link Is For Order ${parsedRef.order}, Not ${orderId}.`);
    reportRef = parsedRef.ref;
  }

  const appRes = await admin.from("applications").select("id,full_name,deleted_at").eq("id", input.applicationId).maybeSingle();
  if (appRes.error) throw new RentidReportError(503, "Could not read the driver. Nothing was saved.");
  if (!appRes.data) throw new RentidReportError(404, "Driver not found.");
  if (appRes.data.deleted_at) throw new RentidReportError(409, "This application was deleted.");

  if (input.documentId) {
    const doc = await admin.from("documents").select("id,driver_id,category").eq("id", input.documentId).maybeSingle();
    if (doc.error) throw new RentidReportError(503, "Could not read the report file. Nothing was saved.");
    if (!doc.data || doc.data.driver_id !== input.applicationId) throw new RentidReportError(400, "The report file is not on this driver's profile.");
    if (doc.data.category !== "screening") throw new RentidReportError(400, "The report file must be filed under Screening.");
  }

  const existingRes = await admin.from(RENTID_REPORTS_TABLE).select(COLS).eq("order_key", okey).limit(5);
  if (existingRes.error) {
    if (isMissingTable(existingRes.error)) throw new RentidReportError(503, RENTID_NOT_INSTALLED, "not_installed");
    throw new RentidReportError(503, "Could not read RentID reports. Nothing was saved.");
  }
  const rows = (existingRes.data ?? []) as any[];
  const other = rows.find((r) => r.application_id !== input.applicationId);
  if (other) throw new RentidReportError(409, `RentID order ${orderId} is already filed on another driver. Check the order number; staff can move it.`, "order_on_other_driver");
  const prev = rows.find((r) => r.application_id === input.applicationId) ?? null;

  const pick = <T,>(next: T | null | undefined, old: T | null | undefined): T | null => (next !== undefined && next !== null ? next : (old ?? null));
  // RentID lists many cases twice (one per data source); keep one of each.
  let cases: RentidCase[] = dedupeCases(input.criminalCases && input.criminalCases.length ? input.criminalCases.slice(0, RENTID_MAX_CASES) : (cleanCases(prev?.criminal_cases) ?? []));
  const criminal = pick(input.criminalRecord, prev?.criminal_record);
  let count = pick(input.criminalCaseCount, prev?.criminal_case_count);
  if (criminal === "not_detected") {
    if (count != null && count > 0) throw new RentidReportError(400, "Criminal Record Says Not Detected But Has Cases. Fix One Of Them.");
    if (cases.length) throw new RentidReportError(400, "Criminal Record Says Not Detected But Cases Are Listed. Fix One Of Them.");
    count = 0;
    cases = [];
  }
  if (cases.length && (count == null || count < cases.length)) count = cases.length;
  if (count != null && (!Number.isInteger(count) || count < 0 || count > 999)) throw new RentidReportError(400, "Case Count Must Be 0–999.");

  const merged = {
    application_id: input.applicationId,
    order_id: prev && prev.order_id.startsWith("INV-") && !orderId.startsWith("INV-") ? prev.order_id : orderId,
    order_key: okey,
    report_ref: pick(reportRef, prev?.report_ref),
    renter_name: pick(input.renterName?.trim() || null, prev?.renter_name),
    products: input.products && input.products.length ? input.products.slice(0, 10) : (prev?.products ?? []),
    ordered_at: pick(input.orderedAt, prev?.ordered_at),
    checked_at: pick(input.checkedAt, prev?.checked_at),
    license_status: pick(input.licenseStatus, prev?.license_status),
    license_state: pick(input.licenseState, prev?.license_state),
    criminal_record: criminal,
    criminal_case_count: count,
    criminal_cases: cases,
    identity_result: pick(input.identityResult, prev?.identity_result),
    document_id: pick(input.documentId, prev?.document_id),
    note: pick(input.note?.trim() || null, prev?.note),
    source: input.source,
    recorded_by: input.recordedBy ?? null,
    recorded_by_label: input.recordedByLabel.slice(0, 120),
    updated_at: now.toISOString(),
  };
  const status = hasResult(merged) ? "reported" : "ordered";
  if (status === "reported" && !merged.checked_at && (input.licenseStatus || input.criminalRecord || input.identityResult || input.documentId)) merged.checked_at = now.toISOString();

  let saved: any;
  if (prev) {
    const up = await admin.from(RENTID_REPORTS_TABLE).update({ ...merged, status }).eq("id", prev.id).select(COLS).single();
    if (up.error) throw new RentidReportError(503, "Could not save the RentID report. Nothing was changed.");
    saved = up.data;
  } else {
    const ins = await admin.from(RENTID_REPORTS_TABLE).insert({ ...merged, status }).select(COLS).single();
    if (ins.error) {
      if (isMissingTable(ins.error)) throw new RentidReportError(503, RENTID_NOT_INSTALLED, "not_installed");
      throw new RentidReportError(503, "Could not save the RentID report. Nothing was saved.");
    }
    saved = ins.data;
  }

  await audit({
    action: RENTID_REPORT_AUDIT_ACTION,
    summary: `RentID ${merged.order_id} ${prev ? "updated" : "filed"} by ${merged.recorded_by_label}: ${status === "ordered" ? "ordered, no result yet" : `license ${merged.license_status ?? "not recorded"}, criminal record ${merged.criminal_record ?? "not recorded"}${merged.criminal_case_count != null ? ` (${merged.criminal_case_count} cases)` : ""}`}. Not a decision.`.slice(0, 300),
    entityType: "application",
    entityId: input.applicationId,
    metadata: {
      provider: "rentid", report_id: saved?.id ?? null, order_id: merged.order_id, status, source: input.source, recorded_by: merged.recorded_by_label,
      license_status: merged.license_status, license_state: merged.license_state, criminal_record: merged.criminal_record,
      criminal_case_count: merged.criminal_case_count, cases_listed: merged.criminal_cases.length, report_ref: merged.report_ref, identity_result: merged.identity_result,
      document_id: merged.document_id, verified: false, decision: null,
    },
  });
  return { report: toReport(saved), created: !prev };
}

function toReport(r: any): RentidReport {
  return {
    id: r.id, application_id: r.application_id, order_id: r.order_id, report_ref: r.report_ref ?? null, status: r.status,
    renter_name: r.renter_name ?? null, products: Array.isArray(r.products) ? r.products : [],
    ordered_at: r.ordered_at ?? null, checked_at: r.checked_at ?? null,
    license_status: r.license_status ?? null, license_state: r.license_state ?? null,
    criminal_record: r.criminal_record ?? null, criminal_case_count: r.criminal_case_count ?? null,
    criminal_cases: cleanCases(r.criminal_cases) ?? [], identity_result: r.identity_result ?? null,
    document_id: r.document_id ?? null, source: r.source, recorded_by_label: r.recorded_by_label ?? null,
    note: r.note ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}


export async function listRentidReports(admin: Admin, applicationId: string): Promise<{ installed: boolean; reports: RentidReportWithFile[] }> {
  const res = await admin.from(RENTID_REPORTS_TABLE).select(COLS).eq("application_id", applicationId).order("created_at", { ascending: false }).limit(50);
  if (res.error) {
    if (isMissingTable(res.error)) return { installed: false, reports: [] };
    throw new Error("Could not read RentID reports.");
  }
  const reports = ((res.data ?? []) as any[]).map(toReport);
  const docIds = reports.map((r) => r.document_id).filter(Boolean) as string[];
  const docs = new Map<string, any>();
  if (docIds.length) {
    const d = await admin.from("documents").select("id,file_name,mime_type,storage_bucket,storage_path,driver_id").in("id", docIds);
    for (const row of d.data ?? []) if (row.driver_id === applicationId) docs.set(row.id, row);
  }
  const out: RentidReportWithFile[] = [];
  for (const r of reports) {
    const doc = r.document_id ? docs.get(r.document_id) : null;
    let url: string | null = null;
    if (doc?.storage_bucket && doc?.storage_path) {
      try {
        const s = await admin.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 600);
        url = s?.data?.signedUrl ?? null;
      } catch { url = null; }
    }
    out.push({ ...r, file: doc ? { name: doc.file_name ?? null, url, mime: doc.mime_type ?? null } : null });
  }
  return { installed: true, reports: out };
}

/* ------------------------------------------------------------------ */
/* FLEET: POST /api/public/fleet/rentid-report                         */
/* ------------------------------------------------------------------ */


export type RentidFleetDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  /** Files the report image/PDF; defaults to the FLEET document upload path (category screening). */
  fileDocument?: (args: { leadId: string; orderId: string; fileName: unknown; contentBase64: unknown }) => Promise<{ ok: true; documentId: string } | { ok: false; status: number; error: string }>;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

/** Same storage, dedupe, switch and save step as /api/public/fleet/driver-document (category screening). */
function defaultFileDocument(deps: RentidFleetDeps): NonNullable<RentidFleetDeps["fileDocument"]> {
  return async ({ leadId, orderId, fileName, contentBase64 }) => {
    const { fileFleetDriverDocument } = await import("@/lib/fleet-document.server");
    const res = await fileFleetDriverDocument(
      { lead_id: leadId, category: "screening", file_name: fileName, content_base64: contentBase64, label: `RentID Report ${orderId}`, idempotency_key: `rentid-${orderKey(orderId)}-${leadId}`.slice(0, 120) },
      deps,
    );
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.document_id) return { ok: true, documentId: String(j.document_id) };
    return { ok: false, status: res.status, error: String(j?.error ?? "The report file could not be filed.") };
  };
}

export async function handleFleetRentidReport(request: Request, deps: RentidFleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  const gate = await (deps.gate ?? defaultGate)(admin, RENTID_REPORT_IMPORTS_KEY).catch(() => "held" as const);
  if (gate === "off") return fleetJson(409, { ok: false, error: "The RentID Reports (FLEET) switch is Off (Back Office → Automations). Nothing was saved.", reason: "switched_off" });
  if (gate !== "send") return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });

  const refIn = body.report_url ?? body.report_ref ?? null;
  const ref = refIn == null || refIn === "" ? null : parseReportRef(refIn);
  if (refIn != null && refIn !== "" && !ref) return fleetJson(400, { ok: false, error: "report_url must be a rent-id.io/rentid/req_…_j<order> link." });
  const orderId = normalizeOrderId(body.order_id) ?? (body.order_id == null || body.order_id === "" ? ref?.order ?? null : null);
  if (!orderId) return fleetJson(400, { ok: false, error: "order_id must be the RentID order number (INV-… or the 8-character portal order), or send report_url." });

  // Who: lead_id, or the receipt's renter name matched to exactly one applicant.
  let leadId = body.lead_id == null || body.lead_id === "" ? "" : String(body.lead_id);
  let matchedBy: "lead_id" | "renter_name" = "lead_id";
  if (leadId && !UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const renterName = body.renter_name == null ? null : cleanText(body.renter_name, 120) || null;
  if (!leadId) {
    if (!renterName) return fleetJson(400, { ok: false, error: "Send lead_id, or renter_name exactly as on the RentID receipt." });
    const parts = renterName.split(" ").filter(Boolean);
    const cand = await admin.from("applications").select("id,full_name,deleted_at").ilike("full_name", `%${parts[parts.length - 1].replace(/[%_]/g, "")}%`).limit(200);
    if (cand.error) return fleetJson(503, { ok: false, error: "Could not look up the applicant." });
    const m = matchApplicantByName(renterName, cand.data ?? []);
    if (m.kind === "ambiguous") return fleetJson(409, { ok: false, error: `${m.count} applicants are named ${renterName}. Send lead_id; nothing was saved.`, reason: "ambiguous_name", candidates: m.count });
    if (m.kind === "none") return fleetJson(404, { ok: false, error: `No applicant is named exactly ${renterName}. Send lead_id or hand it to staff; nothing was saved.`, reason: "no_match" });
    leadId = m.id;
    matchedBy = "renter_name";
  }

  const lic = normalizeLicenseStatus(body.license_status);
  if (lic === undefined) return fleetJson(400, { ok: false, error: "license_status is not a RentID answer this endpoint knows." });
  const crim = normalizeCriminalResult(body.criminal_record);
  if (crim === undefined) return fleetJson(400, { ok: false, error: "criminal_record is not a RentID answer this endpoint knows." });
  const idr = normalizeIdentityResult(body.identity_result);
  if (idr === undefined) return fleetJson(400, { ok: false, error: "identity_result is not a RentID answer this endpoint knows." });
  const state = normalizeState(body.license_state);
  if (state === undefined) return fleetJson(400, { ok: false, error: "license_state must be a 2-letter state." });
  const cases = cleanCases(body.criminal_cases);
  if (cases === null) return fleetJson(400, { ok: false, error: "criminal_cases must be a list." });
  let count: number | null = null;
  if (body.criminal_case_count != null && body.criminal_case_count !== "") {
    count = Number(body.criminal_case_count);
    if (!Number.isInteger(count) || count < 0 || count > 999) return fleetJson(400, { ok: false, error: "criminal_case_count must be 0-999." });
  }
  const when = (v: unknown, name: string): string | null | Response => {
    if (v == null || v === "") return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 5 * 60_000) return fleetJson(400, { ok: false, error: `${name} must be a real time, not in the future.` });
    return d.toISOString();
  };
  const checkedAt = when(body.checked_at, "checked_at");
  if (checkedAt instanceof Response) return checkedAt;
  const orderedAt = when(body.ordered_at, "ordered_at");
  if (orderedAt instanceof Response) return orderedAt;
  const products = Array.isArray(body.products) ? body.products.map((p: unknown) => cleanText(p, 60)).filter(Boolean).slice(0, 10) : null;

  let documentId: string | null = null;
  if (body.content_base64 != null && body.content_base64 !== "") {
    const filed = await (deps.fileDocument ?? defaultFileDocument(deps))({ leadId, orderId, fileName: body.file_name ?? `rentid-${orderKey(orderId)}`, contentBase64: body.content_base64 });
    if (!filed.ok) return fleetJson(filed.status >= 400 ? filed.status : 503, { ok: false, error: `${filed.error} The RentID summary was not saved either.`, reason: "file_not_saved" });
    documentId = filed.documentId;
  }

  try {
    const { report, created } = await saveRentidReport(admin, {
      applicationId: leadId, orderId, reportRef: ref?.ref ?? null, renterName, products, orderedAt, checkedAt,
      licenseStatus: lic, licenseState: state, criminalRecord: crim, criminalCaseCount: count, criminalCases: cases,
      identityResult: idr, documentId, note: body.note == null ? null : cleanText(body.note, 500) || null,
      source: "fleet", recordedBy: null, recordedByLabel: FLEET_ACTOR_LABEL,
    }, audit, now);
    return fleetJson(created ? 201 : 200, {
      ok: true, lead_id: leadId, matched_by: matchedBy, report_id: report.id, order_id: report.order_id, status: report.status,
      document_id: report.document_id, criminal_case_count: report.criminal_case_count, cases_listed: report.criminal_cases.length,
      verified: false,
      next: report.status === "ordered"
        ? "Saved as Ordered (receipt only). Post the result and the report file when RentID has it."
        : "Saved on the driver's Screening tab. This is a record, not a decision: approval, background check and license status stay with staff.",
    });
  } catch (e) {
    if (e instanceof RentidReportError) return fleetJson(e.status, { ok: false, error: e.message, ...(e.reason ? { reason: e.reason } : {}) });
    return fleetJson(503, { ok: false, error: "Could not save the RentID report. Nothing was saved." });
  }
}
