/**
 * Server helpers: look up a driver by any contact, list contacts, and
 * fan out automated renter emails and texts. Falls back to
 * applications.phone / applications.email when the table is not installed.
 */
import {
  type DriverContact,
  type FleetContacts,
  contactSmsDecision,
  fleetContactsPayload,
  isDriverContactsTableMissing,
  last10Digits,
  normalizeDriverEmail,
  normalizeDriverPhone,
  sameEmail,
  samePhone,
} from "@/lib/driver-contacts";

type Admin = any;

const CONTACT_COLS =
  "id,application_id,kind,value,label,is_primary,receives_messages,consented_at,created_by,created_at,updated_at";

function asContact(row: Record<string, any>): DriverContact {
  return {
    id: row.id,
    application_id: row.application_id,
    kind: row.kind,
    value: row.value,
    label: row.label ?? null,
    is_primary: !!row.is_primary,
    receives_messages: !!row.receives_messages,
    consented_at: row.consented_at ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listDriverContacts(admin: Admin, applicationId: string): Promise<DriverContact[]> {
  const r = await admin.from("driver_contacts").select(CONTACT_COLS).eq("application_id", applicationId);
  if (r.error) {
    if (isDriverContactsTableMissing(r.error)) return [];
    throw new Error(r.error.message ?? "Could not read driver contacts.");
  }
  return ((r.data ?? []) as any[]).map(asContact);
}

async function optedOutSet(admin: Admin, e164s: string[]): Promise<Set<string>> {
  const unique = [...new Set(e164s.filter(Boolean))];
  if (!unique.length) return new Set();
  try {
    const r = await admin.from("sms_opt_outs").select("phone").in("phone", unique);
    if (r?.error) return new Set();
    return new Set(((r.data ?? []) as any[]).map((x) => x.phone).filter(Boolean));
  } catch {
    // Incomplete test fakes (no `.in`) or a missing table must not abort
    // the send. Production still honors application-level sms_opt_out_at
    // and the central sendSms check against sms_opt_outs.
    return new Set();
  }
}

export async function fleetContactsFor(
  admin: Admin,
  applicationId: string,
  app: {
    phone?: string | null;
    email?: string | null;
    sms_consent?: boolean | null;
    sms_opt_out_at?: string | null;
    sms_consent_phone?: string | null;
  },
): Promise<FleetContacts> {
  const contacts = await listDriverContacts(admin, applicationId);
  const phones = contacts.filter((c) => c.kind === "phone").map((c) => normalizeDriverPhone(c.value) ?? c.value);
  if (app.phone) {
    const p = normalizeDriverPhone(app.phone);
    if (p) phones.push(p);
  }
  const opted = await optedOutSet(admin, phones);
  return fleetContactsPayload(contacts, app, opted);
}

type AppMatchRow = {
  id: string;
  phone?: string | null;
  email?: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
  status?: string | null;
};

function usableApp(row: AppMatchRow | null | undefined): boolean {
  return !!row && !row.deleted_at && row.status !== "duplicate";
}

async function appsByIds(admin: Admin, ids: string[]): Promise<AppMatchRow[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const r = await admin
    .from("applications")
    .select("id,phone,email,created_at,deleted_at,status")
    .in("id", unique);
  if (r.error) throw new Error(r.error.message ?? "Could not read applications.");
  return ((r.data ?? []) as AppMatchRow[]).filter(usableApp);
}

/**
 * Newest non-deleted, non-duplicate application whose primary phone or any
 * extra phone ends in the same 10 digits.
 */
export async function findApplicationsByPhone(admin: Admin, raw: string | null | undefined): Promise<AppMatchRow[]> {
  const digits = last10Digits(raw);
  if (!digits) return [];
  const e164 = normalizeDriverPhone(raw) ?? (digits ? `+1${digits}` : null);

  const fromApps = await admin
    .from("applications")
    .select("id,phone,email,created_at,deleted_at,status")
    .ilike("phone", `%${digits.slice(-4)}%`)
    .limit(50);

  const apps = ((fromApps.error ? [] : fromApps.data) ?? []) as AppMatchRow[];
  const matched = new Map<string, AppMatchRow>();
  for (const a of apps) {
    if (usableApp(a) && samePhone(a.phone, digits)) matched.set(a.id, a);
  }

  const fromContacts = await admin
    .from("driver_contacts")
    .select("application_id,value")
    .eq("kind", "phone")
    .ilike("value", `%${digits.slice(-4)}%`)
    .limit(50);
  if (!fromContacts.error) {
    const rows = ((fromContacts.data ?? []) as any[]).filter((r) => samePhone(r.value, e164 ?? digits));
    const extras = await appsByIds(admin, rows.map((r) => r.application_id));
    for (const a of extras) matched.set(a.id, a);
  }

  return [...matched.values()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function findApplicationsByEmail(admin: Admin, raw: string | null | undefined): Promise<AppMatchRow[]> {
  const email = normalizeDriverEmail(raw);
  if (!email) return [];

  const fromApps = await admin
    .from("applications")
    .select("id,phone,email,created_at,deleted_at,status")
    .ilike("email", email)
    .limit(50);
  const matched = new Map<string, AppMatchRow>();
  for (const a of ((fromApps.error ? [] : fromApps.data) ?? []) as AppMatchRow[]) {
    if (usableApp(a) && sameEmail(a.email, email)) matched.set(a.id, a);
  }

  const fromContacts = await admin
    .from("driver_contacts")
    .select("application_id,value")
    .eq("kind", "email")
    .eq("value", email)
    .limit(50);
  if (!fromContacts.error) {
    const extras = await appsByIds(admin, ((fromContacts.data ?? []) as any[]).map((r) => r.application_id));
    for (const a of extras) matched.set(a.id, a);
  }

  return [...matched.values()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function matchLeadByPhone(admin: Admin, raw: string | null | undefined): Promise<string | null> {
  const rows = await findApplicationsByPhone(admin, raw);
  return rows[0]?.id ?? null;
}

export async function matchLeadByEmail(admin: Admin, raw: string | null | undefined): Promise<string | null> {
  const rows = await findApplicationsByEmail(admin, raw);
  return rows[0]?.id ?? null;
}

export type LookupMatch = {
  lead_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
  matched: { kind: "phone" | "email"; value: string; is_primary: boolean };
  contacts: FleetContacts;
};

/** FLEET status action=lookup. Matches on any of a driver's contacts. */
export async function lookupLeadByContact(
  admin: Admin,
  body: { phone?: unknown; email?: unknown },
): Promise<{ status: 200; body: LookupMatch } | { status: 400 | 404; error: string }> {
  const phone = typeof body.phone === "string" ? body.phone : "";
  const email = typeof body.email === "string" ? body.email : "";
  if (!last10Digits(phone) && !normalizeDriverEmail(email)) {
    return { status: 400, error: "Give a phone or an email to look up." };
  }
  const rows = last10Digits(phone)
    ? await findApplicationsByPhone(admin, phone)
    : await findApplicationsByEmail(admin, email);
  const row = rows[0];
  if (!row) return { status: 404, error: "No driver matched that contact." };
  const appRes = await admin
    .from("applications")
    .select("id,full_name,email,phone,status,sms_consent,sms_opt_out_at,sms_consent_phone")
    .eq("id", row.id)
    .maybeSingle();
  const app = appRes.data;
  if (!app) return { status: 404, error: "No driver matched that contact." };
  const contacts = await fleetContactsFor(admin, app.id, app);
  const phoneNorm = normalizeDriverPhone(phone);
  const emailNorm = normalizeDriverEmail(email);
  let matched: LookupMatch["matched"];
  if (phoneNorm || last10Digits(phone)) {
    const hit = contacts.phones.find((p) => samePhone(p.value, phone)) ?? {
      value: phoneNorm ?? String(phone),
      is_primary: samePhone(app.phone, phone),
    };
    matched = { kind: "phone", value: hit.value, is_primary: !!hit.is_primary };
  } else {
    const hit = contacts.emails.find((p) => sameEmail(p.value, emailNorm)) ?? {
      value: emailNorm ?? String(email),
      is_primary: sameEmail(app.email, emailNorm),
    };
    matched = { kind: "email", value: hit.value, is_primary: !!hit.is_primary };
  }
  return {
    status: 200,
    body: {
      lead_id: app.id,
      name: app.full_name ?? null,
      email: app.email ?? null,
      phone: app.phone ?? null,
      stage: app.status ?? null,
      matched,
      contacts,
    },
  };
}

export type RenterSmsTarget = {
  e164: string;
  is_primary: boolean;
  canText: boolean;
  reason?: string;
  /** The value on applications.phone, used as sendSms `to` for the primary so existing formats stay stable. */
  original?: string | null;
  sms_consent?: boolean | null;
};

export async function renterSmsTargets(
  admin: Admin,
  applicationId: string,
  app?: {
    phone?: string | null;
    sms_consent?: boolean | null;
    sms_opt_out_at?: string | null;
    sms_consent_phone?: string | null;
  } | null,
  opts?: { transactionalPrimary?: boolean },
): Promise<RenterSmsTarget[]> {
  let record = app ?? null;
  if (!record || record.sms_consent === undefined || record.sms_opt_out_at === undefined || record.sms_consent_phone === undefined || record.phone === undefined) {
    const r = await admin
      .from("applications")
      .select("id,phone,sms_consent,sms_opt_out_at,sms_consent_phone")
      .eq("id", applicationId)
      .maybeSingle();
    if (r.data) record = { ...r.data, ...record };
    else if (!record) return [];
  }
  if (!record) return [];
  const contacts = await listDriverContacts(admin, applicationId);
  const phoneRows = contacts.filter((c) => c.kind === "phone");
  const candidates: { e164: string; is_primary: boolean; receives_messages: boolean; consented_at: string | null }[] = [];
  const seen = new Set<string>();
  const add = (e164: string | null, is_primary: boolean, receives_messages: boolean, consented_at: string | null) => {
    if (!e164 || seen.has(e164)) return;
    seen.add(e164);
    candidates.push({ e164, is_primary, receives_messages: is_primary || receives_messages, consented_at });
  };
  for (const c of phoneRows) add(normalizeDriverPhone(c.value), c.is_primary, c.receives_messages, c.consented_at);
  add(normalizeDriverPhone(record.phone), true, true, null);

  const opted = await optedOutSet(admin, candidates.map((c) => c.e164));
  return candidates
    .filter((c) => c.is_primary || c.receives_messages)
    .map((c) => {
      if (c.is_primary && opts?.transactionalPrimary) {
        return opted.has(c.e164)
          ? { e164: c.e164, is_primary: true, canText: false as const, reason: "opted_out", original: record.phone, sms_consent: record.sms_consent ?? null }
          : { e164: c.e164, is_primary: true, canText: true as const, original: record.phone, sms_consent: record.sms_consent ?? null };
      }
      const decision = contactSmsDecision({
        e164: c.e164,
        isPrimary: c.is_primary,
        receivesMessages: c.receives_messages,
        optedOut: opted.has(c.e164),
        app: record!,
        consentedAt: c.consented_at,
      });
      return decision.canText
        ? { e164: c.e164, is_primary: c.is_primary, canText: true as const, original: c.is_primary ? record.phone : c.e164, sms_consent: record.sms_consent ?? null }
        : { e164: c.e164, is_primary: c.is_primary, canText: false as const, reason: decision.reason, original: c.is_primary ? record.phone : c.e164, sms_consent: record.sms_consent ?? null };
    });
}

export async function renterEmailTargets(
  admin: Admin,
  applicationId: string,
  app?: { email?: string | null } | null,
): Promise<string[]> {
  const contacts = await listDriverContacts(admin, applicationId);
  const emails: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined, enabled: boolean) => {
    if (!enabled) return;
    const v = normalizeDriverEmail(raw);
    if (!v || seen.has(v)) return;
    seen.add(v);
    emails.push(v);
  };
  for (const c of contacts.filter((c) => c.kind === "email")) add(c.value, c.is_primary || c.receives_messages);
  add(app?.email ?? null, true);
  if (!app) {
    const r = await admin.from("applications").select("email").eq("id", applicationId).maybeSingle();
    add(r.data?.email ?? null, true);
  }
  return emails;
}

export async function canReachRenter(
  admin: Admin,
  channel: string,
  app: { id: string; phone?: string | null; email?: string | null; sms_consent?: boolean | null; sms_opt_out_at?: string | null; sms_consent_phone?: string | null } | null | undefined,
): Promise<boolean> {
  if (!app) return false;
  if (channel === "sms") {
    const targets = await renterSmsTargets(admin, app.id, app);
    return targets.some((t) => t.canText);
  }
  const emails = await renterEmailTargets(admin, app.id, app);
  return emails.length > 0;
}

type SmsFn = (args: any) => Promise<any>;
type EmailFn = (args: any) => Promise<any>;

export async function sendRenterSms(args: {
  admin: Admin;
  applicationId: string;
  body: string;
  kind?: string;
  rentalId?: string | null;
  vehicleId?: string | null;
  workflowId?: string | null;
  enrollmentId?: string | null;
  stepId?: string | null;
  fromId?: string | null;
  requireConsent?: boolean;
  noticeTimeout?: boolean;
  sendSms: SmsFn;
  app?: Parameters<typeof renterSmsTargets>[2];
}): Promise<{ sent: number; skipped: number; results: any[]; targets: RenterSmsTarget[] }> {
  const targets = await renterSmsTargets(args.admin, args.applicationId, args.app, {
    transactionalPrimary: args.requireConsent === false,
  });
  const results: any[] = [];
  let sent = 0;
  let skipped = 0;
  for (const t of targets) {
    // Primary: if consent is unknown (fixture or a partial row), still call
    // sendSms so the central check or a test mock can decide. An explicit
    // opt-out or sms_consent === false is never sent. Extras always need canText.
    const attemptPrimaryWithoutKnownConsent =
      t.is_primary && t.sms_consent !== false && t.reason !== "opted_out" && t.reason !== "invalid_phone";
    if (!t.canText && !(attemptPrimaryWithoutKnownConsent && t.reason === "no_consent")) {
      skipped++;
      results.push({ ok: false, skipped: true, reason: t.reason, to: t.e164 });
      continue;
    }
    const r = await args.sendSms({
      to: t.is_primary && t.original ? t.original : t.e164,
      body: args.body,
      kind: args.kind,
      applicationId: args.applicationId,
      rentalId: args.rentalId ?? undefined,
      vehicleId: args.vehicleId ?? undefined,
      workflowId: args.workflowId ?? undefined,
      enrollmentId: args.enrollmentId ?? undefined,
      stepId: args.stepId ?? undefined,
      fromId: args.fromId ?? undefined,
      noticeTimeout: args.noticeTimeout,
      // Extras always need their own consent, even when the caller marked the
      // primary send as transactional (requireConsent: false).
      requireConsent: t.is_primary ? args.requireConsent : true,
    });
    results.push({ ...r, to: t.e164 });
    if (r?.ok) sent++;
    else skipped++;
  }
  if (!targets.length) skipped++;
  return { sent, skipped, results, targets };
}

export async function sendRenterEmail(args: {
  admin: Admin;
  applicationId: string;
  subject: string;
  html: string;
  track?: { workflow?: string };
  idempotencyKey?: string | null;
  replyTo?: string;
  sendEmail: EmailFn;
  app?: { email?: string | null } | null;
}): Promise<{ sent: number; skipped: number; results: any[]; targets: string[] }> {
  const targets = await renterEmailTargets(args.admin, args.applicationId, args.app);
  const results: any[] = [];
  let sent = 0;
  let skipped = 0;
  for (const to of targets) {
    const r = await args.sendEmail({
      to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
      track: args.track,
      idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:${to}` : undefined,
    });
    results.push({ ...r, to });
    if (r?.ok !== false) sent++;
    else skipped++;
  }
  if (!targets.length) skipped++;
  return { sent, skipped, results, targets };
}

/**
 * Mark or clear per-number SMS consent on a contact row when the renter
 * texts START or STOP from that number. Never invents consent.
 */
export async function recordContactSmsConsent(
  admin: Admin,
  applicationId: string,
  rawPhone: string,
  consent: "start" | "stop",
): Promise<void> {
  const e164 = normalizeDriverPhone(rawPhone);
  if (!e164) return;
  const r = await admin
    .from("driver_contacts")
    .select("id,value")
    .eq("application_id", applicationId)
    .eq("kind", "phone");
  if (r.error) {
    if (isDriverContactsTableMissing(r.error)) return;
    return;
  }
  const row = ((r.data ?? []) as any[]).find((c) => samePhone(c.value, e164));
  if (!row) return;
  await admin
    .from("driver_contacts")
    .update({ consented_at: consent === "start" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

/** True when this number is the application's primary phone. */
export function isPrimaryPhone(app: { phone?: string | null }, raw: string | null | undefined): boolean {
  return samePhone(app.phone, raw);
}
