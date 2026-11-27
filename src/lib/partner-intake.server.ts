/**
 * Partner intake, server side. Shared by the public /partners form and the
 * signed-in portal's "Add A Vehicle".
 *
 * Why it changed (Nov 17 2026):
 *   - The old form created the row first and then uploaded from the browser.
 *     A failed upload left a row without photos, the visitor retried, and a
 *     second row was created (5 identical Rogue rows on Aug 28, 2 XC90 rows on
 *     Sep 15). A client idempotency key now makes retries land on one row.
 *   - updateFleetOwnerPhotos accepted any submission id, so anyone who knew an
 *     id could overwrite its photo list. Finishing now requires the same
 *     idempotency key that created the row.
 *   - Registration and ID go to the private partner-documents bucket through
 *     server-issued signed upload URLs; nothing about them is public.
 *   - Nobody was told a submission arrived (Grant Webb, Nov 16). A staff email
 *     to team@ is catalogued as "Partner Submission Alert", OFF until an Owner
 *     turns it on.
 *
 * If the v2 migration is not installed yet, intake falls back to the legacy
 * columns (contact extras go in notes) so a lead is never lost.
 */
import {
  intakeFileProblem,
  intakePath,
  isIntakePathFor,
  MAX_INTAKE_PHOTOS,
  PARTNER_SUBMISSION_ALERT_KEY,
  safeExt,
  type IntakeFileKind,
  type IntakeFileMeta,
} from "@/lib/partner-portal";

type Admin = any;

export type IntakeContact = {
  full_name: string;
  email: string;
  phone: string;
  business_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  sms_consent?: boolean;
};

export type IntakeVehicle = {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  color?: string | null;
  license_plate?: string | null;
  mileage?: number | null;
  title_status?: string | null;
  lien_status?: string | null;
  registration_state?: string | null;
  currently_insured?: boolean | null;
  condition?: string | null;
  message?: string | null;
};

export type IntakeStart = {
  idempotencyKey: string;
  contact: IntakeContact;
  vehicle: IntakeVehicle;
  files: IntakeFileMeta[];
  partnerId?: string | null;
  submittedBy?: string | null;
};

export type SignedUpload = { kind: IntakeFileKind; name: string; bucket: string; path: string; token: string };
export type IntakeStartResult = { submissionId: string; uploads: SignedUpload[]; schema: "v2" | "legacy"; replay: boolean };

/** Postgres/PostgREST "that column is not there" — the v2 migration is not installed. */
export function columnMissing(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "");
  return code === "42703" || code === "PGRST204" || /column .* does not exist|Could not find the '.*' column/i.test(msg);
}

export function validateIntakeFiles(files: IntakeFileMeta[]): string | null {
  const photos = files.filter((f) => f.kind === "photo");
  if (photos.length > MAX_INTAKE_PHOTOS) return `Up to ${MAX_INTAKE_PHOTOS} photos, please.`;
  if (files.filter((f) => f.kind === "registration").length > 2) return "Up to 2 registration files.";
  if (files.filter((f) => f.kind === "id_document").length > 2) return "Up to 2 ID files.";
  for (const f of files) {
    const p = intakeFileProblem(f);
    if (p) return p;
  }
  return null;
}

function legacyNotes(c: IntakeContact): string | null {
  const addr = [c.address_line1, c.address_line2, [c.city, c.state].filter(Boolean).join(", "), c.postal_code].filter(Boolean).join(" ");
  const parts = [
    c.business_name ? `Business: ${c.business_name}` : null,
    addr ? `Address: ${addr}` : null,
    c.sms_consent ? `SMS consent given ${new Date().toISOString()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export async function startIntake(admin: Admin, input: IntakeStart, deps: { uuid?: () => string; now?: Date } = {}): Promise<IntakeStartResult> {
  const problem = validateIntakeFiles(input.files);
  if (problem) throw new Error(problem);
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? new Date();
  const c = input.contact;
  const v = input.vehicle;
  const base = {
    full_name: c.full_name,
    email: c.email.trim().toLowerCase(),
    phone: c.phone,
    vin: v.vin.toUpperCase(),
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim ?? null,
    mileage: v.mileage ?? null,
    title_status: v.title_status ?? null,
    lien_status: v.lien_status ?? null,
    registration_state: v.registration_state ?? null,
    currently_insured: v.currently_insured ?? null,
    condition: v.condition ?? null,
    message: v.message ?? null,
    photo_urls: [] as string[],
  };
  const v2 = {
    ...base,
    business_name: c.business_name ?? null,
    address_line1: c.address_line1 ?? null,
    address_line2: c.address_line2 ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    postal_code: c.postal_code ?? null,
    color: v.color ?? null,
    license_plate: v.license_plate ? v.license_plate.toUpperCase() : null,
    sms_consent_at: c.sms_consent ? now.toISOString() : null,
    partner_id: input.partnerId ?? null,
    submitted_by: input.submittedBy ?? null,
    idempotency_key: input.idempotencyKey,
  };

  let schema: "v2" | "legacy" = "v2";
  let replay = false;
  let submissionId: string | null = null;

  const existing = await admin.from("fleet_owner_submissions").select("id").eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing?.error && columnMissing(existing.error)) {
    schema = "legacy";
  } else if (existing?.data?.id) {
    submissionId = existing.data.id;
    replay = true;
  }

  if (!submissionId) {
    if (schema === "v2") {
      const ins = await admin.from("fleet_owner_submissions").insert(v2).select("id").single();
      if (ins.error && columnMissing(ins.error)) schema = "legacy";
      else if (ins.error && String(ins.error.code) === "23505") {
        const again = await admin.from("fleet_owner_submissions").select("id").eq("idempotency_key", input.idempotencyKey).maybeSingle();
        submissionId = again?.data?.id ?? null;
        replay = !!submissionId;
        if (!submissionId) throw new Error("Could not save your submission. Please try again.");
      } else if (ins.error) throw new Error("Could not save your submission. Please try again.");
      else submissionId = ins.data.id;
    }
    if (schema === "legacy" && !submissionId) {
      const ins = await admin.from("fleet_owner_submissions").insert({ ...base, notes: legacyNotes(c) }).select("id").single();
      if (ins.error) throw new Error("Could not save your submission. Please try again.");
      submissionId = ins.data.id;
    }
  }

  // Legacy schema: the private documents bucket may not exist either, so only
  // photos get upload URLs there. The form says registration can be sent later.
  const wanted = schema === "legacy" ? input.files.filter((f) => f.kind === "photo") : input.files;
  const uploads: SignedUpload[] = [];
  for (const f of wanted) {
    const { bucket, path } = intakePath(submissionId!, f.kind, uuid(), safeExt(f.name, f.type));
    const signed = await admin.storage.from(bucket).createSignedUploadUrl(path);
    if (signed.error || !signed.data?.token) {
      console.error("[partner-intake] signed upload failed", bucket, signed.error?.message);
      continue;
    }
    uploads.push({ kind: f.kind, name: f.name, bucket, path, token: signed.data.token });
  }
  return { submissionId: submissionId!, uploads, schema, replay };
}

export type IntakeFinish = {
  submissionId: string;
  idempotencyKey: string;
  uploaded: Array<{ kind: IntakeFileKind; path: string }>;
};

async function objectExists(admin: Admin, bucket: string, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const res = await admin.storage.from(bucket).list(folder, { search: name, limit: 5 });
  if (res.error) return false;
  return (res.data ?? []).some((o: { name: string }) => o.name === name);
}

export async function finishIntake(
  admin: Admin,
  input: IntakeFinish,
  deps: { exists?: (bucket: string, path: string) => Promise<boolean>; alert?: (submissionId: string) => Promise<unknown>; now?: Date } = {},
): Promise<{ ok: true; photos: number; registration: boolean; idDocument: boolean }> {
  const exists = deps.exists ?? ((b: string, p: string) => objectExists(admin, b, p));
  let schema: "v2" | "legacy" = "v2";
  let row: any = null;
  const r = await admin
    .from("fleet_owner_submissions")
    .select("id,idempotency_key,photo_urls,registration_path,id_document_path,created_at,status")
    .eq("id", input.submissionId)
    .maybeSingle();
  if (r.error && columnMissing(r.error)) {
    schema = "legacy";
    const l = await admin.from("fleet_owner_submissions").select("id,photo_urls,created_at,status").eq("id", input.submissionId).maybeSingle();
    row = l.data;
    // Without the key column, only a fresh row with no photos may be finished once.
    const fresh = row && Date.now() - new Date(row.created_at).getTime() < 60 * 60 * 1000 && (row.photo_urls ?? []).length === 0;
    if (!fresh) throw new Error("Forbidden");
  } else {
    row = r.data;
    if (!row || row.idempotency_key !== input.idempotencyKey) throw new Error("Forbidden");
  }
  if (["approved", "declined", "enrolled"].includes(String(row.status ?? "").toLowerCase())) throw new Error("This submission is closed.");

  const photos: string[] = [...(row.photo_urls ?? [])];
  let registration: string | null = row.registration_path ?? null;
  let idDoc: string | null = row.id_document_path ?? null;
  for (const u of input.uploaded) {
    if (!isIntakePathFor(input.submissionId, u.kind, u.path)) continue;
    const bucket = u.kind === "photo" ? "owner-vehicle-photos" : "partner-documents";
    if (!(await exists(bucket, u.path))) continue;
    if (u.kind === "photo") { if (!photos.includes(u.path)) photos.push(u.path); }
    else if (u.kind === "registration") registration = u.path;
    else idDoc = u.path;
  }
  const patch: Record<string, unknown> = { photo_urls: photos.slice(0, MAX_INTAKE_PHOTOS) };
  if (schema === "v2") {
    patch.registration_path = registration;
    patch.id_document_path = idDoc;
  }
  const up = await admin.from("fleet_owner_submissions").update(patch).eq("id", input.submissionId);
  if (up.error) throw new Error("Could not save your files. Please try again.");

  const alert = deps.alert ?? ((id: string) => sendPartnerSubmissionAlert(admin, id));
  await alert(input.submissionId).catch((e: unknown) => console.error("[partner-intake] alert failed", e));
  return { ok: true, photos: patch.photo_urls ? (patch.photo_urls as string[]).length : 0, registration: !!registration, idDocument: !!idDoc };
}

/**
 * One email to the team inbox when a submission is finished. Gated by the
 * Automations switch (default OFF) and by sendEmail's own workflow gate.
 * Contains the vehicle and an admin link only — no phone number.
 */
export async function sendPartnerSubmissionAlert(
  admin: Admin,
  submissionId: string,
  deps: { gate?: "send" | "off" | "held"; sendEmail?: (a: any) => Promise<any> } = {},
): Promise<{ status: string }> {
  let gate = deps.gate;
  if (!gate) {
    const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
    gate = gateFor(await loadAutomationControls(admin), PARTNER_SUBMISSION_ALERT_KEY);
  }
  if (gate !== "send") return { status: gate };
  const { data: s } = await admin.from("fleet_owner_submissions").select("id,full_name,email,year,make,model,trim,photo_urls").eq("id", submissionId).maybeSingle();
  if (!s) return { status: "missing" };
  const { TEAM_ALERT_EMAIL, scrubPhones } = await import("@/lib/team-alerts");
  const { escapeHtml, vehicleLabel } = await import("@/lib/partner-portal");
  const car = vehicleLabel(s);
  const html = scrubPhones(
    `<p>New partner vehicle submitted on drivereal.com/partners.</p><p><strong>${escapeHtml(car)}</strong><br/>From: ${escapeHtml(s.full_name ?? "")} (${escapeHtml(s.email ?? "")})<br/>Photos: ${(s.photo_urls ?? []).length}</p><p><a href="https://drivereal.com/admin?tab=partners">Review in Back Office → Partners</a></p>`,
  );
  const send = deps.sendEmail ?? (await import("@/lib/email.server")).sendEmail;
  const r = await send({ to: TEAM_ALERT_EMAIL, subject: `New partner vehicle: ${car}`, html, track: { workflow: "partner_submission_alert" } });
  return { status: r?.ok ? "sent" : "failed" };
}
