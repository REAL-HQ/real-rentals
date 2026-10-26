import type { SendResult } from "@/lib/email.server";

/*
 * The daily ops reminders: past-due balances, expiring licences and unsigned
 * rental agreements (driver emails), plus the service-due and expiring-document
 * digests to the team inbox.
 *
 * Who is eligible is unchanged from the route this replaced (same statuses,
 * windows, limits and 6-day spacing per driver per kind). What changed is how a
 * send is recorded, so that two overlapping runs (a retry, a manual call, a slow
 * run) cannot both email the same driver, and so that one run can never email
 * the whole backlog at once.
 *
 * 1. Claim before sending. The outbound_messages row that dedupes the next run
 *    is written BEFORE the email (status 'queued'), then the runner reads back
 *    every other row for the same driver and kind in the 6-day window. If there
 *    is any, it deletes its own row and does not send. Each request is its own
 *    committed transaction, so of two claimers the one that reads second always
 *    sees the other's row: both cannot see none, so both cannot send. Both may
 *    back off (each sees the other); then nobody is emailed this run, and the
 *    next run tries again. Sending first and logging after, which this replaced,
 *    let overlapping runs email the same driver twice.
 *
 * 2. Delivery is at most once. The claim is released (its own row deleted, by
 *    id) only when the send definitely did not happen: the sender threw before
 *    reaching the provider, or the provider refused outright. An uncertain
 *    outcome (timeout, 5xx, 409) keeps the row, so the 6-day spacing still
 *    holds: a second email is worse than a missed reminder.
 *
 * 3. Bounded. At most MAX_DRIVER_EMAILS_PER_RUN driver claims per run, and the
 *    same number per rolling DRIVER_BUDGET_WINDOW_HOURS across every run (see
 *    recentDriverReminderClaims). Each team digest is claimed the same way, at
 *    most once per UTC day.
 */

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

/** At most this many driver reminder claims (and so emails) per run, across all three kinds. */
export const MAX_DRIVER_EMAILS_PER_RUN = 10;
/**
 * The same 10 also bounds every run together: after each claim the runner counts this
 * route's driver claims from the last 24 hours (its own and any concurrent, retried or
 * manual run's, all committed) and, if there are more than 10, releases its own claim
 * unsent and stops. A claim that goes on to send saw at most 10 claims after its own
 * commit, so runs cannot together send more than 10 in 24 hours. Over-counting (a
 * concurrent claim that later backs off) only makes it stricter.
 */
export const DRIVER_BUDGET_WINDOW_HOURS = 24;
/** One reminder per driver per kind per 6 days (unchanged). */
export const REMINDER_SPACING_DAYS = 6;

export const DRIVER_REMINDER_KINDS = ["past_due", "license_expiring", "agreement_reminder"] as const;
export type DriverReminderKind = (typeof DRIVER_REMINDER_KINDS)[number];
/** outbound_messages kinds for the two team digests (one row per digest per UTC day). */
export const DIGEST_KINDS = { service: "ops_service_digest", documents: "ops_documents_digest" } as const;
export type DigestKind = (typeof DIGEST_KINDS)[keyof typeof DIGEST_KINDS];

export const OPS_TEAM_INBOX = "team@drivereal.com";
export const PAST_DUE_STATUSES = ["pending", "failed", "overdue", "past_due", "unpaid", "late"] as const;
export const LICENSE_STATUSES = ["approved", "active"] as const;
export const AGREEMENT_OPEN_STATUSES = ["sent", "viewed"] as const;
/** email_deliveries workflow names (email.server.ts) for each send this runner makes. */
export const OPS_REMINDER_WORKFLOWS = {
  past_due: "payment_past_due",
  license_expiring: "license_expiring",
  agreement_reminder: "esign_signing_reminder",
  digest: "service_digest",
} as const;

export type OpsRemindersDeps = {
  sendPastDueReminderEmail: (args: {
    to: string;
    firstName: string | null;
    amount: number;
    dueDate: string | null;
    daysLate: number;
  }) => Promise<SendResult | void>;
  sendLicenseExpiringEmail: (args: {
    to: string;
    firstName: string | null;
    expiration: string;
    daysLeft: number;
  }) => Promise<SendResult | void>;
  sendServiceDigestEmail: (args: {
    to: string;
    items: Array<{ vehicle: string; reason: string }>;
  }) => Promise<SendResult | void>;
  sendEmail: (args: {
    to: string;
    subject: string;
    html: string;
    track?: { workflow: string };
  }) => Promise<SendResult | void>;
  now?: () => number;
  log?: (message: string, ...rest: unknown[]) => void;
};

export type DriverCategoryReport = {
  considered: number;
  sent: number;
  failed: number;
  capped: number;
  /** Already reminded within 6 days (read before claiming). */
  skipped_recent: number;
  /** Another run's claim (or a row written meanwhile) won; this run did not send. */
  skipped_claimed: number;
  skipped_no_email: number;
};
export type DigestReport = { items: number; sent: number; failed: number; skipped_today: number };

export type OpsRemindersReport = {
  ok: true;
  past_due: DriverCategoryReport;
  license_expiring: DriverCategoryReport;
  agreement_reminder: DriverCategoryReport;
  service_digest: DigestReport;
  documents_digest: DigestReport;
  driver_claims: number;
  budget_reached: boolean;
  max_driver_emails_per_run: number;
  budget_window_hours: number;
  // The route's earlier report fields, kept for anything that reads them.
  past_due_sent: number;
  license_sent: number;
  service_due: number;
  agreement_reminders: number;
  expiring_documents: number;
};

const emptyCategory = (): DriverCategoryReport => ({
  considered: 0, sent: 0, failed: 0, capped: 0, skipped_recent: 0, skipped_claimed: 0, skipped_no_email: 0,
});
const emptyDigest = (): DigestReport => ({ items: 0, sent: 0, failed: 0, skipped_today: 0 });

/** This route's driver reminder rows created since `sinceIso`; null when the count cannot be read. */
export async function recentDriverReminderClaims(admin: Admin, sinceIso: string): Promise<number | null> {
  const { data, count, error } = await (admin as any)
    .from("outbound_messages")
    .select("id", { count: "exact", head: true })
    .eq("channel", "email")
    .in("kind", [...DRIVER_REMINDER_KINDS])
    .gte("created_at", sinceIso);
  if (error) return null;
  if (typeof count === "number") return count;
  return Array.isArray(data) ? data.length : null;
}

/** Was this driver sent (or claimed for) this kind since `since`? null when it cannot be read. */
async function recentlyNotified(
  admin: Admin,
  applicationId: string,
  kind: DriverReminderKind,
  since: string,
): Promise<boolean | null> {
  const { data, error } = await (admin as any)
    .from("outbound_messages")
    .select("id")
    .eq("application_id", applicationId)
    .eq("kind", kind)
    .gte("created_at", since)
    .limit(1);
  if (error) return null;
  return !!(data && data.length);
}

/**
 * "taken" with contended=true means every other row was itself an unconfirmed claim
 * ('queued'), typically a concurrent run backing off at the same moment; the caller may
 * try again after a random pause (CLAIM_ATTEMPTS). Each attempt is a fresh claim with the
 * same proof, so retrying never weakens it.
 */
export type ClaimOutcome =
  | { status: "claimed"; id: string }
  | { status: "taken"; contended: boolean }
  | { status: "error"; error: string };

/** Attempts per claim when it collides only with other in-flight claims (both back off). */
export const CLAIM_ATTEMPTS = 3;
const backoff = () => new Promise((r) => setTimeout(r, 20 + Math.random() * 130));

/**
 * Write the dedupe row first, then make sure it is the only one. The read-back covers the
 * same kind for the same driver (application_id) or, for a digest (no driver), that digest.
 * Returns "taken" (own row deleted) when any other row for the same key exists.
 */
export async function claimOutboundRow(
  admin: Admin,
  row: { kind: string; applicationId: string | null; to: string; subject: string; body: string },
  sinceIso: string,
): Promise<ClaimOutcome> {
  const db = admin as any;
  const ins = await db
    .from("outbound_messages")
    .insert({
      channel: "email",
      to_address: row.to,
      subject: row.subject,
      body: row.body,
      status: "queued",
      provider: "resend",
      kind: row.kind,
      application_id: row.applicationId,
    })
    .select("id")
    .single();
  const id: string | undefined = ins?.data?.id;
  if (ins?.error || !id) return { status: "error", error: ins?.error?.message ?? "claim insert returned no id" };

  let q = db.from("outbound_messages").select("id,status").eq("kind", row.kind).gte("created_at", sinceIso).neq("id", id);
  q = row.applicationId ? q.eq("application_id", row.applicationId) : q.is("application_id", null);
  const { data: others, error } = await q.limit(20);
  if (error || !Array.isArray(others)) {
    // Fails closed: without the read-back this run cannot know it is alone.
    await releaseClaim(admin, id);
    return { status: "error", error: error?.message ?? "claim read-back failed" };
  }
  if (others.length > 0) {
    await releaseClaim(admin, id);
    return { status: "taken", contended: others.every((o: any) => o.status === "queued") };
  }
  return { status: "claimed", id };
}

/** Delete this run's own claim row (by id), only when its email was not sent. */
async function releaseClaim(admin: Admin, id: string): Promise<boolean> {
  const { error } = await (admin as any).from("outbound_messages").delete().eq("id", id).eq("status", "queued");
  return !error;
}

async function markSent(admin: Admin, id: string, providerId: string | undefined) {
  const { error } = await (admin as any)
    .from("outbound_messages")
    .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerId ?? null })
    .eq("id", id);
  return !error;
}

async function markUncertain(admin: Admin, id: string, message: string | undefined) {
  // Status stays 'queued' (the claim holds); the error says why it is unresolved.
  await (admin as any)
    .from("outbound_messages")
    .update({ error: `uncertain: ${(message ?? "no provider answer").slice(0, 300)}` })
    .eq("id", id);
}

/** Whether a send definitely did not reach the provider, so a later run may try again. */
function definitelyNotSent(result: SendResult | void | undefined, threw: boolean): boolean {
  if (threw) return true;
  if (!result) return false; // a void sender: assume it went
  return result.ok === false && result.uncertain !== true;
}

export function agreementReminderHtml(fullName: string | null | undefined): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px">
          <h1 style="font-size:20px;color:#111">Your rental agreement is still waiting</h1>
          <p style="color:#444;font-size:15px;line-height:1.55">Hi ${(fullName || "there").split(" ")[0]}, we still need your signature before we can hand over the keys. Sign in to your driver portal to review and sign.</p>
          <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; Sign</a>
          <p style="color:#888;font-size:12px;margin-top:20px">Need a fresh link? Reply to this email and our team will send one.</p>
        </div>`;
}

function monthsSince(date: string, now: number): number {
  return (now - new Date(date).getTime()) / (30.44 * 86400000);
}

export async function runOpsReminders(admin: Admin, deps: OpsRemindersDeps): Promise<OpsRemindersReport> {
  const log = deps.log ?? ((m: string, ...r: unknown[]) => console.error(m, ...r));
  const nowMs = (deps.now ?? Date.now)();
  const today = new Date(nowMs);
  const todayStr = today.toISOString().slice(0, 10);
  const since = new Date(nowMs - REMINDER_SPACING_DAYS * 24 * 3600 * 1000).toISOString();
  const dayStart = `${todayStr}T00:00:00.000Z`;
  const db = admin as any;

  const report: OpsRemindersReport = {
    ok: true,
    past_due: emptyCategory(),
    license_expiring: emptyCategory(),
    agreement_reminder: emptyCategory(),
    service_digest: emptyDigest(),
    documents_digest: emptyDigest(),
    driver_claims: 0,
    budget_reached: false,
    max_driver_emails_per_run: MAX_DRIVER_EMAILS_PER_RUN,
    budget_window_hours: DRIVER_BUDGET_WINDOW_HOURS,
    past_due_sent: 0,
    license_sent: 0,
    service_due: 0,
    agreement_reminders: 0,
    expiring_documents: 0,
  };

  /** Claim, send, and release only on a send that definitely did not happen. */
  async function claimAndSendDriver(
    kind: DriverReminderKind,
    cat: DriverCategoryReport,
    target: { applicationId: string; to: string; subject: string; body: string },
    send: () => Promise<SendResult | void>,
    after: () => Promise<void>,
  ): Promise<void> {
    let claim: ClaimOutcome = { status: "taken", contended: true };
    for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt++) {
      if (attempt > 1) await backoff();
      const recent = await recentlyNotified(admin, target.applicationId, kind, since);
      if (recent === null) {
        cat.failed++;
        log(`[ops-reminders] ${kind} spacing read failed`, target.applicationId);
        return;
      }
      if (recent) {
        cat.skipped_recent++;
        return;
      }
      // Past the cap: still due, not claimed, so a later run can reach it.
      if (report.budget_reached || report.driver_claims >= MAX_DRIVER_EMAILS_PER_RUN) {
        cat.capped++;
        return;
      }
      claim = await claimOutboundRow(admin, { kind, ...target }, since);
      if (claim.status !== "taken" || !claim.contended) break;
    }
    if (claim.status === "error") {
      cat.failed++;
      log(`[ops-reminders] ${kind} claim failed`, target.applicationId, claim.error);
      return;
    }
    if (claim.status === "taken") {
      cat.skipped_claimed++;
      return;
    }
    // Counted at the claim, before the send: a claim released later still counts,
    // so the cap can only lower a run's emails.
    report.driver_claims++;
    // Rolling 24h budget across runs. Fails closed: an unreadable count releases
    // this claim unsent and stops every further driver email in this run.
    const windowStart = new Date(Date.now() - DRIVER_BUDGET_WINDOW_HOURS * 3600 * 1000).toISOString();
    const claimed = await recentDriverReminderClaims(admin, windowStart);
    if (claimed === null || claimed > MAX_DRIVER_EMAILS_PER_RUN) {
      report.budget_reached = true;
      cat.capped++;
      log(`[ops-reminders] ${kind} 24h budget reached; claim released unsent`, target.applicationId, claimed);
      if (!(await releaseClaim(admin, claim.id))) log(`[ops-reminders] ${kind} claim release failed`, claim.id);
      return;
    }
    let result: SendResult | void | undefined;
    let threw = false;
    try {
      result = await send();
    } catch (err) {
      threw = true;
      log(`[ops-reminders] ${kind} send failed`, target.applicationId, err);
    }
    if (!threw && (!result || result.ok)) {
      if (!(await markSent(admin, claim.id, result ? result.id : undefined))) {
        log(`[ops-reminders] ${kind} could not mark sent (claim kept)`, claim.id);
      }
      cat.sent++;
      try {
        await after();
      } catch (err) {
        log(`[ops-reminders] ${kind} in-app notification failed`, target.applicationId, err);
      }
      return;
    }
    cat.failed++;
    if (!threw) log(`[ops-reminders] ${kind} provider did not accept`, target.applicationId, result?.error);
    if (definitelyNotSent(result, threw)) {
      if (!(await releaseClaim(admin, claim.id))) log(`[ops-reminders] ${kind} claim release failed`, claim.id);
    } else {
      await markUncertain(admin, claim.id, result?.error);
    }
  }

  /** A team digest: claimed once per UTC day, released only if definitely not sent. */
  async function claimAndSendDigest(
    kind: DigestKind,
    rep: DigestReport,
    items: Array<{ vehicle: string; reason: string }>,
  ): Promise<void> {
    rep.items = items.length;
    if (!items.length) return;
    const row = {
      kind,
      applicationId: null,
      to: OPS_TEAM_INBOX,
      subject: kind === DIGEST_KINDS.service ? "Service Due Digest" : "Expiring Documents Digest",
      body: `${items.length} item(s).`,
    };
    let claim: ClaimOutcome = { status: "taken", contended: true };
    for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt++) {
      if (attempt > 1) await backoff();
      claim = await claimOutboundRow(admin, row, dayStart);
      if (claim.status !== "taken" || !claim.contended) break;
    }
    if (claim.status === "error") {
      rep.failed++;
      log(`[ops-reminders] ${kind} claim failed`, claim.error);
      return;
    }
    if (claim.status === "taken") {
      rep.skipped_today++;
      return;
    }
    let result: SendResult | void | undefined;
    let threw = false;
    try {
      result = await deps.sendServiceDigestEmail({ to: OPS_TEAM_INBOX, items });
    } catch (err) {
      threw = true;
      log(`[ops-reminders] ${kind} send failed`, err);
    }
    if (!threw && (!result || result.ok)) {
      await markSent(admin, claim.id, result ? result.id : undefined);
      rep.sent++;
      return;
    }
    rep.failed++;
    if (definitelyNotSent(result, threw)) await releaseClaim(admin, claim.id);
    else await markUncertain(admin, claim.id, result?.error);
  }

  async function loadApp(id: string, cols: string) {
    const { data } = await db.from("applications").select(cols).eq("id", id).maybeSingle();
    return data as any;
  }

  // ---- 1. Past-due balances -------------------------------------------------
  const { data: duePayments, error: dueErr } = await db
    .from("payments")
    .select("id,driver_id,amount,balance_due,due_date,status")
    .lt("due_date", todayStr)
    .not("driver_id", "is", null)
    .in("status", [...PAST_DUE_STATUSES])
    .limit(200);
  if (dueErr) log("[ops-reminders] past-due query failed", dueErr.message);

  const byDriver = new Map<string, { amount: number; dueDate: string | null }>();
  for (const p of duePayments ?? []) {
    const owed = Number(p.balance_due ?? 0) || Number(p.amount ?? 0);
    if (owed <= 0) continue;
    const prev = byDriver.get(p.driver_id as string);
    byDriver.set(p.driver_id as string, {
      amount: (prev?.amount ?? 0) + owed,
      dueDate: prev?.dueDate && prev.dueDate < (p.due_date as string) ? prev.dueDate : (p.due_date as string | null),
    });
  }
  report.past_due.considered = byDriver.size;

  for (const [appId, info] of byDriver) {
    try {
      const app = await loadApp(appId, "id,full_name,email,user_id");
      if (!app?.email) {
        report.past_due.skipped_no_email++;
        continue;
      }
      const daysLate = info.dueDate
        ? Math.max(1, Math.round((today.getTime() - new Date(info.dueDate).getTime()) / 86400000))
        : 1;
      const title = "Balance Past Due";
      const body = `$${info.amount.toFixed(2)} is past due.`;
      await claimAndSendDriver(
        "past_due",
        report.past_due,
        { applicationId: app.id, to: app.email, subject: title, body },
        () =>
          deps.sendPastDueReminderEmail({
            to: app.email,
            firstName: app.full_name,
            amount: info.amount,
            dueDate: info.dueDate,
            daysLate,
          }),
        () => notifyInApp(admin, app.user_id, "past_due", title, body),
      );
    } catch (err) {
      report.past_due.failed++;
      log("[ops-reminders] past-due send failed", appId, err);
    }
  }

  // ---- 2. License expiring within 30 days -----------------------------------
  const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: expiring, error: expErr } = await db
    .from("applications")
    .select("id,full_name,email,user_id,license_expiration,status")
    .not("license_expiration", "is", null)
    .lte("license_expiration", in30)
    .in("status", [...LICENSE_STATUSES])
    .limit(200);
  if (expErr) log("[ops-reminders] licence query failed", expErr.message);
  report.license_expiring.considered = expiring?.length ?? 0;

  for (const app of expiring ?? []) {
    try {
      if (!app.email) {
        report.license_expiring.skipped_no_email++;
        continue;
      }
      const daysLeft = Math.round((new Date(app.license_expiration as string).getTime() - today.getTime()) / 86400000);
      const title = "License Expiring";
      const body = `Expires ${app.license_expiration}.`;
      await claimAndSendDriver(
        "license_expiring",
        report.license_expiring,
        { applicationId: app.id, to: app.email, subject: title, body },
        () =>
          deps.sendLicenseExpiringEmail({
            to: app.email,
            firstName: app.full_name,
            expiration: app.license_expiration as string,
            daysLeft,
          }),
        () => notifyInApp(admin, app.user_id, "license_expiring", title, body),
      );
    } catch (err) {
      report.license_expiring.failed++;
      log("[ops-reminders] license send failed", app.id, err);
    }
  }

  // ---- 3. Service-due digest to ops -----------------------------------------
  const { data: vehicles } = await db
    .from("vehicles")
    .select(
      "id,year,make,model,current_odometer,last_oil_change_miles,oil_interval_miles,last_tire_date,last_brake_inspection_date,status",
    )
    .neq("status", "retired")
    .limit(500);

  const serviceItems: Array<{ vehicle: string; reason: string }> = [];
  for (const v of vehicles ?? []) {
    const label = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
    const reasons: string[] = [];
    const odo = v.current_odometer;
    const lastOil = v.last_oil_change_miles;
    const interval = v.oil_interval_miles;
    if (odo != null && lastOil != null && interval && odo - lastOil >= interval) {
      reasons.push(`Oil due (${odo - lastOil} mi since last)`);
    }
    if (v.last_tire_date && monthsSince(v.last_tire_date, nowMs) >= 6) reasons.push("Tire check overdue");
    if (v.last_brake_inspection_date && monthsSince(v.last_brake_inspection_date, nowMs) >= 12) {
      reasons.push("Brake inspection overdue");
    }
    if (reasons.length) serviceItems.push({ vehicle: label, reason: reasons.join(" · ") });
  }
  report.service_due = serviceItems.length;
  try {
    await claimAndSendDigest(DIGEST_KINDS.service, report.service_digest, serviceItems);
  } catch (err) {
    report.service_digest.failed++;
    log("[ops-reminders] service digest failed", err);
  }

  // ---- 4. Unsigned rental agreements ---------------------------------------
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const { data: openAgreements, error: agErr } = await db
    .from("agreements")
    .select("id,title,application_id,signer_email,sent_at,status")
    .in("status", [...AGREEMENT_OPEN_STATUSES])
    .lt("sent_at", threeDaysAgo)
    .gt("token_expires_at", today.toISOString())
    .limit(100);
  if (agErr) log("[ops-reminders] agreement query failed", agErr.message);
  report.agreement_reminder.considered = openAgreements?.length ?? 0;

  for (const a of openAgreements ?? []) {
    try {
      const app = await loadApp(a.application_id as string, "id,full_name,email,user_id");
      const to = (a.signer_email as string | null) || app?.email;
      if (!to) {
        report.agreement_reminder.skipped_no_email++;
        continue;
      }
      // agreements.application_id is NOT NULL, so every reminder has a driver to space by.
      const applicationId = (app?.id as string | undefined) ?? (a.application_id as string);
      const title = "Rental agreement awaiting signature";
      const body = "We sent you a reminder to sign your rental agreement.";
      await claimAndSendDriver(
        "agreement_reminder",
        report.agreement_reminder,
        { applicationId, to, subject: title, body },
        () =>
          deps.sendEmail({
            to,
            subject: "Reminder: Sign Your REAL RENTALS Rental Agreement",
            html: agreementReminderHtml(app?.full_name),
            track: { workflow: OPS_REMINDER_WORKFLOWS.agreement_reminder },
          }),
        () => notifyInApp(admin, app?.user_id ?? null, "agreement_reminder", title, body),
      );
    } catch (err) {
      report.agreement_reminder.failed++;
      log("[ops-reminders] agreement reminder failed", err);
    }
  }

  // ---- 5. Expiring driver documents (ops digest) ---------------------------
  const docHorizon = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: expiringDocs } = await db
    .from("documents")
    .select("id,category,label,expires_at,driver_id")
    .eq("is_current", true)
    .not("expires_at", "is", null)
    .lte("expires_at", docHorizon)
    .limit(100);

  const docItems: Array<{ vehicle: string; reason: string }> = [];
  for (const d of expiringDocs ?? []) {
    const app = await loadApp(d.driver_id as string, "full_name");
    docItems.push({
      vehicle: (app?.full_name as string) || "Driver",
      reason: `${String(d.label || d.category).replace(/_/g, " ")} expires ${d.expires_at}`,
    });
  }
  report.expiring_documents = docItems.length;
  try {
    await claimAndSendDigest(DIGEST_KINDS.documents, report.documents_digest, docItems);
  } catch (err) {
    report.documents_digest.failed++;
    log("[ops-reminders] document expiry digest failed", err);
  }

  report.past_due_sent = report.past_due.sent;
  report.license_sent = report.license_expiring.sent;
  report.agreement_reminders = report.agreement_reminder.sent;
  return report;
}

/** The in-app alert only applies to drivers who actually have a login. */
async function notifyInApp(admin: Admin, userId: string | null, kind: string, title: string, body: string) {
  if (!userId) return;
  await (admin as any).from("notifications").insert({ driver_id: userId, kind, title, body, channels: ["email"] });
}
