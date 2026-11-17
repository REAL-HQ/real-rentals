/**
 * License auto-read (Dolmar, t352u).
 *
 * When an applicant's license photo (documents.category = license_front) is
 * uploaded, the app reads the date of birth, license expiry, license number
 * and issuing state off the photo and fills them in on the application, so
 * FLEET's age and expiry rules have something to check. It runs from the
 * 5-minute automations cron (a few photos per run) and from the FLEET
 * endpoint POST /api/public/fleet/license-facts { action: "auto_read" }
 * for the backfill.
 *
 * Same rules as FLEET's own reading (fleet-license.server.ts):
 *   - every reading is stored in fleet_license_readings and is NEVER a
 *     verification: nothing here writes a review status, verified flag,
 *     screening, insurance or background field;
 *   - a value goes onto the application only when that field is empty, or an
 *     earlier automatic reading put it there. A value staff or the applicant
 *     entered is never overwritten: it is kept and listed under conflicts.
 * Photo Reading's Owner switch and daily limit apply (one slot per photo).
 * Each license photo is read once (a reading row with this document_id stops
 * a second read, including for an unreadable photo).
 */
import { LICENSE_FIELDS, maskNo, norm, validateReading } from "@/lib/fleet-license.server";

type Field = (typeof LICENSE_FIELDS)[number];
export const AUTO_READ_BY = "Photo Reading (automatic)";
export const AUTO_READ_LABEL = "Read automatically from license photo";
const MAX_CANDIDATES = 500;

const SYSTEM = `You read the FRONT of a US driver's license for a car rental company.
Transcribe only what is printed. Never infer, complete or correct a value. If a value is not printed or not legible, use null.
Return strict JSON only, no prose:
{"is_license_front": true|false, "dob": "YYYY-MM-DD"|null, "license_expiration": "YYYY-MM-DD"|null, "license_number": string|null, "license_state": "two-letter US state code"|null, "confidence": number between 0 and 1}
dob is the date of birth (DOB). license_expiration is the expiration date (EXP). license_number is the DL/license number exactly as printed. license_state is the issuing state.
US licenses print dates as MM/DD/YYYY; convert to YYYY-MM-DD.`;

export type AutoReadOutcome = {
  application_id: string;
  document_id: string;
  result: "applied" | "nothing_new" | "unreadable" | "not_a_license" | "conflicts" | "error";
  applied: Field[];
  conflicts: Field[];
  error?: string;
};

export type AutoReadSummary = {
  ok: boolean;
  dryRun: boolean;
  held?: string;
  candidates: number;
  read: number;
  outcomes: AutoReadOutcome[];
};

type Deps = {
  now?: () => Date;
  read?: (req: { bytes: Uint8Array; mime: string; system: string; prompt: string; maxTokens?: number }) => Promise<{ ok: true; text: string } | { ok: false; status?: number; error: string }>;
  reserve?: (sb: any) => Promise<{ ok: true; day: string } | { ok: false; error: string }>;
  release?: (sb: any, day: string) => Promise<void>;
};

/** License photos with no reading yet, on applications still missing at least one license field. */
export async function licenseAutoReadCandidates(admin: any, opts: { applicationIds?: string[] } = {}): Promise<{ app: any; doc: any }[]> {
  let dq = admin
    .from("documents")
    .select("id,driver_id,category,review_status,is_current,storage_bucket,storage_path,mime_type,created_at")
    .eq("category", "license_front")
    .order("created_at", { ascending: false })
    .limit(MAX_CANDIDATES);
  if (opts.applicationIds?.length) dq = dq.in("driver_id", opts.applicationIds);
  const { data: docs, error } = await dq;
  if (error) throw new Error(`documents: ${error.message}`);
  // Newest current, not-rejected license front per applicant.
  const latest = new Map<string, any>();
  for (const d of (docs ?? []) as any[]) {
    if (!d.driver_id || d.is_current === false || d.review_status === "rejected") continue;
    if (!latest.has(d.driver_id)) latest.set(d.driver_id, d);
  }
  if (!latest.size) return [];
  const ids = [...latest.keys()];
  const docIds = [...latest.values()].map((d) => d.id);
  const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / 100) }, (_, i) => xs.slice(i * 100, i * 100 + 100));
  const apps: any[] = [];
  const reads: any[] = [];
  for (const part of chunks(ids)) {
    const { data, error: e } = await admin.from("applications").select("id,status,deleted_at,dob,license_expiration,license_number,license_state").in("id", part);
    if (e) throw new Error(`applications: ${e.message}`);
    apps.push(...(data ?? []));
  }
  for (const part of chunks(docIds)) {
    const { data, error: e } = await admin.from("fleet_license_readings").select("document_id").in("document_id", part);
    if (e) throw new Error(`fleet_license_readings: ${e.message}`);
    reads.push(...(data ?? []));
  }
  const readDocs = new Set(reads.map((r) => r.document_id));
  const out: { app: any; doc: any }[] = [];
  for (const a of apps) {
    if (a.deleted_at) continue;
    const doc = latest.get(a.id);
    if (!doc || readDocs.has(doc.id)) continue;
    const missing = LICENSE_FIELDS.some((f) => a[f] == null || String(a[f]).trim() === "");
    if (!missing) continue;
    out.push({ app: a, doc });
  }
  // Oldest upload first, so the backfill works through the list in order.
  return out.sort((x, y) => String(x.doc.created_at).localeCompare(String(y.doc.created_at)));
}

/** Keep each field that passes FLEET's validation on its own; drop the rest. */
export function cleanReading(parsed: any, now: Date): { values: Partial<Record<Field, string>>; confidence: number | null } {
  const values: Partial<Record<Field, string>> = {};
  for (const f of LICENSE_FIELDS) {
    const v = parsed?.[f];
    if (v == null || v === "") continue;
    const r = validateReading({ [f]: v }, now);
    if (r.ok && r.values[f]) values[f] = r.values[f];
  }
  const c = Number(parsed?.confidence);
  return { values, confidence: Number.isFinite(c) && c >= 0 && c <= 1 ? c : null };
}

/** Which fields go onto the application, which already match, and which differ from what is on file. */
export function planApply(
  app: Record<string, any>,
  values: Partial<Record<Field, string>>,
  autoWrote: Record<Field, Set<string>>,
): { applied: Field[]; unchanged: Field[]; conflicts: { field: Field; on_file: string | null; read: string | null }[]; patch: Record<string, string> } {
  const applied: Field[] = [];
  const unchanged: Field[] = [];
  const conflicts: { field: Field; on_file: string | null; read: string | null }[] = [];
  const patch: Record<string, string> = {};
  for (const f of LICENSE_FIELDS) {
    const read = values[f];
    if (!read) continue;
    const current = norm(f, app[f]);
    if (current === read) unchanged.push(f);
    else if (!current || autoWrote[f].has(current)) { applied.push(f); patch[f] = read; }
    else conflicts.push(f === "license_number" ? { field: f, on_file: maskNo(current), read: maskNo(read) } : { field: f, on_file: current, read });
  }
  return { applied, unchanged, conflicts, patch };
}

async function readOne(admin: any, app: any, doc: any, deps: Deps, now: Date): Promise<AutoReadOutcome | { stop: string }> {
  const base = { application_id: app.id, document_id: doc.id, applied: [] as Field[], conflicts: [] as Field[] };
  const mime = String(doc.mime_type || "image/jpeg").split(";")[0].trim();
  const record = async (row: Record<string, unknown>) =>
    admin.from("fleet_license_readings").insert({
      application_id: app.id, document_id: doc.id, applied_fields: [], conflicts: [], source_label: AUTO_READ_LABEL, read_by: AUTO_READ_BY,
      idempotency_key: `auto-read-${doc.id}`, ...row,
    }).select("id").single();

  if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(mime)) {
    await record({ note: `Not read: file type ${mime}.` });
    return { ...base, result: "unreadable", error: `file type ${mime}` };
  }
  const { data: file } = await admin.storage.from(doc.storage_bucket || "license-uploads").download(doc.storage_path);
  if (!file) {
    await record({ note: "Not read: the photo could not be opened from storage." });
    return { ...base, result: "error", error: "could not download the photo" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const reserve = deps.reserve ?? (async (sb: any) => (await import("@/lib/photo-reading.server")).reservePhotoRead(sb));
  const release = deps.release ?? (async (sb: any, d: string) => (await import("@/lib/photo-reading.server")).releasePhotoRead(sb, d));
  const slot = await reserve(admin);
  if (!slot.ok) return { stop: slot.error };

  const read = deps.read ?? (async (req) => (await import("@/lib/document-reader.server")).readDocument(req));
  const res = await read({ bytes, mime, system: SYSTEM, prompt: "Read this driver's license front. Strict JSON only.", maxTokens: 400 });
  if (!res.ok) {
    // Provider trouble is not the photo's fault: hand the slot back, read it next time.
    await release(admin, slot.day);
    if (res.status == null || res.status === 402 || res.status === 403 || res.status === 429 || res.status >= 500) return { stop: `reader unavailable (${res.status ?? "network"})` };
    await record({ note: `Not read: the reader refused the photo (${res.status}).` });
    return { ...base, result: "unreadable", error: res.error };
  }
  let parsed: any;
  try {
    const { parseModelJson } = await import("@/lib/document-reader.server");
    parsed = parseModelJson(res.text);
  } catch {
    await record({ note: "Could not read the license photo." });
    return { ...base, result: "unreadable" };
  }
  if (parsed?.is_license_front === false) {
    await record({ note: "The photo does not look like the front of a driver's license." });
    return { ...base, result: "not_a_license" };
  }
  const { values, confidence } = cleanReading(parsed, now);
  if (!Object.keys(values).length) {
    await record({ note: "No license details could be read from the photo.", confidence });
    return { ...base, result: "unreadable" };
  }

  // Values earlier automatic or FLEET readings put on the application (those may be corrected).
  const { data: prior } = await admin.from("fleet_license_readings").select("dob,license_expiration,license_number,license_state,applied_fields").eq("application_id", app.id);
  const autoWrote: Record<Field, Set<string>> = { dob: new Set(), license_expiration: new Set(), license_number: new Set(), license_state: new Set() };
  for (const r of (prior ?? []) as any[]) for (const f of LICENSE_FIELDS) if ((r.applied_fields ?? []).includes(f) && r[f]) autoWrote[f].add(norm(f, r[f])!);
  const plan = planApply(app, values, autoWrote);

  const ins = await record({
    dob: values.dob ?? null, license_expiration: values.license_expiration ?? null,
    license_number: values.license_number ?? null, license_state: values.license_state ?? null,
    applied_fields: plan.applied, conflicts: plan.conflicts, confidence,
    note: plan.conflicts.length ? "Differs from what is on file; nothing on file was changed." : null,
  });
  if (ins.error) {
    if (String(ins.error.code) === "23505") return { ...base, result: "nothing_new" }; // another run read it
    return { ...base, result: "error", error: `could not save the reading: ${ins.error.message}` };
  }
  // One guarded update per field: it lands only if the field still holds what
  // was read a moment ago (empty, or an automatic value), so a value staff
  // typed in the meantime is never replaced.
  const landed: Field[] = [];
  for (const f of plan.applied) {
    let q = admin.from("applications").update({ [f]: plan.patch[f] }).eq("id", app.id);
    q = app[f] == null || String(app[f]).trim() === "" ? q.is(f, null) : q.eq(f, app[f]);
    const up = await q.select("id");
    if (!up.error && Array.isArray(up.data) && up.data.length) landed.push(f);
  }
  if (landed.length !== plan.applied.length) {
    await admin.from("fleet_license_readings").update({ applied_fields: landed }).eq("id", ins.data.id);
    plan.applied = landed;
  }
  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(null, {
      action: "application.license_auto_read",
      summary: `${AUTO_READ_LABEL} (not verified): ${plan.applied.join(", ") || "nothing applied"}${plan.conflicts.length ? `; differs from file: ${plan.conflicts.map((c) => c.field).join(", ")}` : ""}`.slice(0, 300),
      entityType: "application",
      entityId: app.id,
      metadata: { document_id: doc.id, applied: plan.applied, unchanged: plan.unchanged, conflict_fields: plan.conflicts.map((c) => c.field), confidence, verified: false },
    } as any);
  } catch { /* the reading is saved */ }
  return {
    ...base,
    result: plan.applied.length ? "applied" : plan.conflicts.length ? "conflicts" : "nothing_new",
    applied: plan.applied,
    conflicts: plan.conflicts.map((c) => c.field),
  };
}

/** Read up to `limit` license photos that have not been read yet. dryRun lists them and reads nothing. */
export async function autoReadLicenses(
  admin: any,
  opts: { limit?: number; dryRun?: boolean; applicationIds?: string[] } = {},
  deps: Deps = {},
): Promise<AutoReadSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const summary: AutoReadSummary = { ok: true, dryRun: opts.dryRun === true, candidates: 0, read: 0, outcomes: [] };
  let list: { app: any; doc: any }[];
  try {
    list = await licenseAutoReadCandidates(admin, { applicationIds: opts.applicationIds });
  } catch (e) {
    return { ...summary, ok: false, held: e instanceof Error ? e.message : "could not list license photos" };
  }
  summary.candidates = list.length;
  if (summary.dryRun) return summary;
  const limit = Math.max(1, Math.min(opts.limit ?? 2, 10));
  for (const { app, doc } of list.slice(0, limit)) {
    try {
      const r = await readOne(admin, app, doc, deps, now);
      if ("stop" in r) { summary.held = r.stop; break; }
      summary.read++;
      summary.outcomes.push(r);
    } catch (e) {
      summary.outcomes.push({ application_id: app.id, document_id: doc.id, result: "error", applied: [], conflicts: [], error: e instanceof Error ? e.message : "failed" });
    }
  }
  return summary;
}
