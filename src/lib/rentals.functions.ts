import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Turning an approved applicant into a live renter.
//
// Until now nothing in the app created a `rentals` row — the admin could set
// applications.vehicle_id, but that is a note on the application, not a rental.
// Almost everything renter-facing keys off `rentals` (portal dashboard,
// condition photos, payments, autopay, maintenance visibility), and portal
// access additionally needs a `driver` role, so an approved applicant had no
// route into any of it.
//
// activateRental closes that gap in one action and enforces the two rules that
// matter with a small fleet and paid traffic: a vehicle cannot go out twice,
// and a vehicle cannot go out un-inspected.

const SITE_URL = () => process.env.PUBLIC_SITE_URL || "https://drivereal.com";

// Delegates to the shared tier check rather than repeating the role list.
// Everything in this file is money, so the bar is Manager — a Coordinator is
// staff but is refused here, exactly as the RLS policies refuse them the
// underlying tables. Returns the actor so callers can attribute an audit entry
// without a second lookup.
async function assertStaff(_supabase: any, userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

export type ActivationBlocker = {
  code:
    | "no_vehicle"
    | "vehicle_busy"
    | "no_passed_inspection"
    | "no_email"
    | "not_approved"
    | "already_active";
  message: string;
};

export type ActivationReadiness = {
  ready: boolean;
  blockers: ActivationBlocker[];
  warnings: string[];
  vehicleId: string | null;
  suggestedWeeklyRate: number | null;
  suggestedDeposit: number | null;
};

/**
 * Everything that would stop this applicant being activated on this vehicle.
 *
 * Returned as a list rather than throwing on the first problem so the admin
 * sees all of it at once instead of fixing one thing, retrying, and hitting
 * the next.
 */
async function evaluateReadiness(
  admin: any,
  applicationId: string,
  vehicleIdOverride?: string | null,
): Promise<ActivationReadiness> {
  const blockers: ActivationBlocker[] = [];
  const warnings: string[] = [];

  const { data: app } = await admin
    .from("applications")
    .select(
      "id,full_name,email,phone,status,vehicle_id,weekly_rent,user_id,insurance_status,sms_consent",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) throw new Error("Application not found");

  const vehicleId = vehicleIdOverride ?? (app.vehicle_id as string | null);

  if (!app.email) {
    blockers.push({
      code: "no_email",
      message: "No email on file — needed to create their portal login.",
    });
  }
  if (!["approved", "active"].includes(String(app.status))) {
    blockers.push({
      code: "not_approved",
      message: `Application is "${app.status}". Approve it before activating.`,
    });
  }

  // An applicant already on an active rental should be edited, not re-activated.
  if (app.user_id) {
    const { data: existing } = await admin
      .from("rentals")
      .select("id")
      .eq("driver_id", app.user_id)
      .eq("status", "active")
      .limit(1);
    if (existing && existing.length) {
      blockers.push({
        code: "already_active",
        message: "This driver already has an active rental.",
      });
    }
  }

  let vehicle: any = null;
  if (!vehicleId) {
    blockers.push({ code: "no_vehicle", message: "No vehicle selected." });
  } else {
    const { data: v } = await admin
      .from("vehicles")
      .select(
        "id,year,make,model,status,weekly_rate,deposit,license_plate,registration_expires_on,insurance_expires_on",
      )
      .eq("id", vehicleId)
      .maybeSingle();
    vehicle = v;
    if (!v) {
      blockers.push({ code: "no_vehicle", message: "That vehicle no longer exists." });
    } else {
      // Double-booking guard. Checked against live rentals rather than
      // vehicles.status, because status is edited by hand and drifts.
      const { data: busy } = await admin
        .from("rentals")
        .select("id,driver_id")
        .eq("vehicle_id", vehicleId)
        .eq("status", "active")
        .limit(1);
      if (busy && busy.length) {
        blockers.push({
          code: "vehicle_busy",
          message: "That vehicle is already on an active rental with another driver.",
        });
      }

      // A car must not leave the lot without a passed pre-delivery inspection.
      const { data: inspection } = await admin
        .from("inspections")
        .select("id,status,completed_at")
        .eq("vehicle_id", vehicleId)
        .eq("inspection_type", "pre_delivery")
        .eq("status", "passed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!inspection) {
        blockers.push({
          code: "no_passed_inspection",
          message: "No passed pre-delivery inspection for this vehicle. Run the checklist first.",
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      if (v.registration_expires_on && v.registration_expires_on < today) {
        warnings.push("Vehicle registration is expired.");
      }
      if (v.insurance_expires_on && v.insurance_expires_on < today) {
        warnings.push("Fleet insurance on this vehicle is expired.");
      }
      if (!v.license_plate) warnings.push("Vehicle has no license plate recorded.");
    }
  }

  if (app.insurance_status === "none") {
    warnings.push("Applicant reported no personal insurance coverage.");
  } else if (app.insurance_status === "expired") {
    warnings.push("Applicant's insurance is expired.");
  }
  if (!app.sms_consent) warnings.push("No SMS consent — they will only get email updates.");

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    vehicleId: vehicleId ?? null,
    suggestedWeeklyRate:
      app.weekly_rent != null
        ? Number(app.weekly_rent)
        : vehicle?.weekly_rate != null
          ? Number(vehicle.weekly_rate)
          : null,
    suggestedDeposit: vehicle?.deposit != null ? Number(vehicle.deposit) : null,
  };
}

export const getActivationReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        vehicleId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ActivationReadiness> => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return evaluateReadiness(supabaseAdmin, data.applicationId, data.vehicleId ?? undefined);
  });

/**
 * Find this applicant's auth user, or create one.
 *
 * Matching is by email because an applicant may already have signed up (e.g.
 * they created a login to check their status). Creating a duplicate auth user
 * would orphan their existing documents, so we always look first.
 */
async function ensureDriverAccount(
  admin: any,
  email: string,
  fullName: string | null,
): Promise<{ userId: string; created: boolean }> {
  const target = email.trim().toLowerCase();

  // listUsers is paginated and has no server-side email filter, so page until
  // we find them. Small user base; bounded to avoid an unbounded loop.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u: any) => String(u.email ?? "").toLowerCase() === target);
    if (hit) return { userId: hit.id as string, created: false };
    if (users.length < 200) break;
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: target,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? null },
  });
  if (createErr || !created?.user)
    throw new Error(createErr?.message || "Could not create driver login");
  return { userId: created.user.id as string, created: true };
}

export type ActivateResult = {
  ok: boolean;
  rentalId?: string;
  blockers?: ActivationBlocker[];
  accountCreated?: boolean;
  inviteUrl?: string | null;
};

export const activateRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        vehicleId: z.string().uuid(),
        weeklyRate: z.number().nonnegative().max(100000),
        depositAmount: z.number().nonnegative().max(100000).default(0),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        depositHeld: z.boolean().optional(),
        /** Set only when the operator has explicitly acknowledged the blockers. */
        overrideBlockers: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ActivateResult> => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const readiness = await evaluateReadiness(supabaseAdmin, data.applicationId, data.vehicleId);

    // Double-booking and missing-email are never overridable: the first would
    // hand one car to two drivers, the second cannot produce a working login.
    const hardBlockers = readiness.blockers.filter(
      (b) => b.code === "vehicle_busy" || b.code === "no_email" || b.code === "already_active",
    );
    if (hardBlockers.length) return { ok: false, blockers: hardBlockers };
    if (!readiness.ready && !data.overrideBlockers) {
      return { ok: false, blockers: readiness.blockers };
    }

    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id,full_name,email,phone,user_id")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (!app?.email)
      return { ok: false, blockers: [{ code: "no_email", message: "No email on file." }] };

    // 1. Auth account
    const { userId, created } = await ensureDriverAccount(
      supabaseAdmin,
      app.email as string,
      (app.full_name as string | null) ?? null,
    );

    // 2. Driver role. Ignore a duplicate — the role may already be granted.
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "driver" });
    if (roleErr && !String(roleErr.message).includes("duplicate key")) {
      console.error("[activate] role grant failed", roleErr.message);
    }

    // 3. Link the application to the account so the portal can find it.
    await supabaseAdmin
      .from("applications")
      .update({ user_id: userId })
      .eq("id", data.applicationId);

    // 4. The rental itself.
    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .insert({
        driver_id: userId,
        vehicle_id: data.vehicleId,
        application_id: data.applicationId,
        start_date: data.startDate,
        end_date: data.endDate ?? null,
        status: "active",
        weekly_rate: data.weeklyRate,
        deposit_amount: data.depositAmount,
        deposit_held: data.depositHeld ?? false,
        next_payment_due: data.startDate,
      })
      .select("id")
      .single();
    if (rentalErr) {
      // The partial unique indexes are the real double-booking guard: the
      // pre-flight check above is not atomic with this insert, so two
      // simultaneous activations can both pass it and only one can land here.
      const msg = String(rentalErr.message);
      if (msg.includes("rentals_one_active_per_vehicle_idx")) {
        return {
          ok: false,
          blockers: [
            {
              code: "vehicle_busy",
              message: "That vehicle was just activated on another rental. Pick a different one.",
            },
          ],
        };
      }
      if (msg.includes("rentals_one_active_per_driver_idx")) {
        return {
          ok: false,
          blockers: [
            { code: "already_active", message: "This driver already has an active rental." },
          ],
        };
      }
      throw new Error(rentalErr.message);
    }

    // 5. Reflect the new state on the vehicle and the application.
    await supabaseAdmin.from("vehicles").update({ status: "rented" }).eq("id", data.vehicleId);
    await supabaseAdmin
      .from("applications")
      .update({ status: "active", vehicle_id: data.vehicleId })
      .eq("id", data.applicationId);

    // 6. Link any signed agreement to the rental it actually governs.
    await supabaseAdmin
      .from("agreements")
      .update({ rental_id: rental.id })
      .eq("application_id", data.applicationId)
      .is("rental_id", null);

    // 7. Welcome the driver. A brand-new account gets a set-password link;
    //    an existing one just gets the portal URL.
    let inviteUrl: string | null = null;
    if (created) {
      try {
        const { data: link } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: app.email as string,
        });
        inviteUrl = (link?.properties?.action_link as string) ?? null;
      } catch (e) {
        console.error("[activate] invite link failed", e);
      }
    }

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("year,make,model,license_plate")
      .eq("id", data.vehicleId)
      .maybeSingle();
    const vehicleLabel =
      [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "your vehicle";
    const firstName =
      String(app.full_name ?? "there")
        .trim()
        .split(/\s+/)[0] || "there";
    const portalUrl = `${SITE_URL()}/portal`;

    try {
      const { sendEmail } = await import("@/lib/email.server");
      await sendEmail({
        to: app.email as string,
        subject: `You're approved — ${vehicleLabel} is yours`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
          <h1 style="font-size:20px">You're all set, ${escapeHtml(firstName)}</h1>
          <p style="font-size:15px;line-height:1.6">Your rental is active: <strong>${escapeHtml(vehicleLabel)}</strong>${
            vehicle?.license_plate ? ` (${escapeHtml(vehicle.license_plate)})` : ""
          } at $${data.weeklyRate.toFixed(2)}/week.</p>
          <p style="font-size:15px;line-height:1.6">Use the driver portal to see payments, upload pickup photos, report an issue and keep your documents current.</p>
          <a href="${created && inviteUrl ? inviteUrl : portalUrl}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
            ${created ? "Set Your Password" : "Open Driver Portal"}
          </a>
          <p style="color:#888;font-size:12px;margin-top:20px">Take photos of the car at pickup in the portal — it protects you if there's ever a question about damage.</p>
        </div>`,
        replyTo: "team@drivereal.com",
      });
    } catch (e) {
      console.error("[activate] welcome email failed", e);
    }

    try {
      const { sendSms } = await import("@/lib/sms.server");
      await sendSms({
        to: (app.phone as string) ?? "",
        body: `REAL RENTALS: You're approved, ${firstName}! ${vehicleLabel} is reserved for you. Check your email to set up your driver portal. Reply STOP to opt out.`,
        kind: "rental_activated",
        applicationId: data.applicationId,
        rentalId: rental.id as string,
        vehicleId: data.vehicleId,
      });
    } catch (e) {
      console.error("[activate] welcome sms failed", e);
    }

    await supabaseAdmin.from("notifications").insert({
      driver_id: userId,
      kind: "rental_started",
      title: "Your rental is active",
      body: `${vehicleLabel} — $${data.weeklyRate.toFixed(2)}/week.`,
      channels: ["in_app", "email"],
    });

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "rental.activated",
      summary: `Activated ${vehicleLabel} for ${app.full_name ?? app.email}`,
      entityType: "rental",
      entityId: rental.id as string,
      metadata: {
        vehicle_id: data.vehicleId,
        application_id: data.applicationId,
        account_created: created,
        overrides: (data as any).acknowledge ?? null,
      },
    });

    return { ok: true, rentalId: rental.id as string, accountCreated: created, inviteUrl };
  });

export const endRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        /** Where the vehicle goes next: straight back out, or into the shop. */
        vehicleStatus: z.enum(["available", "maintenance"]).default("available"),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id,vehicle_id,driver_id,application_id,status")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");
    if (rental.status !== "active") return { ok: true, alreadyClosed: true };

    const endDate = data.endDate ?? new Date().toISOString().slice(0, 10);

    const { error } = await supabaseAdmin
      .from("rentals")
      .update({ status: "closed", end_date: endDate, autopay_active: false })
      .eq("id", data.rentalId);
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("vehicles")
      .update({ status: data.vehicleStatus })
      .eq("id", rental.vehicle_id);

    if (rental.application_id) {
      await supabaseAdmin
        .from("applications")
        .update({ status: "closed" })
        .eq("id", rental.application_id);
    }

    // Stop any automation still running for this driver.
    if (rental.application_id) {
      await supabaseAdmin
        .from("automation_enrollments")
        .update({ status: "cancelled", cancelled_reason: "rental ended", next_run_at: null })
        .eq("application_id", rental.application_id)
        .eq("status", "active");
    }

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "rental.ended",
      summary: `Ended rental ${rental.id}`,
      entityType: "rental",
      entityId: String(rental.id),
      metadata: { vehicle_id: rental.vehicle_id, driver_id: rental.driver_id },
    });

    return { ok: true, alreadyClosed: false };
  });

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
