/**
 * Server side of Background reports (see src/lib/background-report.ts).
 *
 *   saveBackgroundReport   the one writer of public.background_reports and
 *                          background_report_documents (staff form + FLEET)
 *   listBackgroundReports  a driver's entries, newest first, with short-lived file links
 *   handleFleetBackgroundReport  POST /api/public/fleet/background-report
 *
 * Never a decision: nothing here writes applications.background_check_status,
 * mvr_status, driver_screenings, license or insurance verification,
 * review_status or any approval. Files are team only and saved "uploaded"
 * (not reviewed). Every write is in the audit log. Needs
 * supabase/migrations/20261121193000_background_reports.sql (NOT applied);
 * until then reads say "not installed" and writes refuse.
 */
import {
  BACKGROUND_PROVIDERS,
  BACKGROUND_REPORT_TYPES,
  DEFAULT_REPORT_TYPE,
  MAX_CASES,
  MAX_FILES_PER_REPORT,
  cleanCases,
  cleanReference,
  dedupeCases,
  hasResult,
  matchApplicantByName,
  normalizeCriminalResult,
  normalizeIdentityResult,
  normalizeLicenseStatus,
  normalizeOrderId,
  normalizeState,
  orderKey,
  parseReportRef,
  type BackgroundProvider,
  type BackgroundReport,
  type BackgroundReportFile,
  type BackgroundReportType,
  type BackgroundReportWithFiles,
  type CriminalCase,
  type CriminalResult,
  type IdentityResult,
  type LicenseStatus,
} from "@/lib/background-report";
import { cleanText, fleetAdmin, fleetAudit, fleetJson, fleetRequestBody, idempotencyKey, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { FLEET_ACTOR_LABEL } from "@/lib/fleet-review";
export type { BackgroundReportWithFiles };

type Admin = any;
export const BACKGROUND_REPORTS_TABLE = "background_reports";
export const BACKGROUND_REPORT_DOCUMENTS_TABLE = "background_report_documents";
export const BACKGROUND_REPORT_AUDIT_ACTION = "screening.background_report_recorded";
export const BACKGROUND_REPORT_IMPORTS_KEY = "background_report_imports";
export const BACKGROUND_NOT_INSTALLED = "Background Reports are not installed yet (migration 20261121193000_background_reports.sql). Nothing was saved.";
export const MAX_FILES_TOTAL = 30;

export class BackgroundReportError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

export function isMissingTable(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (/background_report/.test(msg) && /does not exist|could not find|schema cache/i.test(msg));
}

export type SaveBackgroundReportInput = {
  applicationId: string;
  /** Update this entry (staff "Add Files" / edit). Must belong to the driver. */
  reportId?: string | null;
  provider: BackgroundProvider;
  providerName?: string | null;
  reportType?: BackgroundReportType | null;
  /** Order / reference number. RentID: INV-… or the portal order. */
  reference?: string | null;
  /** RentID report page link or its req_… id. */
  reportRef?: string | null;
  renterName?: string | null;
  products?: string[] | null;
  orderedAt?: string | null;
  checkedAt?: string | null;
  licenseStatus?: LicenseStatus | null;
  licenseState?: string | null;
  criminalRecord?: CriminalResult | null;
  criminalCaseCount?: number | null;
  criminalCases?: CriminalCase[] | null;
  identityResult?: IdentityResult | null;
  /** Files already saved as documents (category screening) on this driver. */
  documentIds?: string[] | null;
  note?: string | null;
  idempotencyKey?: string | null;
  source: "staff" | "fleet";
  recordedBy?: string | null;
  recordedByLabel: string;
};

type Audit = (e: { action: string; summary: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;

const COLS = "id,application_id,provider,provider_name,report_type,reference,order_key,report_ref,status,renter_name,products,ordered_at,checked_at,license_status,license_state,criminal_record,criminal_case_count,criminal_cases,identity_result,source,idempotency_key,recorded_by_label,note,created_at,updated_at";

function tableError(err: any, fallback: string): BackgroundReportError {
  if (isMissingTable(err)) return new BackgroundReportError(503, BACKGROUND_NOT_INSTALLED, "not_installed");
  return new BackgroundReportError(503, fallback);
}

/** Insert or update one entry and link its files. */
export async function saveBackgroundReport(admin: Admin, input: SaveBackgroundReportInput, audit: Audit, now: Date = new Date()): Promise<{ report: BackgroundReport; created: boolean; addedDocumentIds: string[] }> {
  if (!(BACKGROUND_PROVIDERS as readonly string[]).includes(input.provider)) throw new BackgroundReportError(400, "Choose The Source.");
  const reportType = input.reportType ?? DEFAULT_REPORT_TYPE[input.provider];
  if (!(BACKGROUND_REPORT_TYPES as readonly string[]).includes(reportType)) throw new BackgroundReportError(400, "Choose The Report Type.");
  const providerName = input.provider === "other" ? (input.providerName ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null : null;
  if (input.provider === "other" && !providerName && !input.reportId) throw new BackgroundReportError(400, "Name The Source For Other.");

  // Reference: RentID orders are validated and keyed; other providers take free text.
  let reference: string | null = null;
  let okey: string | null = null;
  let reportRef: string | null = null;
  if (input.provider === "rentid") {
    const parsedRef = input.reportRef ? parseReportRef(input.reportRef) : null;
    if (input.reportRef && !parsedRef) throw new BackgroundReportError(400, "The Report Link Should Look Like rent-id.io/rentid/req_…_j<order>.");
    if (input.reference) {
      reference = normalizeOrderId(input.reference);
      if (!reference) throw new BackgroundReportError(400, "Enter The Order Number (INV-… Or The 8-Character Order).");
    } else if (parsedRef) reference = parsedRef.order;
    if (reference) okey = orderKey(reference);
    if (parsedRef) {
      if (okey && parsedRef.order !== okey) throw new BackgroundReportError(400, `The Report Link Is For Order ${parsedRef.order}, Not ${reference}.`);
      reportRef = parsedRef.ref;
    }
  } else {
    if (input.reportRef) throw new BackgroundReportError(400, "This Source Does Not Use Report Links.");
    const r = cleanReference(input.reference);
    if (r === undefined) throw new BackgroundReportError(400, "Reference Must Be 60 Characters Or Fewer.");
    reference = r;
  }

  const appRes = await admin.from("applications").select("id,full_name,deleted_at").eq("id", input.applicationId).maybeSingle();
  if (appRes.error) throw new BackgroundReportError(503, "Could not read the driver. Nothing was saved.");
  if (!appRes.data) throw new BackgroundReportError(404, "Driver not found.");
  if (appRes.data.deleted_at) throw new BackgroundReportError(409, "This application was deleted.");

  const docIds = [...new Set((input.documentIds ?? []).filter(Boolean))];
  if (docIds.length > MAX_FILES_PER_REPORT) throw new BackgroundReportError(400, `Up To ${MAX_FILES_PER_REPORT} Files At A Time.`);
  if (docIds.length) {
    const docs = await admin.from("documents").select("id,driver_id,category").in("id", docIds);
    if (docs.error) throw new BackgroundReportError(503, "Could not read the files. Nothing was saved.");
    const found = new Map(((docs.data ?? []) as any[]).map((d) => [d.id, d]));
    for (const id of docIds) {
      const d = found.get(id);
      if (!d || d.driver_id !== input.applicationId) throw new BackgroundReportError(400, "A File Is Not On This Driver's Profile.");
      if (d.category !== "screening") throw new BackgroundReportError(400, "Background Files Must Be Filed Under Screening.");
    }
  }

  // Which entry: an explicit id, the RentID order, or an idempotency key.
  let prev: any = null;
  if (input.reportId) {
    const r = await admin.from(BACKGROUND_REPORTS_TABLE).select(COLS).eq("id", input.reportId).maybeSingle();
    if (r.error) throw tableError(r.error, "Could not read the background report. Nothing was saved.");
    if (!r.data || r.data.application_id !== input.applicationId) throw new BackgroundReportError(404, "Background report not found on this driver.");
    if (r.data.provider !== input.provider) throw new BackgroundReportError(400, "The Source Of An Existing Report Can't Change.");
    prev = r.data;
    if (prev.order_key && okey && prev.order_key !== okey) throw new BackgroundReportError(400, `This Report Is Order ${prev.reference}.`);
  }
  if (okey) {
    const r = await admin.from(BACKGROUND_REPORTS_TABLE).select(COLS).eq("provider", "rentid").eq("order_key", okey).limit(5);
    if (r.error) throw tableError(r.error, "Could not read background reports. Nothing was saved.");
    const rows = (r.data ?? []) as any[];
    if (rows.some((x) => x.application_id !== input.applicationId)) throw new BackgroundReportError(409, `Order ${reference} is already filed on another driver. Check the order number; staff can move it.`, "order_on_other_driver");
    const same = rows.find((x) => x.application_id === input.applicationId);
    if (same && prev && same.id !== prev.id) throw new BackgroundReportError(409, `Order ${reference} is already its own report on this driver.`, "order_on_other_report");
    prev = prev ?? same ?? null;
  }
  if (!prev && input.idempotencyKey) {
    const r = await admin.from(BACKGROUND_REPORTS_TABLE).select(COLS).eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (r.error) throw tableError(r.error, "Could not read background reports. Nothing was saved.");
    if (r.data && r.data.application_id !== input.applicationId) throw new BackgroundReportError(409, "idempotency_key was already used for another driver.", "idempotency_conflict");
    prev = r.data ?? null;
  }

  let prevDocIds: string[] = [];
  if (prev) {
    const l = await admin.from(BACKGROUND_REPORT_DOCUMENTS_TABLE).select("document_id").eq("report_id", prev.id);
    if (l.error) throw tableError(l.error, "Could not read the report's files. Nothing was saved.");
    prevDocIds = ((l.data ?? []) as any[]).map((x) => x.document_id);
  }
  const newDocIds = docIds.filter((id) => !prevDocIds.includes(id));
  if (prevDocIds.length + newDocIds.length > MAX_FILES_TOTAL) throw new BackgroundReportError(400, `A Report Holds Up To ${MAX_FILES_TOTAL} Files.`);

  const pick = <T,>(next: T | null | undefined, old: T | null | undefined): T | null => (next !== undefined && next !== null ? next : (old ?? null));
  // Providers (RentID especially) list one case several times; keep one of each.
  let cases: CriminalCase[] = dedupeCases(input.criminalCases && input.criminalCases.length ? input.criminalCases.slice(0, MAX_CASES) : (cleanCases(prev?.criminal_cases) ?? []));
  const criminal = pick(input.criminalRecord, prev?.criminal_record);
  let count = pick(input.criminalCaseCount, prev?.criminal_case_count);
  if (criminal === "not_detected") {
    if (count != null && count > 0) throw new BackgroundReportError(400, "Criminal Record Says Not Detected But Has Cases. Fix One Of Them.");
    if (cases.length) throw new BackgroundReportError(400, "Criminal Record Says Not Detected But Cases Are Listed. Fix One Of Them.");
    count = 0;
    cases = [];
  }
  if (cases.length && (count == null || count < cases.length)) count = cases.length;
  if (count != null && (!Number.isInteger(count) || count < 0 || count > 999)) throw new BackgroundReportError(400, "Case Count Must Be 0–999.");

  const keepInv = prev?.reference && String(prev.reference).startsWith("INV-") && reference && !reference.startsWith("INV-");
  const merged = {
    application_id: input.applicationId,
    provider: input.provider,
    provider_name: pick(providerName, prev?.provider_name),
    report_type: input.reportType ? reportType : (prev?.report_type ?? reportType),
    reference: keepInv ? prev.reference : pick(reference, prev?.reference),
    order_key: pick(okey, prev?.order_key),
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
    note: pick(input.note?.trim() || null, prev?.note),
    source: input.source,
    idempotency_key: prev?.idempotency_key ?? input.idempotencyKey ?? null,
    recorded_by: input.recordedBy ?? null,
    recorded_by_label: input.recordedByLabel.slice(0, 120),
    updated_at: now.toISOString(),
  };
  const allDocIds = [...prevDocIds, ...newDocIds];
  const status = hasResult({ ...merged, document_ids: allDocIds }) ? "reported" : "ordered";
  if (status === "reported" && !merged.checked_at && (input.licenseStatus || input.criminalRecord || input.identityResult || newDocIds.length)) merged.checked_at = now.toISOString();

  let saved: any;
  if (prev) {
    const up = await admin.from(BACKGROUND_REPORTS_TABLE).update({ ...merged, status }).eq("id", prev.id).select(COLS).single();
    if (up.error) throw new BackgroundReportError(503, "Could not save the background report. Nothing was changed.");
    saved = up.data;
  } else {
    const ins = await admin.from(BACKGROUND_REPORTS_TABLE).insert({ ...merged, status }).select(COLS).single();
    if (ins.error) throw tableError(ins.error, "Could not save the background report. Nothing was saved.");
    saved = ins.data;
  }
  for (const documentId of newDocIds) {
    const link = await admin.from(BACKGROUND_REPORT_DOCUMENTS_TABLE).insert({ report_id: saved.id, document_id: documentId, added_at: now.toISOString() });
    if (link.error && String(link.error.code) !== "23505") throw new BackgroundReportError(503, "The report was saved but a file could not be linked. Try adding the file again.");
  }

  await audit({
    action: BACKGROUND_REPORT_AUDIT_ACTION,
    summary: `Background report (${merged.provider}${merged.reference ? ` ${merged.reference}` : ""}) ${prev ? "updated" : "filed"} by ${merged.recorded_by_label}: ${status === "ordered" ? "ordered, no result yet" : `license ${merged.license_status ?? "not recorded"}, criminal record ${merged.criminal_record ?? "not recorded"}${merged.criminal_case_count != null ? ` (${merged.criminal_case_count} cases)` : ""}`}${newDocIds.length ? `, ${newDocIds.length} file(s) added` : ""}. Not a decision.`.slice(0, 300),
    entityType: "application",
    entityId: input.applicationId,
    metadata: {
      report_id: saved?.id ?? null, provider: merged.provider, provider_name: merged.provider_name, report_type: merged.report_type,
      reference: merged.reference, report_ref: merged.report_ref, status, source: input.source, recorded_by: merged.recorded_by_label,
      license_status: merged.license_status, license_state: merged.license_state, criminal_record: merged.criminal_record,
      criminal_case_count: merged.criminal_case_count, cases_listed: merged.criminal_cases.length, identity_result: merged.identity_result,
      documents_added: newDocIds, documents_total: allDocIds.length, verified: false, decision: null,
    },
  });
  return { report: toReport(saved, allDocIds), created: !prev, addedDocumentIds: newDocIds };
}

function toReport(r: any, documentIds: string[]): BackgroundReport {
  return {
    id: r.id, application_id: r.application_id, provider: r.provider, provider_name: r.provider_name ?? null,
    report_type: r.report_type, reference: r.reference ?? null, report_ref: r.report_ref ?? null, status: r.status,
    renter_name: r.renter_name ?? null, products: Array.isArray(r.products) ? r.products : [],
    ordered_at: r.ordered_at ?? null, checked_at: r.checked_at ?? null,
    license_status: r.license_status ?? null, license_state: r.license_state ?? null,
    criminal_record: r.criminal_record ?? null, criminal_case_count: r.criminal_case_count ?? null,
    criminal_cases: cleanCases(r.criminal_cases) ?? [], identity_result: r.identity_result ?? null,
    document_ids: documentIds, source: r.source, recorded_by_label: r.recorded_by_label ?? null,
    note: r.note ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listBackgroundReports(admin: Admin, applicationId: string): Promise<{ installed: boolean; reports: BackgroundReportWithFiles[] }> {
  const res = await admin.from(BACKGROUND_REPORTS_TABLE).select(COLS).eq("application_id", applicationId).order("created_at", { ascending: false }).limit(50);
  if (res.error) {
    if (isMissingTable(res.error)) return { installed: false, reports: [] };
    throw new Error("Could not read background reports.");
  }
  const rows = (res.data ?? []) as any[];
  const byReport = new Map<string, string[]>();
  if (rows.length) {
    const l = await admin.from(BACKGROUND_REPORT_DOCUMENTS_TABLE).select("report_id,document_id,added_at").in("report_id", rows.map((r) => r.id)).order("added_at", { ascending: true });
    if (l.error) {
      if (isMissingTable(l.error)) return { installed: false, reports: [] };
      throw new Error("Could not read background report files.");
    }
    for (const x of (l.data ?? []) as any[]) byReport.set(x.report_id, [...(byReport.get(x.report_id) ?? []), x.document_id]);
  }
  const docIds = [...new Set([...byReport.values()].flat())];
  const docs = new Map<string, any>();
  if (docIds.length) {
    const d = await admin.from("documents").select("id,file_name,mime_type,storage_bucket,storage_path,driver_id").in("id", docIds);
    for (const row of d.data ?? []) if (row.driver_id === applicationId) docs.set(row.id, row);
  }
  const out: BackgroundReportWithFiles[] = [];
  for (const r of rows) {
    const ids = (byReport.get(r.id) ?? []).filter((id) => docs.has(id));
    const files: BackgroundReportFile[] = [];
    for (const id of ids) {
      const doc = docs.get(id);
      let url: string | null = null;
      if (doc?.storage_bucket && doc?.storage_path) {
        try {
          const s = await admin.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 600);
          url = s?.data?.signedUrl ?? null;
        } catch { url = null; }
      }
      files.push({ document_id: id, name: doc.file_name ?? null, url, mime: doc.mime_type ?? null });
    }
    out.push({ ...toReport(r, ids), files });
  }
  return { installed: true, reports: out };
}

/* ------------------------------------------------------------------ */
/* FLEET: POST /api/public/fleet/background-report                     */
/* ------------------------------------------------------------------ */

type FileResult = { ok: true; documentId: string } | { ok: false; status: number; error: string };

export type BackgroundFleetDeps = FleetDeps & {
  gate?: (admin: Admin, key: string) => Promise<"send" | "off" | "held">;
  /** Files one report file; defaults to the FLEET document upload path (category screening). */
  fileDocument?: (args: { leadId: string; label: string; fileName: unknown; contentBase64: unknown }) => Promise<FileResult>;
};

async function defaultGate(admin: Admin, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

/** Same storage, content dedupe, switch and save step as /api/public/fleet/driver-document (category screening). */
function defaultFileDocument(deps: BackgroundFleetDeps): NonNullable<BackgroundFleetDeps["fileDocument"]> {
  return async ({ leadId, label, fileName, contentBase64 }) => {
    const { fileFleetDriverDocument } = await import("@/lib/fleet-document.server");
    const res = await fileFleetDriverDocument({ lead_id: leadId, category: "screening", file_name: fileName, content_base64: contentBase64, label }, deps);
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.document_id) return { ok: true, documentId: String(j.document_id) };
    return { ok: false, status: res.status, error: String(j?.error ?? "A report file could not be filed.") };
  };
}

export async function handleFleetBackgroundReport(request: Request, deps: BackgroundFleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const audit = fleetAudit(deps);
  const now = (deps.now ?? (() => new Date()))();

  const gate = await (deps.gate ?? defaultGate)(admin, BACKGROUND_REPORT_IMPORTS_KEY).catch(() => "held" as const);
  if (gate === "off") return fleetJson(409, { ok: false, error: "The Background Reports (FLEET) switch is Off (Back Office → Automations). Nothing was saved.", reason: "switched_off" });
  if (gate !== "send") return fleetJson(503, { ok: false, error: "Automation switches could not be read; try again later. Nothing was saved.", reason: "controls_unreadable" });

  const provider = String(body.provider ?? "rentid").trim().toLowerCase() as BackgroundProvider;
  if (!(BACKGROUND_PROVIDERS as readonly string[]).includes(provider)) return fleetJson(400, { ok: false, error: `provider must be one of: ${BACKGROUND_PROVIDERS.join(", ")}.` });
  const reportType = body.report_type == null || body.report_type === "" ? null : (String(body.report_type) as BackgroundReportType);
  if (reportType && !(BACKGROUND_REPORT_TYPES as readonly string[]).includes(reportType)) return fleetJson(400, { ok: false, error: `report_type must be one of: ${BACKGROUND_REPORT_TYPES.join(", ")}.` });
  const idem = idempotencyKey(body.idempotency_key);
  if (idem === "invalid") return fleetJson(400, { ok: false, error: "idempotency_key must be 1-120 characters." });

  let reference: string | null = null;
  let reportRef: string | null = null;
  const refIn = body.report_url ?? body.report_ref ?? null;
  const rawRef = body.reference ?? body.order_id ?? null;
  if (provider === "rentid") {
    const ref = refIn == null || refIn === "" ? null : parseReportRef(refIn);
    if (refIn != null && refIn !== "" && !ref) return fleetJson(400, { ok: false, error: "report_url must be a rent-id.io/rentid/req_…_j<order> link." });
    reference = rawRef == null || rawRef === "" ? ref?.order ?? null : normalizeOrderId(rawRef);
    if (!reference) return fleetJson(400, { ok: false, error: "For provider rentid send order_id (INV-… or the 8-character portal order) or report_url." });
    reportRef = ref?.ref ?? null;
  } else {
    if (refIn != null && refIn !== "") return fleetJson(400, { ok: false, error: "report_url is only for provider rentid." });
    const r = cleanReference(rawRef);
    if (r === undefined) return fleetJson(400, { ok: false, error: "reference must be 60 characters or fewer." });
    reference = r;
  }
  const providerName = body.provider_name == null ? null : cleanText(body.provider_name, 80) || null;
  if (provider === "other" && !providerName) return fleetJson(400, { ok: false, error: "provider_name is required for provider other." });

  // Who: lead_id, or the renter name matched to exactly one applicant.
  let leadId = body.lead_id == null || body.lead_id === "" ? "" : String(body.lead_id);
  let matchedBy: "lead_id" | "renter_name" = "lead_id";
  if (leadId && !UUID_RE.test(leadId)) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
  const renterName = body.renter_name == null ? null : cleanText(body.renter_name, 120) || null;
  if (!leadId) {
    if (!renterName) return fleetJson(400, { ok: false, error: "Send lead_id, or renter_name exactly as on the report or receipt." });
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
  if (lic === undefined) return fleetJson(400, { ok: false, error: "license_status is not an answer this endpoint knows." });
  const crim = normalizeCriminalResult(body.criminal_record);
  if (crim === undefined) return fleetJson(400, { ok: false, error: "criminal_record is not an answer this endpoint knows." });
  const idr = normalizeIdentityResult(body.identity_result);
  if (idr === undefined) return fleetJson(400, { ok: false, error: "identity_result is not an answer this endpoint knows." });
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

  // Files: files[] ({file_name, content_base64}) and/or the single content_base64.
  const incoming: { fileName: unknown; contentBase64: unknown }[] = [];
  if (body.files != null) {
    if (!Array.isArray(body.files)) return fleetJson(400, { ok: false, error: "files must be a list of {file_name, content_base64}." });
    for (const f of body.files) incoming.push({ fileName: f?.file_name, contentBase64: f?.content_base64 });
  }
  if (body.content_base64 != null && body.content_base64 !== "") incoming.push({ fileName: body.file_name, contentBase64: body.content_base64 });
  if (incoming.length > MAX_FILES_PER_REPORT) return fleetJson(400, { ok: false, error: `Up to ${MAX_FILES_PER_REPORT} files per call.` });
  const label = `Background Report${reference ? ` ${reference}` : ""}`.slice(0, 140);
  const documentIds: string[] = [];
  for (const [i, f] of incoming.entries()) {
    const filed = await (deps.fileDocument ?? defaultFileDocument(deps))({ leadId, label, fileName: f.fileName ?? `background-report-${i + 1}`, contentBase64: f.contentBase64 });
    if (!filed.ok) {
      return fleetJson(filed.status >= 400 ? filed.status : 503, {
        ok: false, error: `File ${i + 1}: ${filed.error} The background report was not saved${documentIds.length ? `; ${documentIds.length} earlier file(s) are under Documents → Screening and a retry will not duplicate them` : ""}.`, reason: "file_not_saved", filed_document_ids: documentIds,
      });
    }
    documentIds.push(filed.documentId);
  }

  try {
    const { report, created, addedDocumentIds } = await saveBackgroundReport(admin, {
      applicationId: leadId, provider, providerName, reportType, reference, reportRef, renterName, products, orderedAt, checkedAt,
      licenseStatus: lic, licenseState: state, criminalRecord: crim, criminalCaseCount: count, criminalCases: cases,
      identityResult: idr, documentIds, note: body.note == null ? null : cleanText(body.note, 500) || null,
      idempotencyKey: idem, source: "fleet", recordedBy: null, recordedByLabel: FLEET_ACTOR_LABEL,
    }, audit, now);
    return fleetJson(created ? 201 : 200, {
      ok: true, lead_id: leadId, matched_by: matchedBy, report_id: report.id, provider: report.provider, report_type: report.report_type,
      reference: report.reference, status: report.status, document_ids: report.document_ids, documents_added: addedDocumentIds,
      criminal_case_count: report.criminal_case_count, cases_listed: report.criminal_cases.length, verified: false,
      next: report.status === "ordered"
        ? "Saved as Ordered (receipt only). Post the result and the report files when the provider has them."
        : "Saved on the driver's Screening tab under Background Reports. This is a record, not a decision: approval, background check and license status stay with staff.",
    });
  } catch (e) {
    if (e instanceof BackgroundReportError) return fleetJson(e.status, { ok: false, error: e.message, ...(e.reason ? { reason: e.reason } : {}) });
    return fleetJson(503, { ok: false, error: "Could not save the background report. Nothing was saved." });
  }
}
