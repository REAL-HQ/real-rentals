import { createFileRoute } from "@tanstack/react-router";
import {
  sendEmail,
  sendLicenseExpiringEmail,
  sendServiceDigestEmail,
  sendTeamPaymentAlertEmail,
  sendTeamCollectionsPlanEmail,
} from "@/lib/email.server";
import {
  UNPAID_STATUSES,
  UPCOMING_STATUSES,
  TEAM_INBOX,
  addDays,
  daysBetween,
  followUpStage,
} from "@/lib/payment-reminders";
import {
  buildCollectionsPlan,
  collectionsPlanBellBody,
  collectionsPlanKind,
  type CollectionsPlanPayment,
  type CollectionsPlanRental,
} from "@/lib/collections-plan";

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

  // Back Office → Automations switches, read fresh for this run. A switched-off
  // reminder is skipped before its dedupe row or bell notification is written,
  // so turning it back on sends only what is owed that day — never a replay.
  const { loadAutomationControls } = await import("@/lib/automation-controls.server");
  const { isAutomationOn } = await import("@/lib/automation-catalog");
  const controls = await loadAutomationControls(supabaseAdmin, true);
  // Unreadable or malformed switches: send nothing and fail the run, so an
  // Owner's Off can never leak and the failure is visible. Retried next run.
  if (controls.status === "error") {
    console.error("[ops-reminders] automation settings unreadable; nothing sent");
    return new Response("automation settings unreadable; nothing sent", { status: 503 });
  }
  // Renter Due Tomorrow / Past Due emails were removed; Rent Reminders own
  // those stages. Team Payment Alert, Collections Plan, and the other ops
  // jobs below are unchanged.
  const on = (key: string) => isAutomationOn(controls.value, key);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrowStr = addDays(today, 1);
  const since = new Date(today.getTime() - 6 * 24 * 3600 * 1000).toISOString(); // license / agreement reminders: 1 per 6 days

  let pastDue = 0;
  let teamPastDue = 0;
  let dueTomorrow = 0;
  let licenses = 0;
  let collectionsPlanSent = 0;

  // ---- 1. Team past-due alerts (renter Past Due email removed) ---------------
  // Cadence uses payment-reminders followUpStage so the team is only alerted
  // on the same day-1 / 3 / 7 / weekly schedule. Rent Reminders own renter mail.
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
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", appId)
        .maybeSingle();
      if (!app) continue;

      // First time this balance shows up past due: tell the team once.
      const teamKind = `payment_team_past_due:${info.dueDate}`;
      if (on("payment_team_alert") && !(await alreadySent(supabaseAdmin, app.id, teamKind))) {
        const sentTeam = await sendTeamPaymentAlertEmail({
          event: "past_due", driverName: app.full_name, amount: info.amount,
          applicationId: app.id, dueDate: info.dueDate, daysLate,
        });
        if (sentTeam.blocked) continue;
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


  // ---- 1c. Team Collections Plan (due today / due tomorrow) -----------------
  // Independent of renter emails. Reconciles active rental next_payment_due
  // with unpaid/upcoming payment rows so a charge is listed once. Method is
  // autopay/Stripe when linked, else last recorded payment_method, else
  // "Not specified" — never assumed to be Zelle.
  try {
    const planKind = collectionsPlanKind(todayStr);
    const alreadyPlan = on("collections_plan") ? await teamDigestAlreadySent(supabaseAdmin, planKind) : true;
    if (!alreadyPlan) {
      const { data: dueRentals } = await supabaseAdmin
        .from("rentals")
        .select("id,application_id,status,next_payment_due,weekly_rate,autopay_active,stripe_subscription_id,stripe_payment_method_id,vehicle_id,driver_id")
        .eq("status", "active")
        .in("next_payment_due", [todayStr, tomorrowStr])
        .limit(300);

      const rentalRows = (dueRentals ?? []) as Array<Record<string, unknown>>;
      const vehicleIds = [...new Set(rentalRows.map((r) => r.vehicle_id).filter(Boolean))] as string[];
      const appIds = [...new Set(rentalRows.map((r) => r.application_id || r.driver_id).filter(Boolean))] as string[];

      const vehicleById = new Map<string, { label: string; plate: string | null }>();
      if (vehicleIds.length) {
        const { data: vehicles } = await supabaseAdmin
          .from("vehicles")
          .select("id,year,make,model,license_plate,unit_number")
          .in("id", vehicleIds)
          .limit(300);
        for (const v of vehicles ?? []) {
          const title = [v.year, v.make, v.model].filter(Boolean).join(" ");
          const unit = v.unit_number ? `Unit ${v.unit_number}` : null;
          const label = [unit, title || null].filter(Boolean).join(" · ") || "Vehicle";
          vehicleById.set(v.id as string, { label, plate: (v.license_plate as string | null) ?? null });
        }
      }
      const appById = new Map<string, string | null>();
      if (appIds.length) {
        const { data: apps } = await supabaseAdmin
          .from("applications")
          .select("id,full_name")
          .in("id", appIds)
          .limit(300);
        for (const a of apps ?? []) appById.set(a.id as string, (a.full_name as string | null) ?? null);
      }

      const planRentals: CollectionsPlanRental[] = rentalRows.map((r) => {
        const appId = (r.application_id as string | null) || (r.driver_id as string | null);
        const vehicle = r.vehicle_id ? vehicleById.get(r.vehicle_id as string) : undefined;
        return {
          id: r.id as string,
          applicationId: appId,
          status: String(r.status ?? ""),
          nextPaymentDue: (r.next_payment_due as string | null) ?? null,
          weeklyRate: r.weekly_rate == null ? null : Number(r.weekly_rate),
          autopayActive: !!r.autopay_active,
          stripeSubscriptionId: (r.stripe_subscription_id as string | null) ?? null,
          stripePaymentMethodId: (r.stripe_payment_method_id as string | null) ?? null,
          driverName: appId ? appById.get(appId) ?? null : null,
          vehicleLabel: vehicle?.label ?? null,
          plate: vehicle?.plate ?? null,
        };
      });

      const { data: duePayRows } = await supabaseAdmin
        .from("payments")
        .select("id,rental_id,driver_id,due_date,amount,balance_due,status,payment_method,type")
        .in("due_date", [todayStr, tomorrowStr])
        .in("status", [...UNPAID_STATUSES, ...UPCOMING_STATUSES])
        .limit(400);

      const payAppIds = [...new Set((duePayRows ?? []).map((p) => p.driver_id).filter(Boolean))] as string[];
      const missingApps = payAppIds.filter((id) => !appById.has(id));
      if (missingApps.length) {
        const { data: moreApps } = await supabaseAdmin
          .from("applications")
          .select("id,full_name")
          .in("id", missingApps)
          .limit(300);
        for (const a of moreApps ?? []) appById.set(a.id as string, (a.full_name as string | null) ?? null);
      }

      const planPayments: CollectionsPlanPayment[] = (duePayRows ?? []).map((p) => ({
        id: p.id as string,
        rentalId: (p.rental_id as string | null) ?? null,
        driverId: (p.driver_id as string | null) ?? null,
        dueDate: (p.due_date as string | null) ?? null,
        amount: p.amount == null ? null : Number(p.amount),
        balanceDue: p.balance_due == null ? null : Number(p.balance_due),
        status: String(p.status ?? ""),
        paymentMethod: (p.payment_method as string | null) ?? null,
        type: (p.type as string | null) ?? null,
        driverName: p.driver_id ? appById.get(p.driver_id as string) ?? null : null,
        vehicleLabel: null,
        plate: null,
      }));

      // Last recorded method for rentals / drivers appearing on the plan.
      const methodRentalIds = [...new Set([
        ...planRentals.map((r) => r.id),
        ...planPayments.map((p) => p.rentalId).filter(Boolean) as string[],
      ])];
      const methodDriverIds = [...new Set([
        ...planRentals.map((r) => r.applicationId).filter(Boolean) as string[],
        ...planPayments.map((p) => p.driverId).filter(Boolean) as string[],
      ])];
      const lastMethodByRentalId: Record<string, string | null> = {};
      const lastMethodByDriverId: Record<string, string | null> = {};
      if (methodRentalIds.length || methodDriverIds.length) {
        let methodQuery = supabaseAdmin
          .from("payments")
          .select("rental_id,driver_id,payment_method,paid_date,status")
          .eq("status", "paid")
          .not("payment_method", "is", null)
          .order("paid_date", { ascending: false })
          .limit(500);
        const { data: methodRows } = await methodQuery;
        for (const row of methodRows ?? []) {
          const method = (row.payment_method as string | null) ?? null;
          if (!method) continue;
          const rid = row.rental_id as string | null;
          const did = row.driver_id as string | null;
          if (rid && methodRentalIds.includes(rid) && lastMethodByRentalId[rid] === undefined) {
            lastMethodByRentalId[rid] = method;
          }
          if (did && methodDriverIds.includes(did) && lastMethodByDriverId[did] === undefined) {
            lastMethodByDriverId[did] = method;
          }
        }
      }

      const plan = buildCollectionsPlan({
        today: todayStr,
        tomorrow: tomorrowStr,
        rentals: planRentals,
        unpaidPayments: planPayments,
        lastMethodByRentalId,
        lastMethodByDriverId,
      });

      if (plan.dueToday.length || plan.dueTomorrow.length) {
        const sentPlan = await sendTeamCollectionsPlanEmail({
          today: plan.today,
          tomorrow: plan.tomorrow,
          dueToday: plan.dueToday,
          dueTomorrow: plan.dueTomorrow,
        });
        if (sentPlan.blocked) throw new Error("collections plan stopped by automation switch; not recorded");
        await supabaseAdmin.from("outbound_messages").insert({
          channel: "email",
          to_address: TEAM_INBOX,
          subject: "Collections Plan — Due Today / Due Tomorrow",
          body: collectionsPlanBellBody(plan),
          status: "sent",
          provider: "resend",
          kind: planKind,
          application_id: null,
          sent_at: new Date().toISOString(),
        });
        await supabaseAdmin.from("notifications").insert({
          kind: "collections_plan",
          title: "Collections Plan",
          body: collectionsPlanBellBody(plan),
          read: false,
        });
        collectionsPlanSent = 1;
      } else {
        // Still record the kind so an empty day does not re-query-spam Resend
        // if the cron retries; no email and no bell for an empty plan.
        await supabaseAdmin.from("outbound_messages").insert({
          channel: "email",
          to_address: TEAM_INBOX,
          subject: "Collections Plan — empty",
          body: "No payments due today or tomorrow.",
          status: "skipped",
          provider: "resend",
          kind: planKind,
          application_id: null,
          sent_at: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.error("[ops-reminders] collections plan failed", err);
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
    if (!on("license_expiring")) break;
    try {
      if (!app.email) continue;
      if (await recentlyNotified(supabaseAdmin, app.id, "license_expiring", since)) continue;
      const daysLeft = Math.round(
        (new Date(app.license_expiration as string).getTime() - today.getTime()) / 86400000,
      );
      const sentLicense = await sendLicenseExpiringEmail({
        to: app.email,
        firstName: app.full_name,
        expiration: app.license_expiration as string,
        daysLeft,
      });
      if (sentLicense.blocked) continue;
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

  if (serviceItems.length && on("service_digest")) {
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
    if (!on("agreement_reminder")) break;
    try {
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", a.application_id as string)
        .maybeSingle();
      const to = (a.signer_email as string | null) || app?.email;
      if (!to) continue;
      if (await recentlyNotified(supabaseAdmin, app?.id ?? null, "agreement_reminder", since)) continue;

      const sentAgreement = await sendEmail({
        to,
        track: { workflow: "agreement_reminder" },
        subject: "Reminder: Your REAL RENTALS Agreement Is Ready To Sign",
        html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px">
          <h1 style="font-size:20px;color:#111">Your rental agreement is still waiting</h1>
          <p style="color:#444;font-size:15px;line-height:1.55">Hi ${(app?.full_name || "there").split(" ")[0]}, we still need your signature before we can hand over the keys. Sign in to your driver portal to review and sign.</p>
          <a href="https://drivereal.com/portal" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Review &amp; Sign</a>
          <p style="color:#888;font-size:12px;margin-top:20px">Need a fresh link? Reply to this email and our team will send one.</p>
        </div>`,
      });
      if (sentAgreement.blocked) continue;
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
  if (docItems.length && on("service_digest")) {
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
    collections_plan_sent: collectionsPlanSent,
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


async function teamDigestAlreadySent(db: any, kind: string): Promise<boolean> {
  const { data } = await db
    .from("outbound_messages")
    .select("id")
    .eq("kind", kind)
    .eq("to_address", TEAM_INBOX)
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
