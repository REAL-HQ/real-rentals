import { createFileRoute } from "@tanstack/react-router";
import {
  sendPastDueReminderEmail,
  sendLicenseExpiringEmail,
  sendServiceDigestEmail,
} from "@/lib/email.server";

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
  const since = new Date(today.getTime() - 6 * 24 * 3600 * 1000).toISOString(); // 1 reminder per driver per 6 days

  let pastDue = 0;
  let licenses = 0;

  // ---- 1. Past-due balances -------------------------------------------------
  const { data: duePayments } = await supabaseAdmin
    .from("payments")
    .select("id,driver_id,amount,balance_due,due_date,status")
    .lt("due_date", todayStr)
    .not("driver_id", "is", null)
    .in("status", ["pending", "overdue", "past_due", "unpaid"])
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
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,full_name,email,user_id")
        .eq("id", appId)
        .maybeSingle();
      if (!app?.email) continue;
      if (await recentlyNotified(supabaseAdmin, app.user_id, "past_due", since)) continue;

      const daysLate = info.dueDate
        ? Math.max(1, Math.round((today.getTime() - new Date(info.dueDate).getTime()) / 86400000))
        : 1;
      await sendPastDueReminderEmail({
        to: app.email,
        firstName: app.full_name,
        amount: info.amount,
        dueDate: info.dueDate,
        daysLate,
      });
      await logNotification(supabaseAdmin, app.user_id, "past_due", "Balance Past Due", `$${info.amount.toFixed(2)} is past due.`);
      pastDue++;
    } catch (err) {
      console.error("[ops-reminders] past-due send failed", appId, err);
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
      if (await recentlyNotified(supabaseAdmin, app.user_id, "license_expiring", since)) continue;
      const daysLeft = Math.round(
        (new Date(app.license_expiration as string).getTime() - today.getTime()) / 86400000,
      );
      await sendLicenseExpiringEmail({
        to: app.email,
        firstName: app.full_name,
        expiration: app.license_expiration as string,
        daysLeft,
      });
      await logNotification(supabaseAdmin, app.user_id, "license_expiring", "License Expiring", `Expires ${app.license_expiration}.`);
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

  return Response.json({
    ok: true,
    past_due_sent: pastDue,
    license_sent: licenses,
    service_due: serviceItems.length,
  });
}

function monthsSince(date: string): number {
  return (Date.now() - new Date(date).getTime()) / (30.44 * 86400000);
}

async function recentlyNotified(db: any, userId: string | null, kind: string, since: string): Promise<boolean> {
  if (!userId) return false;
  const { data } = await db
    .from("notifications")
    .select("id")
    .eq("driver_id", userId)
    .eq("kind", kind)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length);
}

async function logNotification(db: any, userId: string | null, kind: string, title: string, body: string) {
  if (!userId) return;
  await db.from("notifications").insert({ driver_id: userId, kind, title, body, channels: ["email"] });
}
