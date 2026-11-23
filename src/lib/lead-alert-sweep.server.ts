/**
 * Lead-alert sweep (runs inside the every-5-minute automations cron).
 *
 * A lead_alert row still at "sending" after 10 minutes means its request was
 * cut off. For each one:
 *   1. If Resend's webhook already landed as an "unmatched" row for the same
 *      recipient within a minute of it, the alert DID go out: link the two.
 *   2. Otherwise claim the row (sending -> failed, "Not Sent: request ended
 *      before send. Resent once by the sweep.") and send the alert again.
 *      The claim is a guarded update, so two overlapping runs cannot both
 *      resend; the new row carries meta.retry_of and is never resent itself.
 *      The resend reuses the alert's Resend idempotency key, so if the first
 *      attempt did reach Resend it is not delivered twice.
 * Rows older than 23 hours are only marked, never resent (Resend keeps the
 * idempotency key for 24 hours).
 *
 * Inert until migration 20261122200000 adds email_deliveries.meta: the
 * select names that column, and a missing column returns { inert }.
 */
import { isMissingColumnError } from "@/lib/db-errors";

export const LEAD_ALERT_STUCK_MINUTES = 10;
export const LEAD_ALERT_RESEND_MAX_HOURS = 23;
export const NOT_SENT_REASON = "Not Sent: request ended before send";
export const RESENT_REASON = `${NOT_SENT_REASON}. Resent once by the sweep.`;

type Admin = any;
type LeadAlertSend = (args: any) => Promise<void>;

export type LeadAlertSweepReport = {
  inert?: "migration_pending" | "read_failed";
  checked: number;
  linked: number;
  resent: number;
  markedOnly: number;
  skipped: number;
};

const APP_COLS = "id,full_name,phone,email,city,state,market_id,pickup_date,platforms,sms_consent,source,deleted_at";

export async function sweepStuckLeadAlerts(
  admin: Admin,
  deps: { now?: Date; send?: LeadAlertSend; limit?: number } = {},
): Promise<LeadAlertSweepReport> {
  const now = deps.now ?? new Date();
  const report: LeadAlertSweepReport = { checked: 0, linked: 0, resent: 0, markedOnly: 0, skipped: 0 };
  const stuckBefore = new Date(now.getTime() - LEAD_ALERT_STUCK_MINUTES * 60_000).toISOString();
  const { data: rows, error } = await admin
    .from("email_deliveries")
    .select("id,recipient,subject,meta,created_at")
    .eq("workflow", "lead_alert")
    .eq("state", "sending")
    .is("resend_message_id", null)
    .lt("created_at", stuckBefore)
    .order("created_at", { ascending: true })
    .limit(deps.limit ?? 20);
  if (error) {
    if (isMissingColumnError(error)) return { ...report, inert: "migration_pending" };
    console.error("[lead-alert-sweep] read failed", error.message ?? error);
    return { ...report, inert: "read_failed" };
  }

  for (const row of rows ?? []) {
    report.checked++;
    try {
      const outcome = await handleStuckRow(admin, row, now, deps.send);
      report[outcome]++;
    } catch (err) {
      console.error("[lead-alert-sweep] row failed", row.id, err);
      report.skipped++;
    }
  }
  return report;
}

async function handleStuckRow(
  admin: Admin,
  row: { id: string; recipient: string; subject: string | null; meta: any; created_at: string },
  now: Date,
  send: LeadAlertSend | undefined,
): Promise<"linked" | "resent" | "markedOnly" | "skipped"> {
  // 1. Did it actually go out? Resend's webhook leaves an "unmatched" row.
  const created = new Date(row.created_at);
  const { data: unmatched, error: uErr } = await admin
    .from("email_deliveries")
    .select("id,recipient,resend_message_id,created_at")
    .eq("workflow", "unmatched")
    .gte("created_at", created.toISOString())
    .lte("created_at", new Date(created.getTime() + 60_000).toISOString());
  if (uErr) return "skipped";
  const same = (unmatched ?? []).filter(
    (u: any) => u.resend_message_id && String(u.recipient ?? "").toLowerCase() === String(row.recipient ?? "").toLowerCase(),
  );
  if (same.length === 1) {
    const { error } = await admin.rpc("email_delivery_attach", { _id: row.id, _resend_id: same[0].resend_message_id });
    return error ? "skipped" : "linked";
  }
  if (same.length > 1) return "skipped"; // ambiguous: leave it for a person

  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  const tooOld = now.getTime() - created.getTime() > LEAD_ALERT_RESEND_MAX_HOURS * 3_600_000;
  const resendable = !meta.retry_of && !tooOld && typeof meta.applicationId === "string" && (meta.event === "new" || meta.event === "complete");

  // 2. Claim it. Only the run whose update matches the still-"sending" row goes on.
  const nowIso = now.toISOString();
  const { data: claimed, error: cErr } = await admin
    .from("email_deliveries")
    .update({
      state: "failed",
      failed_at: nowIso,
      updated_at: nowIso,
      provider_reason: resendable ? RESENT_REASON : NOT_SENT_REASON,
      meta: { ...meta, swept_at: nowIso, ...(resendable ? { resent_at: nowIso } : {}) },
    })
    .eq("id", row.id)
    .eq("state", "sending")
    .is("resend_message_id", null)
    .select("id");
  if (cErr || !claimed?.length) return "skipped";
  if (!resendable) return "markedOnly";

  const { data: app } = await admin.from("applications").select(APP_COLS).eq("id", meta.applicationId).maybeSingle();
  if (!app || app.deleted_at) return "markedOnly";
  let market: string | null = null;
  if (app.market_id) {
    const { data: m } = await admin.from("markets").select("name").eq("id", app.market_id).maybeSingle();
    market = m?.name ?? null;
  }
  const doSend = send ?? (await import("@/lib/email.server")).sendLeadAlertEmail;
  await doSend({
    event: meta.event,
    applicationId: app.id,
    full_name: app.full_name ?? null,
    phone: app.phone ?? null,
    email: app.email ?? null,
    city: app.city ?? null,
    state: app.state ?? null,
    market,
    pickup_date: app.pickup_date ?? null,
    return_date: null,
    platforms: meta.event === "complete" && Array.isArray(app.platforms) ? app.platforms : null,
    sms_consent: app.sms_consent ?? null,
    source: app.source ?? null,
    retryOf: row.id,
  });
  return "resent";
}
