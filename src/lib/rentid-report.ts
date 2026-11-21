/**
 * RentID screening reports on the driver profile (Dolmar, t582u: "start to
 * pull RentID reports into the system"). Pure and browser-safe: shared by the
 * staff Attach RentID Report form, the FLEET endpoint and the tests.
 *
 * What RentID gives us today (checked Nov 21, 2026):
 *   - No public API docs, no self-serve key and no webhooks. The advertised
 *     Enterprise "Driver Verifications API" is sales-only.
 *   - A receipt email to team@ from noreply@verify.rentid.io per order:
 *     "Your receipt from Rentid, Inc. Order #INV-XXXXXXXX", with the renter's
 *     name, the products bought and the invoice PDF. NO result.
 *   - The result (license status, criminal record check and its cases) lives
 *     only in the RentID portal at rent-id.io/rentid (team@ login, emailed
 *     code), one page per order: rent-id.io/rentid/req_<id>_j<order lowercase>.
 *     Each criminal case shows case number, internal id, charges, degree,
 *     offense/file dates, disposition and court/county (no name or DOB), and
 *     the same case often appears twice from two sources (dedupeCases).
 *     A PDF certificate can be downloaded there. app.rentid.io is a separate,
 *     empty business account.
 *
 * So a report reaches the profile two ways:
 *   1. Staff: Screening tab → Attach RentID Report (screenshot or PDF of the
 *      portal result, the order number, the summary; paste the portal text to
 *      fill it in).
 *   2. FLEET: POST /api/public/fleet/rentid-report (receipt as soon as it
 *      arrives = "Ordered"; result + file later = "Reported"). Off until the
 *      Owner turns on "RentID Reports (FLEET)" in Automations.
 *
 * A report is a record, never a decision: nothing here writes
 * background_check_status, mvr_status, insurance or any verified/approved
 * field. Staff still decide.
 */

export const RENTID_LICENSE_STATUSES = [
  "active",
  "suspended",
  "revoked",
  "expired",
  "inactive",
  "invalid",
  "provisional",
  "restricted",
  "unavailable",
] as const;
export type RentidLicenseStatus = (typeof RENTID_LICENSE_STATUSES)[number];

export const RENTID_CRIMINAL_RESULTS = ["not_detected", "detected", "unavailable"] as const;
export type RentidCriminalResult = (typeof RENTID_CRIMINAL_RESULTS)[number];

export const RENTID_IDENTITY_RESULTS = ["approved", "failed", "pending", "unavailable"] as const;
export type RentidIdentityResult = (typeof RENTID_IDENTITY_RESULTS)[number];

export const RENTID_REPORT_STATUSES = ["ordered", "reported"] as const;
export type RentidReportStatus = (typeof RENTID_REPORT_STATUSES)[number];

export const RENTID_MAX_CASES = 200;

export type RentidCase = {
  case_number: string | null;
  /** Other numbers for the same case from another source (AOC vs Clerk format). */
  alt_case_numbers?: string[];
  internal_id?: string | null;
  /** Offense date. */
  date: string | null;
  file_date?: string | null;
  offense: string | null;
  level: string | null;
  disposition: string | null;
  jurisdiction: string | null;
};

export type RentidReport = {
  id: string;
  application_id: string;
  order_id: string;
  /** The portal report page id, e.g. req_1793719376790_jn4khlc48 (rent-id.io/rentid/<ref>). */
  report_ref: string | null;
  status: RentidReportStatus;
  renter_name: string | null;
  products: string[];
  ordered_at: string | null;
  checked_at: string | null;
  license_status: RentidLicenseStatus | null;
  license_state: string | null;
  criminal_record: RentidCriminalResult | null;
  criminal_case_count: number | null;
  criminal_cases: RentidCase[];
  identity_result: RentidIdentityResult | null;
  document_id: string | null;
  source: "staff" | "fleet";
  recorded_by_label: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const key = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[\s-]+/g, "_");

/** RentID order numbers: INV-2FFV7P9C on receipts, or the bare 8-character portal order (N4KHLC48). */
export const RENTID_ORDER_INPUT_RE = /^(?:INV-)?[A-Z0-9]{6,16}$/;

/** Upper-case, trimmed order number as typed, or null when it is not one. */
export function normalizeOrderId(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase().replace(/^#/, "").replace(/\s+/g, "");
  return RENTID_ORDER_INPUT_RE.test(s) ? s : null;
}

/** The order without the receipt's INV- prefix, so INV-N4KHLC48 and N4KHLC48 are one order. */
export function orderKey(orderId: string): string {
  return orderId.toUpperCase().replace(/^INV-/, "");
}

const LICENSE_ALIASES: Record<string, RentidLicenseStatus> = {
  active: "active", valid: "active",
  suspended: "suspended", suspension: "suspended",
  revoked: "revoked",
  expired: "expired",
  inactive: "inactive",
  invalid: "invalid", cancelled: "invalid", canceled: "invalid", disqualified: "invalid",
  provisional: "provisional", learner: "provisional",
  restricted: "restricted",
  unavailable: "unavailable", not_available: "unavailable", unsupported_state: "unavailable", not_supported: "unavailable",
};
export function normalizeLicenseStatus(v: unknown): RentidLicenseStatus | null | undefined {
  if (v == null || v === "") return null;
  return LICENSE_ALIASES[key(v)];
}

const CRIMINAL_ALIASES: Record<string, RentidCriminalResult> = {
  not_detected: "not_detected", none: "not_detected", clear: "not_detected", no_records: "not_detected", passed: "not_detected",
  detected: "detected", flagged: "detected", caution: "detected", criminal_activity_detected: "detected", caution_criminal_activity_detected: "detected",
  unavailable: "unavailable", not_available: "unavailable",
};
export function normalizeCriminalResult(v: unknown): RentidCriminalResult | null | undefined {
  if (v == null || v === "") return null;
  return CRIMINAL_ALIASES[key(v)];
}

const IDENTITY_ALIASES: Record<string, RentidIdentityResult> = {
  approved: "approved", passed: "approved", verified: "approved",
  failed: "failed", rejected: "failed", action_required: "failed",
  pending: "pending", in_progress: "pending",
  unavailable: "unavailable",
};
export function normalizeIdentityResult(v: unknown): RentidIdentityResult | null | undefined {
  if (v == null || v === "") return null;
  return IDENTITY_ALIASES[key(v)];
}

export function normalizeState(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

const clip = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

/** Validate/clean a case list from FLEET or the form. Returns null when it is not a list. */
export function cleanCases(v: unknown): RentidCase[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out: RentidCase[] = [];
  for (const raw of v.slice(0, RENTID_MAX_CASES)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const alt = Array.isArray(r.alt_case_numbers) ? (r.alt_case_numbers as unknown[]).map((x) => clip(x, 80)).filter((x): x is string => Boolean(x)).slice(0, 5) : [];
    const c: RentidCase = {
      case_number: clip(r.case_number ?? r.caseNumber, 80),
      ...(alt.length ? { alt_case_numbers: alt } : {}),
      internal_id: clip(r.internal_id ?? r.internalId, 80),
      date: clip(r.date ?? r.offense_date ?? r.offenseDate, 40),
      file_date: clip(r.file_date ?? r.fileDate ?? r.filed, 40),
      offense: clip(r.offense ?? r.charges ?? r.charge ?? r.description, 300),
      level: clip(r.level ?? r.degree ?? r.severity, 60),
      disposition: clip(r.disposition ?? r.outcome, 200),
      jurisdiction: clip(r.jurisdiction ?? r.court ?? r.county, 120),
    };
    if (!c.internal_id) delete c.internal_id;
    if (!c.file_date) delete c.file_date;
    if (c.case_number || c.offense || c.date || c.disposition || c.jurisdiction || c.level) out.push(c);
  }
  return out;
}

const COURT_TYPES = "MM|CF|CT|TR|MO|CJ|DP|DR|CA|CC|IN|TI";
/**
 * One key for the same Florida case written two ways. RentID lists a case
 * once per source: the AOC format "10004830MMMO" (yy + sequence + court type)
 * and the Clerk format "032010MM004830XXOXMX" (county + yyyy + type +
 * sequence). Both become "10|MM|4830". Null when the number has neither shape.
 */
export function caseNumberKey(v: string | null | undefined): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return null;
  const clerk = s.match(new RegExp(`^\\d{2}((?:19|20)\\d{2})(${COURT_TYPES})(\\d{3,8})`));
  if (clerk) return `${clerk[1].slice(2)}|${clerk[2]}|${Number(clerk[3])}`;
  const clerk2 = s.match(new RegExp(`^((?:19|20)\\d{2})(${COURT_TYPES})(\\d{3,8})`));
  if (clerk2) return `${clerk2[1].slice(2)}|${clerk2[2]}|${Number(clerk2[3])}`;
  const aoc = s.match(new RegExp(`^(\\d{2})(\\d{4,8})(${COURT_TYPES})`));
  if (aoc) return `${aoc[1]}|${aoc[3]}|${Number(aoc[2])}`;
  return s;
}

const norm = (v: string | null | undefined) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Merge cases RentID lists twice (one per data source). Same case number key,
 * or no usable number but the same offense date and charge. The first copy is
 * kept, empty fields are filled from the second, and the second number is
 * kept under alt_case_numbers. Order is preserved.
 */
export function dedupeCases(cases: RentidCase[]): RentidCase[] {
  const out: RentidCase[] = [];
  const byKey = new Map<string, RentidCase>();
  for (const c of cases) {
    const numKey = caseNumberKey(c.case_number);
    const k = numKey ? `n:${numKey}` : c.date && c.offense ? `d:${norm(c.date)}|${norm(c.offense)}` : null;
    const hit = k ? byKey.get(k) : undefined;
    if (!hit) {
      const copy: RentidCase = { ...c, ...(c.alt_case_numbers ? { alt_case_numbers: [...c.alt_case_numbers] } : {}) };
      out.push(copy);
      if (k) byKey.set(k, copy);
      continue;
    }
    for (const f of ["internal_id", "date", "file_date", "offense", "level", "disposition", "jurisdiction"] as const) {
      if (!hit[f] && c[f]) (hit as any)[f] = c[f];
    }
    const alts = new Set([...(hit.alt_case_numbers ?? []), ...(c.alt_case_numbers ?? [])]);
    if (c.case_number && c.case_number !== hit.case_number) alts.add(c.case_number);
    if (!hit.case_number && c.case_number) { hit.case_number = c.case_number; alts.delete(c.case_number); }
    if (alts.size) hit.alt_case_numbers = [...alts].slice(0, 5);
  }
  return out;
}

/**
 * Staff's "Cases (One Per Line)" box: `Date | Offense | Level | Disposition | County | Case #`.
 * Missing trailing fields are fine; a line with no pipes is the offense.
 */
export function parseCaseLines(text: string): RentidCase[] {
  const out: RentidCase[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.includes("|") ? t.split("|").map((p) => p.trim()) : ["", t];
    const [date, offense, level, disposition, jurisdiction, case_number] = parts;
    const c = cleanCases([{ date, offense, level, disposition, jurisdiction, case_number }]);
    if (c && c[0]) out.push(c[0]);
    if (out.length >= RENTID_MAX_CASES) break;
  }
  return dedupeCases(out);
}

export function formatCaseLines(cases: RentidCase[]): string {
  return cases
    .map((c) => [c.date, c.offense, c.level, c.disposition, c.jurisdiction, c.case_number].map((x) => x ?? "").join(" | ").replace(/(\s\|\s)+$/, ""))
    .join("\n");
}

export type ParsedReportText = {
  order_id: string | null;
  license_status: RentidLicenseStatus | null;
  license_state: string | null;
  criminal_record: RentidCriminalResult | null;
  criminal_case_count: number | null;
  identity_result: RentidIdentityResult | null;
  renter_name: string | null;
  report_ref: string | null;
};

const STATE_NAMES: Record<string, string> = { florida: "FL", georgia: "GA", texas: "TX", "new jersey": "NJ", connecticut: "CT", minnesota: "MN", missouri: "MO", kansas: "KS", nebraska: "NE", idaho: "ID", washington: "WA", "west virginia": "WV", wisconsin: "WI", "rhode island": "RI", "north dakota": "ND" };

/**
 * Pull the summary out of text copied from the RentID portal result page (or a
 * staff note such as "Driver's license status shows Active. Criminal record
 * screening flagged"). Only fills what it can read; never guesses a pass.
 */
export function parseRentidReportText(text: string): ParsedReportText {
  const t = String(text ?? "").replace(/\u00a0/g, " ");
  const out: ParsedReportText = { order_id: null, license_status: null, license_state: null, criminal_record: null, criminal_case_count: null, identity_result: null, renter_name: null, report_ref: null };
  const refHit = t.match(/req_\d{6,20}_j[a-z0-9]{6,16}/i);
  if (refHit) {
    const r = parseReportRef(refHit[0]);
    if (r) { out.report_ref = r.ref; out.order_id = r.order; }
  }

  const order = t.match(/\border\s*(?:#|no\.?|number)?\s*:?\s*((?:INV-)?[A-Z0-9]{6,16})\b/i) ?? t.match(/\b(INV-[A-Z0-9]{6,16})\b/i);
  if (order && !out.order_id) out.order_id = normalizeOrderId(order[1]);

  const lic = t.match(/license\s+(?:status|validity)[^A-Za-z\n]{0,20}(?:shows\s+|is\s+)?(active|valid|suspended|revoked|expired|inactive|invalid|cancell?ed|provisional|restricted|unavailable|not available|approved|failed)/i);
  if (lic) {
    const w = lic[1].toLowerCase();
    out.license_status = w === "approved" ? "active" : w === "failed" ? null : normalizeLicenseStatus(w) ?? null;
  }
  const st = t.match(/DL\s+State\s+Fee\s*\((\w[\w ]*?)\)/i) ?? t.match(/\b(Florida|Georgia|Texas|New Jersey)\s+DMV\b/i);
  if (st) out.license_state = STATE_NAMES[st[1].toLowerCase()] ?? normalizeState(st[1]) ?? null;

  const crimLine = t.match(/criminal\s+record(?:\s+check|\s+screening)?[^\n]{0,80}/i)?.[0] ?? "";
  if (/not\s+detected|no\s+(?:criminal\s+)?records?\s+found|clear\b/i.test(crimLine)) out.criminal_record = "not_detected";
  else if (/detected|flagged|caution/i.test(crimLine)) out.criminal_record = "detected";
  else if (/unavailable|not\s+available/i.test(crimLine)) out.criminal_record = "unavailable";
  const count = crimLine.match(/\((\d{1,3})\s+cases?\)/i) ?? crimLine.match(/(\d{1,3})\s+cases?\b/i);
  if (count) out.criminal_case_count = Number(count[1]);
  else if (out.criminal_record === "not_detected") out.criminal_case_count = 0;

  const idLine = t.match(/identification\s*(?:&|and)\s*biometrics[^\n]{0,40}/i)?.[0] ?? "";
  if (/approved|passed|verified/i.test(idLine)) out.identity_result = "approved";
  else if (/failed|action required/i.test(idLine)) out.identity_result = "failed";

  const renter = t.match(/\b(?:renter|driver)\s*(?:name)?\s*:\s*([A-Za-z][A-Za-z .'-]{1,80})/i);
  if (renter) out.renter_name = renter[1].trim();
  return out;
}

export type ParsedReceipt = { order_id: string; renter_name: string | null; paid_at: string | null; products: string[] };

const PRODUCTS = ["Criminal Record Check", "Driver's License Status", "Motor Vehicle Report", "Identification & Biometrics", "Personal Insurance Validation"];

/**
 * A "Your receipt from Rentid, Inc. Order #INV-…" email body. Receipts carry
 * the order and the renter's name, not the result. Credit purchases
 * (Order #CRD-…) are not screenings and return null.
 */
export function parseRentidReceipt(subject: string, body: string): ParsedReceipt | null {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  if (/Order\s*#\s*:?\s*CRD-/i.test(text) && !/INV-/i.test(text)) return null;
  const m = text.match(/Order\s*#\s*:?\s*(INV-[A-Z0-9]{6,16})/i);
  const orderId = m ? normalizeOrderId(m[1]) : null;
  if (!orderId) return null;
  const renter = body.match(/Renter:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null;
  let paidAt: string | null = null;
  const pd = body.match(/Date Paid:\s*([A-Za-z]+ \d{1,2}, \d{4}) at (\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC\)/i);
  if (pd) {
    let h = Number(pd[2]) % 12;
    if (pd[4].toUpperCase() === "PM") h += 12;
    const d = new Date(`${pd[1]} 00:00:00 UTC`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(h, Number(pd[3]));
      paidAt = d.toISOString();
    }
  }
  const products = PRODUCTS.filter((p) => body.toLowerCase().includes(p.toLowerCase()));
  return { order_id: orderId, renter_name: renter ? renter.slice(0, 120) : null, paid_at: paidAt, products };
}

/** Lower-case letters only, single spaces: "James  Smith Jr." → "james smith jr". */
export function normalizePersonName(v: unknown): string {
  return String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

export type NameCandidate = { id: string; full_name: string | null; deleted_at?: string | null };

/**
 * Match a RentID renter name to exactly one applicant. Exact normalized full
 * name only; two people with the same name is "ambiguous" and goes to staff.
 */
export function matchApplicantByName(name: string, candidates: NameCandidate[]): { kind: "match"; id: string } | { kind: "none" } | { kind: "ambiguous"; count: number } {
  const want = normalizePersonName(name);
  if (!want || !want.includes(" ")) return { kind: "none" };
  const hits = candidates.filter((c) => !c.deleted_at && normalizePersonName(c.full_name) === want);
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length === 1) return { kind: "match", id: ids[0] };
  if (ids.length > 1) return { kind: "ambiguous", count: ids.length };
  return { kind: "none" };
}

const LICENSE_LABELS: Record<RentidLicenseStatus, string> = {
  active: "Active", suspended: "Suspended", revoked: "Revoked", expired: "Expired", inactive: "Inactive",
  invalid: "Invalid", provisional: "Provisional", restricted: "Restricted", unavailable: "Not Available For This State",
};
export const licenseStatusLabel = (s: RentidLicenseStatus | null) => (s ? LICENSE_LABELS[s] : "Not Recorded");

export function criminalRecordLabel(r: RentidCriminalResult | null, count: number | null): string {
  if (r === "detected") return count != null ? `Detected (${count} ${count === 1 ? "Case" : "Cases"})` : "Detected";
  if (r === "not_detected") return "Not Detected";
  if (r === "unavailable") return "Not Available";
  return "Not Recorded";
}

const IDENTITY_LABELS: Record<RentidIdentityResult, string> = { approved: "Approved", failed: "Failed", pending: "Pending", unavailable: "Not Available" };
export const identityResultLabel = (r: RentidIdentityResult | null) => (r ? IDENTITY_LABELS[r] : "Not Recorded");

/** Tone for a pill. A report never turns anything green on its own elsewhere; this is display only. */
export function reportTone(r: Pick<RentidReport, "status" | "license_status" | "criminal_record">): "red" | "yellow" | "green" | "gray" {
  if (r.status === "ordered") return "gray";
  const bad = new Set(["suspended", "revoked", "expired", "inactive", "invalid"]);
  if ((r.license_status && bad.has(r.license_status)) || r.criminal_record === "detected") return "red";
  if (r.license_status === "active" && r.criminal_record === "not_detected") return "green";
  return "yellow";
}

/** Has enough to be "Reported" (a result), rather than just "Ordered" (receipt only). */
export function hasResult(r: { license_status?: unknown; criminal_record?: unknown; identity_result?: unknown; document_id?: unknown }): boolean {
  return Boolean(r.license_status || r.criminal_record || r.identity_result || r.document_id);
}

export type RentidReportWithFile = RentidReport & { file: { name: string | null; url: string | null; mime: string | null } | null };

/** rent-id.io report pages: https://rent-id.io/rentid/req_<digits>_j<order lowercase>. */
export const RENTID_REPORT_REF_RE = /^req_\d{6,20}_j[a-z0-9]{6,16}$/;

/** A report page link or id → { ref, order } (order upper-cased from the link), or null. */
export function parseReportRef(v: unknown): { ref: string; order: string } | null {
  const s = String(v ?? "").trim();
  const m = s.match(/(?:^|\/)(req_\d{6,20}_j([a-z0-9]{6,16}))(?:[/?#]|$)/i);
  if (!m) return null;
  const ref = m[1].toLowerCase();
  if (!RENTID_REPORT_REF_RE.test(ref)) return null;
  return { ref, order: m[2].toUpperCase() };
}

export const reportPageUrl = (ref: string) => `https://rent-id.io/rentid/${ref}`;
