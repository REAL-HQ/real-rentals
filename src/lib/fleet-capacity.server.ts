/**
 * Server side of fleet capacity and the approved-applicant waitlist.
 *
 * Side effects (holds, notices, team alerts, FLEET webhooks) fail closed and
 * never block the write that triggered them. Customer emails and texts are
 * gated by the Automations switch `waitlist_joined_notice` (default OFF).
 * Staff alerts and the vehicle_available webhook are gated by
 * team_alerts.vehicle_available (default OFF).
 *
 * Proposed schema: proposed/capacity-waitlist-v1.sql. Missing columns or
 * tables are tolerated: we retry without them or skip the queued send.
 */
import {
  WAITLIST_JOINED_AUTOMATION_KEY,
  WAITLIST_JOINED_EMAIL_WORKFLOW,
  WAITLIST_JOINED_SMS_KIND,
  assignQueuePositions,
  countFleetCapacity,
  nextTextingWindowStart,
  vehicleAvailableAlertCopy,
  vehicleAvailablePayload,
  waitlistJoinedEmailHtml,
  waitlistJoinedPlain,
  type QueueCandidate,
  type WaitlistWebhookEntry,
} from "@/lib/fleet-capacity";
import { withinTextingHours } from "@/lib/failed-payment-link";

type Admin = any;

export type ApprovedWaitlistEntry = {
  applicationId: string;
  fullName: string;
  status: string | null;
  addedAt: string;
  approvedAt: string | null;
  source: string | null;
  position: number;
  smsConsent: boolean;
};

const MISSING = /does not exist|schema cache|42703|PGRST204/i;

export async function readFleetCapacity(admin: Admin): Promise<number | null> {
  try {
    const { data: vehicles, error } = await admin
      .from("vehicles")
      .select("id,status,archived_at")
      .is("archived_at", null);
    if (error || !Array.isArray(vehicles)) return null;
    const ids = vehicles.filter((v: any) => String(v.status ?? "").toLowerCase() === "available").map((v: any) => v.id);
    let busy: string[] = [];
    if (ids.length) {
      const rentals = await admin.from("rentals").select("vehicle_id").in("vehicle_id", ids).eq("status", "active");
      if (rentals.error) return null;
      busy = ((rentals.data ?? []) as { vehicle_id: string | null }[]).map((r) => r.vehicle_id).filter(Boolean) as string[];
    }
    return countFleetCapacity(vehicles, busy);
  } catch (e) {
    console.error("[capacity-waitlist] count failed", (e as Error)?.message ?? e);
    return null;
  }
}

export async function listApprovedWaitlist(admin: Admin): Promise<ApprovedWaitlistEntry[]> {
  const { data: holds, error } = await admin
    .from("application_waitlist_holds")
    .select("id,application_id,added_at,source")
    .is("removed_at", null);
  let rows = holds as any[] | null;
  if (error && MISSING.test(String(error.message ?? "") + String(error.code ?? ""))) {
    const fallback = await admin
      .from("application_waitlist_holds")
      .select("id,application_id,added_at")
      .is("removed_at", null);
    if (fallback.error || !Array.isArray(fallback.data)) return [];
    rows = fallback.data;
  } else if (error || !Array.isArray(rows)) {
    return [];
  }
  if (!rows || !rows.length) return [];
  const ids = rows.map((r) => r.application_id);
  const { data: apps, error: aErr } = await admin
    .from("applications")
    .select("id,full_name,status,created_at,approved_at,sms_consent,deleted_at")
    .in("id", ids)
    .is("deleted_at", null);
  let appRows = apps as any[] | null;
  if (aErr && MISSING.test(String(aErr.message ?? "") + String(aErr.code ?? ""))) {
    const fallback = await admin
      .from("applications")
      .select("id,full_name,status,created_at,sms_consent,deleted_at")
      .in("id", ids)
      .is("deleted_at", null);
    if (fallback.error || !Array.isArray(fallback.data)) return [];
    appRows = fallback.data;
  } else if (aErr || !Array.isArray(appRows)) {
    return [];
  }
  if (!appRows) return [];
  const byId = new Map(appRows.map((a) => [a.id, a]));
  const candidates: (QueueCandidate & { fullName: string; status: string | null; source: string | null; smsConsent: boolean; addedAt: string; approvedAt: string | null })[] = [];
  for (const h of rows) {
    const a = byId.get(h.application_id);
    if (!a) continue;
    candidates.push({
      id: a.id,
      approvedAt: a.approved_at ?? null,
      addedAt: h.added_at,
      createdAt: a.created_at ?? null,
      fullName: a.full_name ?? "Applicant",
      status: a.status ?? null,
      source: h.source ?? null,
      smsConsent: a.sms_consent === true,
    });
  }
  const positions = new Map(assignQueuePositions(candidates).map((p) => [p.id, p.position]));
  return candidates
    .map((c) => ({
      applicationId: c.id,
      fullName: c.fullName,
      status: c.status,
      addedAt: c.addedAt,
      approvedAt: c.approvedAt,
      source: c.source,
      position: positions.get(c.id) ?? 0,
      smsConsent: c.smsConsent,
    }))
    .sort((a, b) => a.position - b.position);
}

export type CapacityEffectResult = {
  capacityBefore: number | null;
  capacityAfter: number | null;
  enrolled: number;
  released: number;
  opened: boolean;
};

/**
 * After a vehicle or rental write: if capacity is 0, enroll approved
 * applicants; if it just left 0, alert Rosa and FLEET (when that switch is on).
 * After a rental becomes active, drop that applicant from the queue.
 */
export async function applyCapacitySideEffects(
  admin: Admin,
  opts: {
    vehicleId?: string | null;
    applicationId?: string | null;
    capacityBefore?: number | null;
    now?: Date;
    /** Close this applicant's hold (rental activated, declined, etc.). */
    releaseApplicationId?: string | null;
  } = {},
): Promise<CapacityEffectResult> {
  const now = opts.now ?? new Date();
  const out: CapacityEffectResult = {
    capacityBefore: opts.capacityBefore ?? null,
    capacityAfter: null,
    enrolled: 0,
    released: 0,
    opened: false,
  };
  if (opts.releaseApplicationId) {
    out.released = await releaseHold(admin, opts.releaseApplicationId);
  }
  const after = await readFleetCapacity(admin);
  out.capacityAfter = after;
  if (after === 0) {
    out.enrolled = await enrollApprovedApplicants(admin, { now });
  }
  const before = opts.capacityBefore;
  if (before === 0 && after != null && after > 0) {
    out.opened = true;
    await notifyCarAvailable(admin, { vehicleId: opts.vehicleId ?? null, now });
  }
  return out;
}

export function scheduleCapacitySideEffects(
  admin: Admin,
  opts: Parameters<typeof applyCapacitySideEffects>[1] = {},
): void {
  void applyCapacitySideEffects(admin, opts).catch((e) =>
    console.error("[capacity-waitlist] side effects failed", (e as Error)?.message ?? e),
  );
}

/** Eligible: approved, not deleted, no active rental, not already held. */
export async function enrollApprovedApplicants(
  admin: Admin,
  opts: { now?: Date; onlyApplicationId?: string } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  let q = admin
    .from("applications")
    .select("id,full_name,status,created_at,approved_at,sms_consent,email,phone,deleted_at")
    .eq("status", "approved")
    .is("deleted_at", null);
  if (opts.onlyApplicationId) q = q.eq("id", opts.onlyApplicationId);
  let { data: apps, error } = await q;
  if (error && MISSING.test(String(error.message ?? "") + String(error.code ?? ""))) {
    let q2 = admin
      .from("applications")
      .select("id,full_name,status,created_at,sms_consent,email,phone,deleted_at")
      .eq("status", "approved")
      .is("deleted_at", null);
    if (opts.onlyApplicationId) q2 = q2.eq("id", opts.onlyApplicationId);
    const fallback = await q2;
    if (fallback.error || !Array.isArray(fallback.data)) return 0;
    apps = fallback.data;
  } else if (error || !Array.isArray(apps)) {
    return 0;
  }
  if (!apps.length) return 0;

  const ids = apps.map((a: any) => a.id);
  const [holds, rentals] = await Promise.all([
    admin.from("application_waitlist_holds").select("application_id").in("application_id", ids).is("removed_at", null),
    admin.from("rentals").select("application_id").in("application_id", ids).eq("status", "active"),
  ]);
  if (holds.error || rentals.error) return 0;
  const held = new Set(((holds.data ?? []) as { application_id: string }[]).map((h) => h.application_id));
  const renting = new Set(((rentals.data ?? []) as { application_id: string | null }[]).map((r) => r.application_id).filter(Boolean) as string[]);

  const added: string[] = [];
  for (const app of apps) {
    if (held.has(app.id) || renting.has(app.id)) continue;
    const inserted = await insertHold(admin, app.id, now);
    if (!inserted) continue;
    added.push(app.id);
    held.add(app.id);
  }
  if (added.length) {
    const queue = await listApprovedWaitlist(admin);
    const just = new Set(added);
    for (const entry of queue) {
      if (just.has(entry.applicationId)) await queueJoinedNotices(admin, entry, now);
    }
  }
  return added.length;
}

async function insertHold(admin: Admin, applicationId: string, now: Date): Promise<boolean> {
  const withSource = await admin.from("application_waitlist_holds").insert({
    application_id: applicationId,
    added_at: now.toISOString(),
    source: "auto_capacity",
  });
  if (!withSource.error) return true;
  if (String(withSource.error.code) === "23505") return false;
  if (!MISSING.test(String(withSource.error.message ?? "") + String(withSource.error.code ?? ""))) {
    console.error("[capacity-waitlist] hold insert failed", withSource.error.message);
    return false;
  }
  const plain = await admin.from("application_waitlist_holds").insert({
    application_id: applicationId,
    added_at: now.toISOString(),
  });
  if (plain.error) {
    if (String(plain.error.code) === "23505") return false;
    console.error("[capacity-waitlist] hold insert failed", plain.error.message);
    return false;
  }
  return true;
}

async function releaseHold(admin: Admin, applicationId: string): Promise<number> {
  const { data, error } = await admin
    .from("application_waitlist_holds")
    .update({ removed_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .is("removed_at", null)
    .select("id");
  if (error) {
    console.error("[capacity-waitlist] hold release failed", error.message);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function queueJoinedNotices(admin: Admin, entry: ApprovedWaitlistEntry, now: Date): Promise<void> {
  const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
  const gate = gateFor(await loadAutomationControls(admin), WAITLIST_JOINED_AUTOMATION_KEY);
  if (gate !== "send") return;
  const whenSms = nextTextingWindowStart(now);
  await enqueueNotice(admin, {
    applicationId: entry.applicationId,
    channel: "email",
    position: entry.position,
    scheduledFor: now,
  });
  if (entry.smsConsent) {
    await enqueueNotice(admin, {
      applicationId: entry.applicationId,
      channel: "sms",
      position: entry.position,
      scheduledFor: whenSms,
    });
  }
  // Try to send anything already due (email now; SMS if inside hours).
  await processWaitlistNotices(admin, { now, applicationId: entry.applicationId });
}

async function enqueueNotice(
  admin: Admin,
  row: { applicationId: string; channel: "email" | "sms"; position: number; scheduledFor: Date },
): Promise<void> {
  const { error } = await admin.from("waitlist_notice_jobs").insert({
    application_id: row.applicationId,
    kind: "joined",
    channel: row.channel,
    position: row.position,
    scheduled_for: row.scheduledFor.toISOString(),
  });
  if (error && String(error.code) === "23505") return;
  if (error && MISSING.test(String(error.message ?? "") + String(error.code ?? ""))) {
    // Migration not applied: send immediately only when the send is due now.
    return;
  }
  if (error) console.error("[capacity-waitlist] notice enqueue failed", error.message);
}

export async function processWaitlistNotices(
  admin: Admin,
  opts: { now?: Date; applicationId?: string; sendEmail?: typeof sendJoinedEmail; sendSms?: typeof sendJoinedSms } = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const out = { sent: 0, failed: 0, skipped: 0 };
  const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
  const gate = gateFor(await loadAutomationControls(admin), WAITLIST_JOINED_AUTOMATION_KEY);
  if (gate !== "send") return { ...out, skipped: 1 };

  let q = admin
    .from("waitlist_notice_jobs")
    .select("id,application_id,channel,position,scheduled_for")
    .eq("kind", "joined")
    .is("sent_at", null)
    .lte("scheduled_for", now.toISOString());
  if (opts.applicationId) q = q.eq("application_id", opts.applicationId);
  const { data: jobs, error } = await q.limit(50);
  if (error) {
    if (!MISSING.test(String(error.message ?? "") + String(error.code ?? ""))) {
      console.error("[capacity-waitlist] notice read failed", error.message);
    }
    return out;
  }
  if (!Array.isArray(jobs) || !jobs.length) return out;

  const sendEmail = opts.sendEmail ?? sendJoinedEmail;
  const sendSms = opts.sendSms ?? sendJoinedSms;
  for (const job of jobs) {
    if (job.channel === "sms" && !withinTextingHours(now)) {
      await admin
        .from("waitlist_notice_jobs")
        .update({ scheduled_for: nextTextingWindowStart(now).toISOString() })
        .eq("id", job.id)
        .is("sent_at", null);
      out.skipped += 1;
      continue;
    }
    const ok = job.channel === "email"
      ? await sendEmail(admin, job.application_id, job.position)
      : await sendSms(admin, job.application_id, job.position);
    if (ok) {
      await admin.from("waitlist_notice_jobs").update({ sent_at: now.toISOString(), error: null }).eq("id", job.id);
      out.sent += 1;
    } else {
      await admin.from("waitlist_notice_jobs").update({ error: "send_failed" }).eq("id", job.id);
      out.failed += 1;
    }
  }
  return out;
}

async function sendJoinedEmail(admin: Admin, applicationId: string, position: number): Promise<boolean> {
  const { data: app } = await admin.from("applications").select("id,full_name,email").eq("id", applicationId).maybeSingle();
  if (!app?.email) return false;
  const { sendEmail } = await import("@/lib/email.server");
  const { getBusinessPhone } = await import("@/lib/company.server");
  const companyPhone = (await getBusinessPhone(admin)).display;
  const msg = waitlistJoinedEmailHtml({ fullName: app.full_name, position, companyPhone });
  try {
    const res = await sendEmail({
      to: app.email,
      subject: msg.subject,
      html: msg.html,
      track: { workflow: WAITLIST_JOINED_EMAIL_WORKFLOW },
      idempotencyKey: `waitlist-joined:${applicationId}`,
    });
    return !!res?.ok;
  } catch (e) {
    console.error("[capacity-waitlist] joined email failed", (e as Error)?.message ?? e);
    return false;
  }
}

async function sendJoinedSms(admin: Admin, applicationId: string, position: number): Promise<boolean> {
  const { data: app } = await admin
    .from("applications")
    .select("id,phone,sms_consent")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app?.phone || app.sms_consent !== true) return false;
  const { sendSms } = await import("@/lib/sms.server");
  try {
    const res = await sendSms({
      to: app.phone,
      body: waitlistJoinedPlain(position),
      kind: WAITLIST_JOINED_SMS_KIND,
      applicationId,
      requireConsent: true,
    });
    return !!res?.ok;
  } catch (e) {
    console.error("[capacity-waitlist] joined sms failed", (e as Error)?.message ?? e);
    return false;
  }
}

export async function notifyCarAvailable(
  admin: Admin,
  opts: { vehicleId: string | null; now?: Date } = { vehicleId: null },
): Promise<{ alert: string; webhook: string | null }> {
  const queue = await listApprovedWaitlist(admin);
  const waitlist: WaitlistWebhookEntry[] = queue.map((e) => ({
    lead_id: e.applicationId,
    position: e.position,
    name: e.fullName,
  }));
  let label = "A car";
  if (opts.vehicleId) {
    const { data: v } = await admin
      .from("vehicles")
      .select("unit_number,year,make,model")
      .eq("id", opts.vehicleId)
      .maybeSingle();
    if (v) {
      const bits = [v.unit_number, [v.year, v.make, v.model].filter(Boolean).join(" ")].filter(Boolean);
      label = bits.join(" — ") || label;
    }
  }
  const copy = vehicleAvailableAlertCopy({ vehicleLabel: label, count: waitlist.length, waitlist });
  const site = String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
  const link = `${site}/admin?tab=drivers&filter=waitlist`;
  const dedupe = `${opts.vehicleId ?? "fleet"}:${(opts.now ?? new Date()).toISOString().slice(0, 16)}`;

  const { loadTeamAlertSettings, sendTeamAlert } = await import("@/lib/team-alerts.server");
  const settings = await loadTeamAlertSettings(admin);
  const alertOut = await sendTeamAlert(admin, {
    kind: "vehicle_available",
    dedupeKey: dedupe,
    title: copy.title,
    status: copy.status,
    lines: copy.lines,
    link,
    vehicleId: opts.vehicleId,
  });

  let webhookId: string | null = null;
  if (settings.vehicle_available && opts.vehicleId) {
    const { enqueueFleetEvent, dispatchFleetWebhooks } = await import("@/lib/fleet-webhook.server");
    webhookId = await enqueueFleetEvent(admin, {
      event_type: "vehicle_available",
      dedupe_key: `vehicle_available:${dedupe}`,
      payload: vehicleAvailablePayload(opts.vehicleId, waitlist),
    });
    if (webhookId) {
      try { await dispatchFleetWebhooks(admin, { ids: [webhookId] }, { timeoutMs: 5000 }); } catch (e) {
        console.error("[capacity-waitlist] webhook dispatch failed", (e as Error)?.message ?? e);
      }
    }
  }
  return { alert: alertOut.status, webhook: webhookId };
}

/** Stamp applications.approved_at when the column exists. Never blocks approval. */
export async function stampApprovedAt(admin: Admin, applicationId: string, at: Date = new Date()): Promise<void> {
  const { error } = await admin.from("applications").update({ approved_at: at.toISOString() }).eq("id", applicationId).is("approved_at", null);
  if (error && !MISSING.test(String(error.message ?? "") + String(error.code ?? ""))) {
    console.error("[capacity-waitlist] approved_at stamp failed", error.message);
  }
}
