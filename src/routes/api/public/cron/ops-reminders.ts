import { createFileRoute } from "@tanstack/react-router";
import {
  sendEmail,
  sendPastDueReminderEmail,
  sendLicenseExpiringEmail,
  sendServiceDigestEmail,
  sendPaymentDueTomorrowEmail,
  sendTeamPaymentAlertEmail,
} from "@/lib/email.server";
import {
  UNPAID_STATUSES,
  UPCOMING_STATUSES,
  TEAM_INBOX,
  addDays,
  daysBetween,
  followUpStage,
  reminderKind,
} from "@/lib/payment-reminders";

export const Route = createFileRoute("/api/public/cron/ops-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const authHeader = request.headers.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const { data: expectedToken, error: tokenErr } = await supabaseAdmin.rpc("get_cron_token", {
    _name: "ops-reminders",
  });
  if (tokenErr || !expectedToken) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expectedToken) return new Response("unauthorized", { status: 401 });

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const since = new Date(today.getTime() - 6 * 24 * 3600 * 1000).toISOString(); // license / agreement reminders: 1 per 6 days

  let pastDue = 0;
  let teamPastDue = 0;
  let dueTomorrow = 0;
  let licenses = 0;

  // ---- 1. Past-due follow-ups (day 1 / 3 / 7 / weekly) ----------------------
  // Cadence + dedupe live in payment-reminders.ts. Each stage is sent once per
  // application + earliest unpaid due date; paid / waived / void rows are not
  // in UNPAID_STATUSES, so the sequence stops the run after payment clears or
  // staff marks the charge handled.
  const { data: duePayments } = await supabaseAdmin
    .from("payments")
    .select("id,driver_id,amount,balance_due,due_date,status")
    .lt("due_date", todayStr)
    .not("driver_id", "is", null)
    .in("status", [...UNPAID_STATUSES])
    .limit(200);

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

  for (const [appId, info] of byDriver) {
    try {
      if (!info.dueDate) continue;
      const daysLate = daysBetween(info.dueDate, today);
      const stage = followUpStage(daysLate);
      if (!stage) continue;
      const kind = reminderKind(stage, info.dueDate);
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", appId)
        .maybeSingle();
      if (!app?.email) continue;
      if (await alreadySent(supabaseAdmin, app.id, kind)) continue;

      await sendPastDueReminderEmail({
        to: app.email,
        firstName: app.full_name,
        amount: info.amount,
        dueDate: info.dueDate,
        daysLate,
      });
      await logNotification(
        supabaseAdmin, app.id, app.user_id, app.email,
        kind, "Balance Past Due", `$${info.amount.toFixed(2)} is past due.`,
      );
      pastDue++;

      // First time this balance shows up past due: tell the team once.
      const teamKind = `payment_team_past_due:${info.dueDate}`;
      if (!(await alreadySent(supabaseAdmin, app.id, teamKind))) {
        await sendTeamPaymentAlertEmail({
          event: "past_due", driverName: app.full_name, amount: info.amount,
          applicationId: app.id, dueDate: info.dueDate, daysLate,
        });
        await logNotification(supabaseAdmin, app.id, null, TEAM_INBOX, teamKind, "Team: Payment Past Due", app.full_name ?? app.id);
        await supabaseAdmin.from("notifications").insert({
          kind: "payment_past_due",
          title: "Payment Past Due",
          body: `${app.full_name || "Renter"} — $${info.amount.toFixed(2)}, ${daysLate} day${daysLate === 1 ? "" : "s"} late`,
          read: false,
        });
        teamPastDue++;
      }
    } catch (err) {
      console.error("[ops-reminders] past-due send failed", appId, err);
    }
  }

  // ---- 1b. Day-before-due reminders ----------------------------------------
  const tomorrowStr = addDays(today, 1);
  const { data: upcoming } = await supabaseAdmin
    .from("payments")
    .select("id,driver_id,amount,balance_due,due_date,status")
    .eq("due_date", tomorrowStr)
    .not("driver_id", "is", null)
    .in("status", [...UPCOMING_STATUSES])
    .limit(200);
  const upcomingByDriver = new Map<string, number>();
  for (const p of upcoming ?? []) {
    const owed = Number(p.balance_due ?? 0) || Number(p.amount ?? 0);
    if (owed <= 0) continue;
    upcomingByDriver.set(p.driver_id as string, (upcomingByDriver.get(p.driver_id as string) ?? 0) + owed);
  }
  for (const [appId, amount] of upcomingByDriver) {
    try {
      const kind = reminderKind("due_tomorrow", tomorrowStr);
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", appId)
        .maybeSingle();
      if (!app?.email) continue;
      if (await alreadySent(supabaseAdmin, app.id, kind)) continue;
      const { data: rental } = await supabaseAdmin
        .from("rentals")
        .select("autopay_active")
        .eq("application_id", app.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      await sendPaymentDueTomorrowEmail({
        to: app.email, firstName: app.full_name, amount, dueDate: tomorrowStr,
        autopay: !!(rental as { autopay_active?: boolean } | null)?.autopay_active,
      });
      await logNotification(
        supabaseAdmin, app.id, app.user_id, app.email,
        kind, "Payment Due Tomorrow", `$${amount.toFixed(2)} is due ${tomorrowStr}.`,
      );
      dueTomorrow++;
    } catch (err) {
      console.error("[ops-reminders] day-before send failed", appId, err);
    }
  }

  // ---- 2. License expiring within 30 days -----------------------------------
  const in30 = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: expiring } = await supabaseAdmin
    .from("applications")
    .select("id,full_name,email,user_id,license_expiration,status")
    .not("license_expiration", "is", null)
    .lte("license_expiration", in30)
    .in("status", ["approved", "active"])
    .limit(200);

  for (const app of expiring ?? []) {
    try {
      if (!app.email) continue;
      if (await recentlyNotified(supabaseAdmin, app.id, "license_expiring", since)) continue;
      const daysLeft = Math.round(
        (new Date(app.license_expiration as string).getTime() - today.getTime()) / 86400000,
      );
      await sendLicenseExpiringEmail({
        to: app.email,
        firstName: app.full_name,
        expiration: app.license_expiration as string,
        daysLeft,
      });
      await logNotification(
        supabaseAdmin, app.id, app.user_id, app.email,
        "license_expiring", "License Expiring", `Expires ${app.license_expiration}.`,
      );
      licenses++;
    } catch (err) {
      console.error("[ops-reminders] license send failed", app.id, err);
    }
  }

  // ---- 3. Service-due digest to ops -----------------------------------------
  const { data: vehicles } = await supabaseAdmin
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
    if (v.last_tire_date && monthsSince(v.last_tire_date) >= 6) reasons.push("Tire check overdue");
    if (v.last_brake_inspection_date && monthsSince(v.last_brake_inspection_date) >= 12) {
      reasons.push("Brake inspection overdue");
    }
    if (reasons.length) serviceItems.push({ vehicle: label, reason: reasons.join(" · ") });
  }

  if (serviceItems.length) {
    try {
      await sendServiceDigestEmail({ to: "team@drivereal.com", items: serviceItems });
    } catch (err) {
      console.error("[ops-reminders] service digest failed", err);
    }
  }

  // ---- 4. Unsigned rental agreements ---------------------------------------
  let agreementNudges = 0;
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const { data: openAgreements } = await supabaseAdmin
    .from("agreements")
    .select("id,title,application_id,signer_email,sent_at,status")
    .in("status", ["sent", "viewed"])
    .lt("sent_at", threeDaysAgo)
    .gt("token_expires_at", today.toISOString())
    .limit(100);

  for (const a of openAgreements ?? []) {
    try {
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", a.application_id as string)
        .maybeSingle();
      const to = (a.signer_email as string | null) || app?.email;
      if (!to) continue;
      if (await recentlyNotified(supabaseAdmin, app?.id ?? null, "agreement_reminder", since)) continue;

      await sendEmail({
        to,
        subject: "Reminder: Sign Your REAL RENTALS Rental Agreement",
        html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px">
          <h1 style="font-size:20px;color:#111">Your rental agreement is still waiting</h1>
          <p style="color:#444;font-size:15px;line-height:1.55">Hi ${(app?.full_name || "there").split(" ")[0]}, we still need your signature before we can hand over the keys. Sign in to your driver portal to review and sign.</p>
          <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; Sign</a>
          <p style="color:#888;font-size:12px;margin-top:20px">Need a fresh link? Reply to this email and our team will send one.</p>
        </div>`,
      });
      await logNotification(
        supabaseAdmin,
        app?.id ?? null,
        app?.user_id ?? null,
        to,
        "agreement_reminder",
        "Rental agreement awaiting signature",
        "We sent you a reminder to sign your rental agreement.",
      );
      agreementNudges++;
    } catch (err) {
      console.error("[ops-reminders] agreement reminder failed", err);
    }
  }

  // ---- 5. Expiring driver documents (ops digest) ---------------------------
  const docHorizon = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: expiringDocs } = await supabaseAdmin
    .from("documents")
    .select("id,category,label,expires_at,driver_id")
    .eq("is_current", true)
    .not("expires_at", "is", null)
    .lte("expires_at", docHorizon)
    .limit(100);

  const docItems: Array<{ vehicle: string; reason: string }> = [];
  for (const d of expiringDocs ?? []) {
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("full_name")
      .eq("id", d.driver_id as string)
      .maybeSingle();
    docItems.push({
      vehicle: (app?.full_name as string) || "Driver",
      reason: `${String(d.label || d.category).replace(/_/g, " ")} expires ${d.expires_at}`,
    });
  }
  if (docItems.length) {
    try {
      await sendServiceDigestEmail({ to: "team@drivereal.com", items: docItems });
    } catch (err) {
      console.error("[ops-reminders] document expiry digest failed", err);
    }
  }

  return Response.json({
    ok: true,
    past_due_sent: pastDue,
    team_past_due_alerts: teamPastDue,
    due_tomorrow_sent: dueTomorrow,
    license_sent: licenses,
    service_due: serviceItems.length,
    agreement_reminders: agreementNudges,
    expiring_documents: docItems.length,
  });
}

function monthsSince(date: string): number {
  return (Date.now() - new Date(date).getTime()) / (30.44 * 86400000);
}

// Dedupe against the outbound message log rather than in-app notifications.
// notifications.driver_id is an auth user id, so an applicant who has not yet
// created a portal login had no dedupe record at all and was re-emailed on
// every single cron run. outbound_messages is keyed by application, which
// every reminder recipient has.
async function recentlyNotified(
  db: any,
  applicationId: string | null,
  kind: string,
  since: string,
): Promise<boolean> {
  if (!applicationId) return false;
  const { data } = await db
    .from("outbound_messages")
    .select("id")
    .eq("application_id", applicationId)
    .eq("kind", kind)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length);
}

// Stage-keyed dedupe: a given reminder kind is sent once, ever.
async function alreadySent(db: any, applicationId: string, kind: string): Promise<boolean> {
  const { data } = await db
    .from("outbound_messages")
    .select("id")
    .eq("application_id", applicationId)
    .eq("kind", kind)
    .limit(1);
  return !!(data && data.length);
}

async function logNotification(
  db: any,
  applicationId: string | null,
  userId: string | null,
  toAddress: string,
  kind: string,
  title: string,
  body: string,
) {
  // The message log is what dedupes the next run, so it is always written.
  await db.from("outbound_messages").insert({
    channel: "email",
    to_address: toAddress,
    subject: title,
    body,
    status: "sent",
    provider: "resend",
    kind,
    application_id: applicationId,
    sent_at: new Date().toISOString(),
  });
  // The in-app alert only applies to drivers who actually have a login.
  if (userId) {
    await db.from("notifications").insert({ driver_id: userId, kind, title, body, channels: ["email"] });
  }
}
