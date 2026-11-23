/**
 * Missing-Items Outreach (server). See missing-items.ts for the rules and copy.
 *
 * Two modes, one engine:
 *   ongoing   every 5 minutes from /api/public/cron/automations, Automations
 *             switch "missing_items_outreach" (Off by default).
 *   backfill  the one-time message to existing applicants, run from
 *             POST /api/public/fleet/missing-items { action: "backfill" },
 *             Automations switch "missing_items_backfill" (Off by default).
 *             An applicant who has any outreach row is never backfilled, and a
 *             unique index allows one backfill row per application.
 *
 * Every send is claimed first (applicant_outreach_log, unique per application,
 * missing set and step), so two overlapping runs can never send the same step
 * twice. dryRun sends nothing, mints no links and writes nothing.
 */
import {
  COME_BACK_SUBJECT,
  MISSING_ITEMS_AUTOCLOSE_KEY,
  MISSING_ITEMS_AUTOCLOSE_KIND,
  MISSING_ITEMS_AUTOCLOSE_WORKFLOW,
  MISSING_ITEMS_AUTOMATION_KEY,
  comeBackEmail,
  comeBackSms,
  decideAutoClose,
  MISSING_ITEMS_BACKFILL_KEY,
  MISSING_ITEMS_BACKFILL_WORKFLOW,
  MISSING_ITEMS_EMAIL_WORKFLOW,
  MISSING_ITEMS_KIND,
  MISSING_ITEMS_SETTINGS_KEY,
  MISSING_ITEM_KEYS,
  decideOutreach,
  firstNameOf,
  missingItems,
  outreachEmail,
  outreachSms,
  readOutreachSettings,
  redactContact,
  toUsE164,
  type MissingItemKey,
  type OutreachApp,
  type OutreachLogRow,
  type OutreachSettings,
} from "@/lib/missing-items";
import { notDrivingGigYet } from "@/lib/fleet-review";
import { isSuppressedEmail } from "@/lib/email-suppression";

export const OUTREACH_LOG_TABLE = "applicant_outreach_log";
const APP_COLUMNS =
  "id,full_name,status,email,phone,sms_consent,sms_opt_out_at,license_photo_url,profile_screenshot_url,income_proof_url,trip_screenshots,vehicle_size,pickup_date,expected_duration,gig_status,drive_type,created_at,updated_at,deleted_at,primary_application_id,legal_hold,source,current_step";
const PREVIEW_LINK = "https://drivereal.com/thank-you?t=PRIVATE-14-DAY-LINK";

export type OutreachDeps = {
  now?: () => Date;
  sendEmail?: (a: { to: string; subject: string; html: string; track: { workflow: string } }) => Promise<{ ok: boolean; error?: string; blocked?: string }>;
  sendSms?: (a: { to: string; body: string; kind: string; applicationId: string }) => Promise<{ ok: boolean; reason?: string; error?: string }>;
  mintLink?: (admin: any, applicationId: string) => Promise<string>;
  companyPhone?: (admin: any) => Promise<string>;
  /** Automations switches: "send" | "off" | "held". */
  gate?: (admin: any, key: string) => Promise<"send" | "off" | "held">;
};

export type PlannedSend = { app: OutreachApp; items: MissingItemKey[]; step: 1 | 2 | 3; key: string; email: boolean; sms: boolean };

export type OutreachSummary = {
  ok: boolean;
  mode: "ongoing" | "backfill";
  dryRun: boolean;
  held?: string;
  considered: number;
  eligible: number;
  planned: number;
  sent: number;
  failed: number;
  channels: { email_only: number; email_and_sms: number; sms_only: number };
  byItem: Record<MissingItemKey, number>;
  byStep: Record<string, number>;
  age: { over30Days: number; over90Days: number };
  skipped: Record<string, number>;
  samples: { step: number; contact: ReturnType<typeof redactContact>; items: MissingItemKey[]; email: { subject: string; body: string } | null; sms: string | null }[];
};

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function readIn(admin: any, table: string, cols: string, field: string, ids: string[], extra?: (q: any) => any): Promise<any[]> {
  const rows: any[] = [];
  for (const part of chunk(ids, 150)) {
    let q = admin.from(table).select(cols).in(field, part);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

// The rule is shared with every renter-facing email (email-suppression.ts).
export { isSuppressedEmail };

/** Recipients with a bounced or complained delivery on record. Fails open to an empty set (the provider still bounces). */
async function loadSuppressedEmails(admin: any): Promise<Set<string>> {
  try {
    const { data, error } = await admin.from("email_deliveries").select("recipient").in("state", ["bounced", "complained"]).limit(5000);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((r: any) => String(r.recipient ?? "").trim().toLowerCase()).filter(Boolean));
  } catch (err) {
    console.error("[missing-items] could not read bounced emails", err);
    return new Set();
  }
}

export function easternHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(at));
}

export async function loadOutreachSettings(admin: any): Promise<OutreachSettings | null> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", MISSING_ITEMS_SETTINGS_KEY).maybeSingle();
  if (error) return null;
  return readOutreachSettings(data?.value ?? null);
}

async function defaultGate(admin: any, key: string) {
  const { loadAutomationControls, gateFor } = await import("@/lib/automation-controls.server");
  return gateFor(await loadAutomationControls(admin), key);
}

/** Compute the plan (and, unless dryRun, send it). */
export async function runMissingItemsOutreach(
  admin: any,
  opts: { mode: "ongoing" | "backfill"; dryRun?: boolean; limit?: number; sampleCount?: number },
  deps: OutreachDeps = {},
): Promise<OutreachSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const dryRun = opts.dryRun === true;
  const summary: OutreachSummary = {
    ok: true, mode: opts.mode, dryRun, considered: 0, eligible: 0, planned: 0, sent: 0, failed: 0,
    channels: { email_only: 0, email_and_sms: 0, sms_only: 0 },
    byItem: Object.fromEntries(MISSING_ITEM_KEYS.map((k) => [k, 0])) as Record<MissingItemKey, number>,
    byStep: {}, age: { over30Days: 0, over90Days: 0 }, skipped: {}, samples: [],
  };

  const settings = await loadOutreachSettings(admin);
  if (!settings) return { ...summary, ok: false, held: "settings_unreadable" };

  if (!dryRun) {
    const key = opts.mode === "backfill" ? MISSING_ITEMS_BACKFILL_KEY : MISSING_ITEMS_AUTOMATION_KEY;
    const gate = await (deps.gate ?? defaultGate)(admin, key);
    if (gate !== "send") return { ...summary, held: gate === "off" ? "switched_off" : "controls_unreadable" };
    const h = easternHour(now);
    if (h < settings.smsHours[0] || h >= settings.smsHours[1]) return { ...summary, held: "outside_sending_hours" };
  }

  const { data: apps, error } = await admin
    .from("applications")
    .select(APP_COLUMNS)
    .in("status", settings.statuses)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return { ...summary, ok: false, held: "applications_unreadable" };
  const list = (apps ?? []) as OutreachApp[];
  summary.considered = list.length;
  const ids = list.map((a) => a.id);

  const since = new Date(now.getTime() - settings.minGapHours * 3_600_000).toISOString();
  const [docs, log, enroll, recent, screens, opt] = ids.length
    ? await Promise.all([
        readIn(admin, "documents", "driver_id,category,review_status,is_current", "driver_id", ids, (q) => q.in("category", ["license_front", "gig_profile", "income", "trip_history"])),
        readIn(admin, OUTREACH_LOG_TABLE, "application_id,missing_key,step,source,created_at", "application_id", ids),
        readIn(admin, "automation_enrollments", "application_id", "application_id", ids, (q) => q.eq("status", "active")),
        readIn(admin, "outbound_messages", "application_id,created_at", "application_id", ids, (q) => q.gte("created_at", since)),
        readIn(admin, "driver_screenings", "lead_id,disqualified", "lead_id", ids, (q) => q.eq("disqualified", true)),
        admin.from("sms_opt_outs").select("phone").limit(5000).then((r: any) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; }),
      ])
    : [[], [], [], [], [], []];
  // Addresses that already bounced or complained. Mailing them again hurts the
  // sender's reputation for everyone, so their email is dropped (texts still go).
  const badEmails = ids.length ? await loadSuppressedEmails(admin) : new Set<string>();

  const by = <T extends Record<string, any>>(rows: T[], k: string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r[k]) ?? m.set(r[k], []).get(r[k])!).push(r);
    return m;
  };
  const docsBy = by(docs, "driver_id");
  const logBy = by(log, "application_id");
  const enrolled = new Set(enroll.map((r: any) => r.application_id));
  const lastOut = new Map<string, string>();
  for (const r of recent as any[]) if (!lastOut.has(r.application_id) || r.created_at > lastOut.get(r.application_id)!) lastOut.set(r.application_id, r.created_at);
  const dq = new Set(screens.map((r: any) => r.lead_id));
  const optedOut = new Set<string>((opt as any[]).map((r) => toUsE164(r.phone)).filter(Boolean) as string[]);

  // The Follow-Up never starts a sequence before the one-time message has gone
  // out: that needs at least one backfill row and the One-Time switch back Off.
  let holdNewSequences = false;
  if (opts.mode === "ongoing") {
    const { data: bfRows, error: bfErr } = await admin.from(OUTREACH_LOG_TABLE).select("id").eq("source", "backfill").limit(1);
    const backfillGate = await (deps.gate ?? defaultGate)(admin, MISSING_ITEMS_BACKFILL_KEY).catch(() => "held" as const);
    holdNewSequences = !!bfErr || !(Array.isArray(bfRows) && bfRows.length > 0) || backfillGate !== "off";
  }

  const plan: PlannedSend[] = [];
  for (const app of list) {
    const items = missingItems(app, docsBy.get(app.id) ?? []);
    const d = decideOutreach({
      app, items, log: (logBy.get(app.id) ?? []) as OutreachLogRow[], activeEnrollment: enrolled.has(app.id),
      lastOutboundAt: lastOut.get(app.id) ?? null, disqualified: dq.has(app.id), optedOut, now, settings, mode: opts.mode, holdNewSequences,
    });
    if (!d.send) {
      summary.skipped[d.reason] = (summary.skipped[d.reason] ?? 0) + 1;
      continue;
    }
    let email = d.email;
    if (email && isSuppressedEmail(app.email, badEmails)) {
      email = false;
      summary.skipped.email_suppressed = (summary.skipped.email_suppressed ?? 0) + 1;
      if (!d.sms) continue;
    }
    plan.push({ app, items, step: d.step, key: d.key, email, sms: d.sms });
  }
  summary.eligible = plan.length;
  const cap = Math.max(1, Math.min(opts.limit ?? (opts.mode === "ongoing" ? settings.batchLimit : 50), 500));
  const batch = dryRun ? plan : plan.slice(0, cap);
  summary.planned = batch.length;

  // Auto-close on: the last message (step 3, or the one-time message) says when.
  const closeOn = (await (deps.gate ?? defaultGate)(admin, MISSING_ITEMS_AUTOCLOSE_KEY).catch(() => "off")) === "send";
  const closeInDays = (step: number) => (closeOn && (step === 3 || opts.mode === "backfill") ? settings.autoCloseDays : null);
  const phone = dryRun ? "(888) 833-8280" : await (deps.companyPhone ?? (async (a: any) => (await (await import("@/lib/company.server")).getBusinessPhone(a)).display))(admin);
  for (const p of batch) {
    summary.channels[p.email && p.sms ? "email_and_sms" : p.email ? "email_only" : "sms_only"]++;
    for (const k of p.items) summary.byItem[k]++;
    summary.byStep[`step${p.step}`] = (summary.byStep[`step${p.step}`] ?? 0) + 1;
    const ageDays = (now.getTime() - Date.parse(String(p.app.created_at ?? ""))) / 86_400_000;
    if (ageDays > 30) summary.age.over30Days++;
    if (ageDays > 90) summary.age.over90Days++;
  }

  if (dryRun) {
    const pick = batch.slice(0, Math.max(0, opts.sampleCount ?? 3));
    summary.samples = pick.map((p) => {
      const vars = { firstName: "[First Name]", items: p.items, link: PREVIEW_LINK, companyPhone: phone, closeInDays: closeInDays(p.step), notDrivingYet: notDrivingGigYet(p.app) };
      return { step: p.step, contact: redactContact(p.app), items: p.items, email: p.email ? outreachEmail(p.step, vars) : null, sms: p.sms ? outreachSms(p.step, vars) : null };
    });
    return summary;
  }

  for (const p of batch) {
    try {
      const sent = await sendOne(admin, p, opts.mode, phone, deps, closeInDays(p.step));
      if (sent) summary.sent++;
      else summary.failed++;
    } catch (e) {
      summary.failed++;
      console.error("[missing-items] send failed", p.app.id, e);
    }
  }
  return summary;
}

async function defaultMintLink(a: any, id: string): Promise<string> {
  const { issueResumeToken, resumeUrl } = await import("@/lib/resume-tokens.server");
  return resumeUrl(await issueResumeToken(a, id));
}

/** Claim, mint the link, send, record. Returns true when at least one channel went out. */
async function sendOne(admin: any, p: PlannedSend, mode: "ongoing" | "backfill", companyPhone: string, deps: OutreachDeps, closeInDays: number | null): Promise<boolean> {
  const claim = await admin
    .from(OUTREACH_LOG_TABLE)
    .insert({ application_id: p.app.id, missing_key: p.key, step: p.step, source: mode, items: p.items, channels: [] })
    .select("id")
    .maybeSingle();
  if (claim.error) {
    if (String(claim.error.code) === "23505") return false; // another run already has it
    throw new Error(claim.error.message);
  }
  const claimId = claim.data?.id;

  let link: string;
  try {
    link = await (deps.mintLink ?? defaultMintLink)(admin, p.app.id);
  } catch (e) {
    // Nothing went out: release the claim so the next run can try again.
    if (claimId) await admin.from(OUTREACH_LOG_TABLE).delete().eq("id", claimId);
    throw e;
  }

  const vars = { firstName: firstNameOf(p.app.full_name), items: p.items, link, companyPhone, closeInDays, notDrivingYet: notDrivingGigYet(p.app) };
  const channels: string[] = [];
  const errors: string[] = [];
  const { sendRenterEmail, sendRenterSms } = await import("@/lib/driver-contacts.server");
  if (p.email) {
    const { subject, body } = outreachEmail(p.step, vars);
    const { renderAutomationEmailHtml } = await import("@/lib/automations.server");
    const send = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
    const mail = await sendRenterEmail({
      admin, applicationId: p.app.id, subject, html: renderAutomationEmailHtml(body, link),
      track: { workflow: mode === "backfill" ? MISSING_ITEMS_BACKFILL_WORKFLOW : MISSING_ITEMS_EMAIL_WORKFLOW },
      sendEmail: send, app: p.app,
    });
    if (mail.sent > 0) {
      channels.push("email");
      for (const to of mail.targets) {
        await admin.from("outbound_messages").insert({
          channel: "email", to_address: to, subject, body, status: "sent", provider: "resend",
          kind: MISSING_ITEMS_KIND, application_id: p.app.id,
        });
      }
    } else if (mail.targets.length) errors.push("email: failed");
  }
  if (p.sms) {
    const send = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a));
    const texts = await sendRenterSms({ admin, applicationId: p.app.id, body: outreachSms(p.step, vars), kind: MISSING_ITEMS_KIND, sendSms: send, app: p.app });
    if (texts.sent > 0) channels.push("sms");
    else if (texts.targets.length) errors.push(`sms: ${texts.results[0]?.reason ?? texts.results[0]?.error ?? "failed"}`);
  }
  if (claimId) await admin.from(OUTREACH_LOG_TABLE).update({ channels, error: errors.join("; ") || null }).eq("id", claimId);
  return channels.length > 0;
}

// ----------------------------------------------------------------- auto-close

export const AUTOCLOSE_TABLE = "applicant_autoclose";

export type AutoCloseSummary = {
  ok: boolean;
  dryRun: boolean;
  held?: string;
  considered: number;
  eligible: number;
  closed: number;
  failed: number;
  channels: { email_only: number; email_and_sms: number; sms_only: number; none: number };
  skipped: Record<string, number>;
  samples: { contact: ReturnType<typeof redactContact>; daysSinceLastMessage: number; email: { subject: string; body: string } | null; sms: string | null }[];
};

const latest = (a: string | null | undefined, b: string | null | undefined) => (!a ? b ?? null : !b ? a : a > b ? a : b);

/**
 * Close (status "closed", never "declined") applicants who did not respond
 * within autoCloseDays of their last missing-items message, and send one
 * "come back anytime" message with their resume link. Opening that link
 * reopens the application where they left off (reopenAutoClosed).
 * Automations switch "missing_items_autoclose", Off by default.
 */
export async function runMissingItemsAutoClose(
  admin: any,
  opts: { dryRun?: boolean; limit?: number; sampleCount?: number } = {},
  deps: OutreachDeps = {},
): Promise<AutoCloseSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const dryRun = opts.dryRun === true;
  const out: AutoCloseSummary = { ok: true, dryRun, considered: 0, eligible: 0, closed: 0, failed: 0, channels: { email_only: 0, email_and_sms: 0, sms_only: 0, none: 0 }, skipped: {}, samples: [] };
  const settings = await loadOutreachSettings(admin);
  if (!settings) return { ...out, ok: false, held: "settings_unreadable" };
  if (!dryRun) {
    const gate = await (deps.gate ?? defaultGate)(admin, MISSING_ITEMS_AUTOCLOSE_KEY);
    if (gate !== "send") return { ...out, held: gate === "off" ? "switched_off" : "controls_unreadable" };
    const h = easternHour(now);
    if (h < settings.smsHours[0] || h >= settings.smsHours[1]) return { ...out, held: "outside_sending_hours" };
  }

  // Only applicants we have messaged can be auto-closed.
  const { data: logRows, error: logErr } = await admin.from(OUTREACH_LOG_TABLE).select("application_id,missing_key,step,source,created_at").limit(10000);
  if (logErr) return { ...out, ok: false, held: "log_unreadable" };
  const logBy = new Map<string, OutreachLogRow[]>();
  for (const r of (logRows ?? []) as any[]) (logBy.get(r.application_id) ?? logBy.set(r.application_id, []).get(r.application_id)!).push(r);
  const ids = [...logBy.keys()];
  if (!ids.length) return out;

  const apps = (await readIn(admin, "applications", APP_COLUMNS, "id", ids, (q) => q.in("status", settings.statuses).is("deleted_at", null))) as OutreachApp[];
  out.considered = apps.length;
  const appIds = apps.map((a) => a.id);
  const minLast = new Date(now.getTime() - 400 * 86_400_000).toISOString();
  const [docs, enroll, screens, opt, tokens, docsNew, quo, inbound] = appIds.length
    ? await Promise.all([
        readIn(admin, "documents", "driver_id,category,review_status,is_current", "driver_id", appIds, (q) => q.in("category", ["license_front", "gig_profile", "income", "trip_history"])),
        readIn(admin, "automation_enrollments", "application_id", "application_id", appIds, (q) => q.eq("status", "active")),
        readIn(admin, "driver_screenings", "lead_id,disqualified", "lead_id", appIds, (q) => q.eq("disqualified", true)),
        admin.from("sms_opt_outs").select("phone").limit(5000).then((r: any) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; }),
        readIn(admin, "application_resume_tokens", "application_id,last_used_at", "application_id", appIds),
        readIn(admin, "documents", "driver_id,created_at", "driver_id", appIds),
        readIn(admin, "quo_events", "application_id,direction,created_at", "application_id", appIds),
        admin.from("outbound_messages").select("to_address,created_at,kind").like("kind", "inbound_%").gte("created_at", minLast).limit(10000)
          .then((r: any) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; }),
      ])
    : [[], [], [], [], [], [], [], []];

  const docsBy = new Map<string, any[]>();
  for (const d of docs as any[]) (docsBy.get(d.driver_id) ?? docsBy.set(d.driver_id, []).get(d.driver_id)!).push(d);
  const enrolled = new Set((enroll as any[]).map((r) => r.application_id));
  const dq = new Set((screens as any[]).map((r) => r.lead_id));
  const optedOut = new Set<string>((opt as any[]).map((r) => toUsE164(r.phone)).filter(Boolean) as string[]);
  const response = new Map<string, string | null>();
  const bump = (id: string, at: string | null | undefined) => response.set(id, latest(response.get(id) ?? null, at ?? null));
  for (const t of tokens as any[]) bump(t.application_id, t.last_used_at);
  for (const d of docsNew as any[]) bump(d.driver_id, d.created_at);
  for (const q of quo as any[]) if (String(q.direction ?? "").toLowerCase() !== "outgoing") bump(q.application_id, q.created_at);
  const inboundBy = new Map<string, string>();
  for (const m of inbound as any[]) {
    const e = toUsE164(m.to_address);
    if (e) inboundBy.set(e, latest(inboundBy.get(e) ?? null, m.created_at) as string);
  }

  const plan: { app: OutreachApp; email: boolean; sms: boolean; lastMessageAt: string }[] = [];
  for (const a of apps) {
    const e = toUsE164(a.phone);
    const last = latest(response.get(a.id) ?? null, e ? inboundBy.get(e) ?? null : null);
    const d = decideAutoClose({
      app: a, items: missingItems(a, docsBy.get(a.id) ?? []), log: logBy.get(a.id) ?? [], lastResponseAt: last,
      activeEnrollment: enrolled.has(a.id), disqualified: dq.has(a.id), optedOut, now, settings,
    });
    if (!d.close) { out.skipped[d.reason] = (out.skipped[d.reason] ?? 0) + 1; continue; }
    plan.push({ app: a, email: d.email && settings.email, sms: d.sms && settings.sms, lastMessageAt: d.lastMessageAt });
  }
  out.eligible = plan.length;
  const batch = dryRun ? plan : plan.slice(0, Math.max(1, Math.min(opts.limit ?? settings.batchLimit, 200)));
  for (const p of batch) out.channels[p.email && p.sms ? "email_and_sms" : p.email ? "email_only" : p.sms ? "sms_only" : "none"]++;

  if (dryRun) {
    out.samples = batch.slice(0, Math.max(0, opts.sampleCount ?? 2)).map((p) => {
      const v = { firstName: "[First Name]", link: PREVIEW_LINK, companyPhone: "(888) 833-8280" };
      return { contact: redactContact(p.app), daysSinceLastMessage: Math.floor((now.getTime() - Date.parse(p.lastMessageAt)) / 86_400_000), email: p.email ? comeBackEmail(v) : null, sms: p.sms ? comeBackSms(v) : null };
    });
    return out;
  }

  const phone = await (deps.companyPhone ?? (async (a: any) => (await (await import("@/lib/company.server")).getBusinessPhone(a)).display))(admin);
  for (const p of batch) {
    try {
      if (await closeOne(admin, p, phone, deps)) out.closed++;
    } catch (e) {
      out.failed++;
      console.error("[missing-items] auto-close failed", p.app.id, e);
    }
  }
  return out;
}

async function closeOne(admin: any, p: { app: OutreachApp; email: boolean; sms: boolean; lastMessageAt: string }, companyPhone: string, deps: OutreachDeps): Promise<boolean> {
  const prior = String(p.app.status ?? "").toLowerCase();
  // Claim first: one open auto-close per application (unique index).
  const claim = await admin.from(AUTOCLOSE_TABLE)
    .insert({ application_id: p.app.id, prior_status: prior, last_message_at: p.lastMessageAt, channels: [] })
    .select("id").maybeSingle();
  if (claim.error) {
    if (String(claim.error.code) === "23505") return false;
    throw new Error(claim.error.message);
  }
  const claimId = claim.data?.id;
  // Only if nobody changed the status meanwhile.
  const upd = await admin.from("applications").update({ status: "closed" }).eq("id", p.app.id).eq("status", p.app.status).select("id").maybeSingle();
  if (upd.error || !upd.data) {
    if (claimId) await admin.from(AUTOCLOSE_TABLE).delete().eq("id", claimId);
    if (upd.error) throw new Error(upd.error.message);
    return false;
  }
  const channels: string[] = [];
  const errors: string[] = [];
  try {
    const link = await (deps.mintLink ?? defaultMintLink)(admin, p.app.id);
    const v = { firstName: firstNameOf(p.app.full_name), link, companyPhone };
    const { sendRenterEmail, sendRenterSms } = await import("@/lib/driver-contacts.server");
    if (p.email) {
      const { subject, body } = comeBackEmail(v);
      const { renderAutomationEmailHtml } = await import("@/lib/automations.server");
      const send = deps.sendEmail ?? (async (a) => (await import("@/lib/email.server")).sendEmail(a));
      const mail = await sendRenterEmail({
        admin, applicationId: p.app.id, subject, html: renderAutomationEmailHtml(body, link),
        track: { workflow: MISSING_ITEMS_AUTOCLOSE_WORKFLOW }, sendEmail: send, app: p.app,
      });
      if (mail.sent > 0) {
        channels.push("email");
        for (const to of mail.targets) {
          await admin.from("outbound_messages").insert({ channel: "email", to_address: to, subject, body, status: "sent", provider: "resend", kind: MISSING_ITEMS_AUTOCLOSE_KIND, application_id: p.app.id });
        }
      } else if (mail.targets.length) errors.push("email: failed");
    }
    if (p.sms) {
      const send = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a));
      const texts = await sendRenterSms({ admin, applicationId: p.app.id, body: comeBackSms(v), kind: MISSING_ITEMS_AUTOCLOSE_KIND, sendSms: send, app: p.app });
      if (texts.sent > 0) channels.push("sms");
      else if (texts.targets.length) errors.push(`sms: ${texts.results[0]?.reason ?? texts.results[0]?.error ?? "failed"}`);
    }
  } catch (e) {
    errors.push(`link: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (claimId) await admin.from(AUTOCLOSE_TABLE).update({ channels, error: errors.join("; ") || null }).eq("id", claimId);
  void COME_BACK_SUBJECT;
  return true;
}

/**
 * The applicant came back through their link: put an auto-closed application
 * back to the status it had, so they pick up where they left off. Only undoes
 * OUR close (a staff close or decline is never reopened). Never throws.
 */
export async function reopenAutoClosed(admin: any, applicationId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { data: claim, error } = await admin.from(AUTOCLOSE_TABLE).select("id,prior_status").eq("application_id", applicationId).is("reopened_at", null).maybeSingle();
    if (error || !claim) return false;
    const prior = ["new", "reviewing"].includes(String(claim.prior_status)) ? claim.prior_status : "new";
    const { data: row } = await admin.from("applications").update({ status: prior }).eq("id", applicationId).eq("status", "closed").select("id").maybeSingle();
    await admin.from(AUTOCLOSE_TABLE).update({ reopened_at: now.toISOString(), reopened: Boolean(row) }).eq("id", claim.id);
    return Boolean(row);
  } catch (e) {
    console.error("[missing-items] reopen failed", e);
    return false;
  }
}

// ------------------------------------------------------------- FLEET endpoint

/**
 * POST /api/public/fleet/missing-items (Bearer FLEET_API_KEY)
 *   { "action": "preview", "mode": "backfill" | "ongoing" }  dry run: counts and
 *       3 redacted sample messages, plus who auto-close would close today.
 *       Sends nothing, writes nothing.
 *   { "action": "backfill", "confirm": "send-once", "limit": 50 }  sends the
 *       one-time message to the next `limit` eligible existing applicants. Only
 *       when the Automations switch "Missing-Items Message (One-Time)" is On.
 *       Repeat until eligible is 0; nobody is ever messaged twice.
 */
export async function handleFleetMissingItems(
  request: Request,
  deps: OutreachDeps & { env?: Record<string, string | undefined>; admin?: any; audit?: (e: any) => Promise<unknown> } = {},
): Promise<Response> {
  const { fleetRequestBody, fleetAdmin, fleetJson, fleetAudit } = await import("@/lib/fleet-api.server");
  const parsed = await fleetRequestBody(request, deps as any);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  let admin: any;
  try {
    admin = await fleetAdmin(deps as any);
  } catch {
    return fleetJson(503, { ok: false, error: "Database unavailable." });
  }
  const action = String(body.action ?? "preview");
  if (action === "preview") {
    const mode = body.mode === "ongoing" ? "ongoing" : "backfill";
    const r = await runMissingItemsOutreach(admin, { mode, dryRun: true }, deps);
    const autoClose = await runMissingItemsAutoClose(admin, { dryRun: true }, deps).catch(() => null);
    return fleetJson(r.ok ? 200 : 503, { ...r, autoClose });
  }
  if (action !== "backfill") return fleetJson(400, { ok: false, error: 'action must be "preview" or "backfill".' });
  if (body.confirm !== "send-once") return fleetJson(400, { ok: false, error: 'Send confirm: "send-once" to run the one-time message.' });
  const limit = body.limit == null ? 50 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return fleetJson(400, { ok: false, error: "limit must be 1 to 200." });
  const r = await runMissingItemsOutreach(admin, { mode: "backfill", limit }, deps);
  if (r.held) return fleetJson(409, { ...r, ok: false, error: `Not sent: ${r.held}.` });
  await fleetAudit(deps as any)({
    action: "applicant.missing_items_backfill",
    summary: `Missing-items message sent to ${r.sent} applicant(s) (FLEET (automated))`,
    entityType: "application",
    entityId: null,
    metadata: { sent: r.sent, failed: r.failed, planned: r.planned, eligible: r.eligible },
  });
  return fleetJson(200, r);
}
