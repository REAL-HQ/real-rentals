import { RECORD_RENTAL_CONTRACT_ENABLED } from "./record-rental-contract";
import { END_RENTAL_SAFE_V1_ENABLED } from "./record-rental-live-path";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { notReadyMessage } from "@/lib/vehicle-readiness";
import {
  decideActivation,
  driverRequirementBlockers,
  activationRequirements,
  businessToday,
  checkedTxBlocker,
  insuranceStatus,
  type ActivationBlocker,
  type ActivationReadiness,
  type DriverReadinessFacts,
  type InsuranceReadiness,
} from "@/lib/activation-readiness";

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

// The readiness rules themselves (which blockers are hard, which need a
// written reason, the requirement checklist) live in activation-readiness.ts
// so the dialog and the Rental tab render exactly what this file enforces.
export type {
  ActivationBlocker,
  ActivationReadiness,
  ActivationRequirement,
} from "@/lib/activation-readiness";

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
  let inspectionMileage: number | null = null;
  let currentMileage: number | null = null;

  const { data: app } = await admin
    .from("applications")
    .select(
      "id,full_name,email,phone,status,vehicle_id,weekly_rent,user_id,insurance_status,insurance_expires_on,sms_consent",
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

  // Driver-side readiness, enforced here rather than only in the drawer:
  // approval, licence front/back, a signed agreement and verified insurance
  // (all hard; insurance may instead need the Owner-exception acknowledgement)
  // and the interview (soft). Same sources the drawer reads: the Document Vault
  // (documents.driver_id = application id), driver_screenings, agreements and
  // the audited paper-agreement verifications in audit_log.
  const [docsRead, screeningRead, agreementsRead, auditsRead] = await Promise.all([
    admin
      .from("documents")
      .select("id,category,is_current,review_status,expires_at,reviewed_at,storage_path")
      .eq("driver_id", applicationId)
      .eq("is_current", true),
    admin
      .from("driver_screenings")
      .select("interview_completed_at,insurance_verified")
      .eq("lead_id", applicationId)
      .maybeSingle(),
    admin
      .from("agreements")
      .select("source,status,signed_at,voided_at,rental_id")
      .eq("application_id", applicationId)
      .eq("status", "signed"),
    admin
      .from("audit_log")
      .select("action,actor_role,metadata")
      .eq("action", "document.verified")
      .eq("entity_type", "application")
      .eq("entity_id", applicationId),
  ]);
  // A failed read must never read as "complete": refuse instead of guessing.
  const readError = docsRead.error ?? screeningRead.error ?? agreementsRead.error ?? auditsRead.error;
  if (readError) throw new Error("Could not check activation readiness. Try again.");
  const docs = (docsRead.data ?? []) as DriverReadinessFacts["documents"];
  const screening = screeningRead.data;
  const agreements = agreementsRead.data;
  // The Owner exception. Missing or unreadable reads OFF; the activation
  // transaction re-reads it under a lock and decides for itself.
  const { loadRentalActivationSettings } = await import("@/lib/rental-activation-settings.server");
  const setting = await loadRentalActivationSettings(admin);
  const insurance: InsuranceReadiness = {
    status: insuranceStatus({
      verified: ((screening as any)?.insurance_verified as boolean | null) ?? null,
      documents: docs,
      applicationExpiresOn: ((app as any).insurance_expires_on as string | null) ?? null,
      today: businessToday(),
    }),
    exceptionAllowed: setting.allowWithoutInsuranceVerification,
    settingPresent: setting.present,
    settingReadable: setting.readable,
  };
  const facts: DriverReadinessFacts = {
    status: (app.status as string | null) ?? null,
    agreements: (agreements ?? []) as DriverReadinessFacts["agreements"],
    documents: docs,
    paperAudits: (auditsRead.data ?? []) as DriverReadinessFacts["paperAudits"],
    interviewCompletedAt: ((screening as any)?.interview_completed_at as string | null) ?? null,
    insurance,
    hasPassedInspection: null,
  };
  blockers.push(...driverRequirementBlockers(facts));

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
        "id,year,make,model,status,weekly_rate,deposit,license_plate,registration_expires_on,insurance_expires_on,current_odometer",
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

      // Rental Ready — the single DB definition (year/make/model/VIN/weekly
      // rate/photo). Never overridable; fleet-profile completeness is never checked.
      const { data: missing } = await (admin as any).rpc("vehicle_rental_ready_missing", { _vehicle_id: vehicleId });
      if (Array.isArray(missing) && missing.length) {
        blockers.push({
          code: "vehicle_not_ready",
          message: notReadyMessage(`vehicle_not_rental_ready:${missing.join(",")}`) ?? "Vehicle is not rental ready.",
        });
      }

      // A car must not leave the lot without a passed pre-delivery inspection.
      const { data: inspection } = await admin
        .from("inspections")
        .select("id,status,completed_at,odometer")
        .eq("vehicle_id", vehicleId)
        .eq("inspection_type", "pre_delivery")
        .eq("status", "passed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      inspectionMileage = (inspection as any)?.odometer != null ? Number((inspection as any).odometer) : null;
      currentMileage = (v as any).current_odometer != null ? Number((v as any).current_odometer) : null;
      facts.hasPassedInspection = !!inspection;
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
    requirements: activationRequirements(facts),
    insurance,
    vehicleId: vehicleId ?? null,
    suggestedWeeklyRate:
      app.weekly_rent != null
        ? Number(app.weekly_rent)
        : vehicle?.weekly_rate != null
          ? Number(vehicle.weekly_rate)
          : null,
    suggestedDeposit: vehicle?.deposit != null ? Number(vehicle.deposit) : null,
    inspectionMileage,
    currentMileage,
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

export type ActivateResult = {
  ok: boolean;
  rentalId?: string;
  blockers?: ActivationBlocker[];
  accountCreated?: boolean;
  inviteUrl?: string | null;
  /** Only on the non-atomic fallback (wrapper not installed): the required audit write failed. */
  auditError?: string;
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
        /** Required whenever overrideBlockers is used; stored in the immutable audit log. */
        overrideReason: z.string().trim().max(500).optional(),
        /** Odometer at handover → one canonical mileage observation (source Rental Pickup). */
        pickupMileage: z.number().int().min(0).max(2_000_000).nullable().optional(),
        /**
         * The operator ticked the insurance warning. Only meaningful while the Owner
         * setting "Allow Activation Without Insurance Verification" is ON; separate
         * from overrideBlockers/overrideReason, which never satisfy insurance.
         */
        insuranceExceptionAck: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ActivateResult> => {
    const actor = await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const readiness = await evaluateReadiness(supabaseAdmin, data.applicationId, data.vehicleId);

    // Hard blockers (double-booking, no email, already active, vehicle not
    // Rental Ready, not approved, missing licence, no signed agreement, and
    // any code not explicitly listed as soft) refuse even with an override and
    // a reason. Only the soft ones (no passed inspection, interview not
    // complete) may be overridden, and only with a written reason that goes
    // into the immutable audit log below. The identity check that needs the
    // provisioned login is returned directly from the handler further down.
    const decision = decideActivation(readiness, {
      overrideBlockers: data.overrideBlockers,
      overrideReason: data.overrideReason,
      insuranceExceptionAck: data.insuranceExceptionAck,
    });
    if (!decision.ok) return { ok: false, blockers: decision.blockers };
    const overridden = decision.overridden;

    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id,full_name,email,phone,user_id")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (!app?.email)
      return { ok: false, blockers: [{ code: "no_email", message: "No email on file." }] };

    // 1. Auth account, driver role, application link. Normally already done
    //    at approval — this is the repair path for an application approved
    //    before that existed, or one whose provisioning failed at the time.
    const { provisionDriverAccount } = await import("@/lib/driver-account.server");
    const {
      userId,
      created,
      inviteUrl: freshInviteUrl,
      conflict,
    } = await provisionDriverAccount(supabaseAdmin, {
      applicationId: data.applicationId,
      email: app.email as string,
      fullName: (app.full_name as string | null) ?? null,
    });
    // Never overridable. Handing somebody a car under an application whose
    // login belongs to a different person produces a rental the driver cannot
    // see and a portal showing somebody else's paperwork.
    if (conflict) {
      return {
        ok: false,
        blockers: [
          {
            code: "account_conflict",
            message:
              "This application is linked to a login whose email no longer matches the one on file. Resolve the identity before activating.",
          },
        ],
      };
    }

    // 4–6. The authoritative state transition, as ONE database transaction
    //      (activate_rental_tx): rental row, vehicle → rented, application →
    //      active + vehicle, agreement → rental link. It row-locks the vehicle,
    //      so of two simultaneous activations exactly one wins; any failure
    //      rolls every write back. Never re-split this into separate updates.
    //
    //      It is called through activate_rental_checked_tx (proposed SQL,
    //      proposed/activation-insurance-setting), which in the SAME transaction
    //      checks the actor is a Manager/Owner, locks and re-reads the Owner
    //      setting, the insurance state, the licence documents, the signed
    //      agreement, the interview and the passed inspection (only those two
    //      may be overridden, with a reason), then calls activate_rental_tx
    //      unchanged and writes the required rental.activated audit entry, so
    //      the activation and its audit evidence commit together or not at all.
    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("year,make,model,license_plate")
      .eq("id", data.vehicleId)
      .maybeSingle();
    const vehicleLabel =
      [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "your vehicle";
    const summary = `Activated ${vehicleLabel} for ${app.full_name ?? app.email}`;
    const overridePayload = overridden.length
      ? {
          blockers: overridden.map((b) => ({ code: b.code, message: b.message })),
          reason: data.overrideReason ?? null,
          by: actor.userId,
          at: new Date().toISOString(),
        }
      : null;
    const requestMeta = await (async () => {
      try {
        const { getRequest } = await import("@tanstack/react-start/server");
        const req = getRequest();
        return {
          ip: req?.headers?.get("cf-connecting-ip") ?? req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          user_agent: req?.headers?.get("user-agent") ?? null,
        };
      } catch {
        return { ip: null, user_agent: null };
      }
    })();
    const txArgs = {
      _application_id: data.applicationId,
      _vehicle_id: data.vehicleId,
      _driver_id: userId,
      _weekly_rate: data.weeklyRate,
      _deposit: data.depositAmount,
      _deposit_held: data.depositHeld ?? false,
      _start: data.startDate,
      _end: data.endDate ?? null,
      _pickup_miles: data.pickupMileage ?? null,
      _actor: actor.userId,
    };
    const ackSent = decision.insuranceExceptionUsed && data.insuranceExceptionAck === true;
    let rentalId: string | null = null;
    let auditError: string | null = null;
    const first = await (supabaseAdmin as any).rpc("activate_rental_checked_tx", {
      ...txArgs,
      _insurance_exception_ack: ackSent,
      _audit: {
        actor_email: actor.email ?? null,
        actor_role: actor.role,
        summary,
        account_created: created,
        overrides: overridePayload,
        ...requestMeta,
      },
    });
    let txErr = first.error as { code?: string; message?: string } | null;
    if (txErr?.code === "PGRST202") {
      // The wrapper is not installed yet. Fail closed: insurance must be
      // verified (no Owner exception without the in-transaction re-check), and
      // overrides are refused (their audit must commit with the rental). Only
      // then is the existing transaction used directly, and its audit entry is
      // written right after it — not atomically. A failed audit write is
      // returned to the operator (auditError), never swallowed.
      if (readiness.insurance.status !== "verified") {
        return {
          ok: false,
          blockers: [
            {
              code: "insurance_not_verified",
              message:
                "Insurance must be verified before activation. The Owner exception is unavailable until the activation database update is installed.",
            },
          ],
        };
      }
      if (overridden.length) {
        return {
          ok: false,
          blockers: [
            {
              code: "override_reason_required",
              message:
                "Overrides need the activation database update, so the override and its reason are recorded together with the rental. Resolve the item instead, or wait for the update.",
            },
          ],
        };
      }
      const legacy = await (supabaseAdmin as any).rpc("activate_rental_tx", txArgs);
      txErr = legacy.error;
      rentalId = (legacy.data as string | null) ?? null;
      if (!txErr && rentalId) {
        const { error: auditErr } = await (supabaseAdmin as any).from("audit_log").insert({
          actor_user_id: actor.userId,
          actor_email: actor.email ?? null,
          actor_role: actor.role,
          action: "rental.activated",
          entity_type: "rental",
          entity_id: rentalId,
          summary,
          ip: requestMeta.ip,
          user_agent: requestMeta.user_agent,
          metadata: {
            vehicle_id: data.vehicleId,
            application_id: data.applicationId,
            account_created: created,
            driver_id: userId,
            overrides: null,
            insurance: {
              acting_user_id: actor.userId,
              at: new Date().toISOString(),
              status: readiness.insurance.status,
              exception_used: false,
              setting_allow_without_verification: false,
              setting_present: readiness.insurance.settingPresent,
              setting_source: "wrapper_not_installed_treated_as_off",
              acknowledged: false,
              checked_in_transaction: false,
            },
            source: "server_fallback_non_atomic",
          },
        });
        if (auditErr) {
          auditError =
            "The rental started, but its audit entry could not be written. Tell the Owner so it can be recorded.";
          console.error("[activate] REQUIRED AUDIT WRITE FAILED", { rentalId, error: auditErr });
        }
      }
    } else if (!txErr) {
      rentalId = ((first.data ?? {}) as { rental_id?: string }).rental_id ?? null;
    }
    if (txErr) {
      const msg = String(txErr.message);
      if (/actor_not_manager/.test(msg)) throw new Error("Forbidden");
      const blocker = checkedTxBlocker(msg) ?? activationTxBlocker(msg);
      if (blocker) return { ok: false, blockers: [blocker] };
      throw new Error(msg);
    }
    if (!rentalId) throw new Error("The rental could not be confirmed. Check Bookings before retrying.");
    const rental = { id: rentalId };
    if (process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true") await import("@/lib/renter-lifecycle-notices.server").then((m) => m.enrollRenterLifecycleNotice({ event: "rental_started", applicationId: data.applicationId, rentalId: rental.id })).catch((e) => console.error("[renter-lifecycle] rental_started", e));

    // 7. Welcome the driver. A brand-new account gets the set-password link
    //    minted during provisioning; an existing one — which is now the normal
    //    case, because approval already made the account — just gets the
    //    portal URL, since they already have a password.
    const inviteUrl = freshInviteUrl;

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

    // rental.activated was written inside activate_rental_checked_tx (or, without
    // the wrapper, immediately after activate_rental_tx with any failure returned).
    return { ok: true, rentalId: rental.id as string, accountCreated: created, inviteUrl, ...(auditError ? { auditError } : {}) };
  });

export const endRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        // Ledger-backed rentals require a stable operation ID and observed effective instant.
        // Persist this request until reconciliation; never regenerate on timeout/reload.
        closeoutV2: z.object({
          operationId: z.string().uuid(),
          expectedActorId: z.string().uuid().optional(),
          endedAt: z.string().datetime({ offset: true }),
        }).strict().optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        /** Where the vehicle goes next: straight back out, or into the shop. */
        vehicleStatus: z.enum(["available", "maintenance"]).default("available"),
        reason: z.string().max(500).optional(),
        /** Odometer at return → one canonical mileage observation (source Rental Return). */
        returnMileage: z.number().int().min(0).max(2_000_000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await assertStaff(context.supabase, context.userId);
    if (data.closeoutV2) {
      if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Versioned closeout is disabled pending installation and acceptance");
      if (data.closeoutV2.expectedActorId && data.closeoutV2.expectedActorId !== context.userId) throw new Error("Session changed; use the original staff account");
      if (!data.reason || data.reason.trim().length < 5) throw new Error("A closeout reason is required");
      // Authenticated RLS-bound RPC; no admin/service-role fallback and no actor parameter.
      // A transport error is UNKNOWN, not rollback confirmation. Reconcile using the exact
      // same operation/payload. No automatic retry and no external side effects.
      const { data: result, error } = await (context.supabase as any).rpc("close_recorded_rental_v2", {
        _operation_id: data.closeoutV2.operationId,
        _rental_id: data.rentalId,
        _ended_at: data.closeoutV2.endedAt,
        _vehicle_status: data.vehicleStatus,
        _return_miles: data.returnMileage ?? null,
        _reason: data.reason,
      });
      if (error) throw new Error(error.message);
      const parsed = z.object({
        contract: z.literal("record-close-v2"), rentalId: z.string().uuid(),
        operationId: z.string().uuid(), assignmentId: z.string().uuid(),
        vehicleStatus: z.enum(["available", "maintenance"]), releaseReasons: z.array(z.string()),
        recovered: z.boolean(), billing: z.literal("unchanged"),
      }).strict().parse(result);
      if (parsed.rentalId !== data.rentalId || parsed.operationId !== data.closeoutV2.operationId)
        throw new Error("Closeout response binding mismatch; reconcile the original operation");
      if (process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true") await import("@/lib/renter-lifecycle-notices.server").then((m) => m.enrollRenterLifecycleNotice({ event: "rental_ended", rentalId: data.rentalId, fresh: !parsed.recovered })).catch((e) => console.error("[renter-lifecycle] rental_ended", e));
      return { ok: true, alreadyClosed: parsed.recovered, closeout: parsed };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id,vehicle_id,driver_id,application_id,status")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");
    if (rental.status !== "active") return { ok: true, alreadyClosed: true };

    const endDate = data.endDate ?? new Date().toISOString().slice(0, 10);

    const mileageError = (error: { message?: string }) => {
      const m = String(error.message);
      const n = (s: string) => Number(m.split(s + ":")[1]?.match(/\d+/)?.[0] ?? 0).toLocaleString("en-US");
      if (m.includes("return_below_pickup")) return { ok: false as const, error: `Return mileage can't be lower than pickup mileage (${n("return_below_pickup")} mi).` };
      if (m.includes("return_below_history")) return { ok: false as const, error: `Return mileage is far below this car's mileage history (${n("return_below_history")} mi). Check the odometer.` };
      return null;
    };
    const safeLifecycle = z.discriminatedUnion("alreadyClosed", [
      z.object({ contract: z.literal("safe-release-v1"), alreadyClosed: z.literal(true) }).strict(),
      z.object({
        contract: z.literal("safe-release-v1"), alreadyClosed: z.literal(false),
        vehicleStatus: z.enum(["available", "maintenance"]), releaseReasons: z.array(z.string()),
        billing: z.literal("unchanged_unverified"),
      }).strict(),
    ]);

    // end_rental_safe_v1 does not exist until 020-safe-release-compatible-v1.sql.
    // While the flag is false, the published end_rental_tx path is unchanged.
    if (END_RENTAL_SAFE_V1_ENABLED) {
      const { data: outcome, error } = await (supabaseAdmin as any).rpc("end_rental_safe_v1", {
        _rental_id: data.rentalId,
        _end: endDate,
        _vehicle_status: data.vehicleStatus,
        _return_miles: data.returnMileage ?? null,
        _actor: actor.userId,
        _release_contract: "safe-release-v1",
      });
      if (error) {
        const mapped = mileageError(error);
        if (mapped) return mapped;
        throw new Error(error.message);
      }
      const lifecycle = safeLifecycle.parse(outcome);
      if (lifecycle.alreadyClosed) return { ok: true, alreadyClosed: true };
      // The safe-release transaction owns its atomic audit; no second client audit.
      return { ok: true, alreadyClosed: false, lifecycle };
    }

    // One transaction (end_rental_tx): rental closed, vehicle released,
    // application closed, automations stopped — all or nothing.
    const { data: outcome, error } = await (supabaseAdmin as any).rpc("end_rental_tx", {
      _rental_id: data.rentalId,
      _end: endDate,
      _vehicle_status: data.vehicleStatus,
      _return_miles: data.returnMileage ?? null,
      _actor: actor.userId,
      ...(RECORD_RENTAL_CONTRACT_ENABLED ? { _release_contract: "safe-release-v1" } : {}),
    });
    if (error) {
      const mapped = mileageError(error);
      if (mapped) return mapped;
      throw new Error(error.message);
    }
    if (!RECORD_RENTAL_CONTRACT_ENABLED && outcome === "already_closed") return { ok: true, alreadyClosed: true };
    const lifecycle = RECORD_RENTAL_CONTRACT_ENABLED ? safeLifecycle.parse(outcome) : null;
    if (lifecycle?.alreadyClosed) return { ok: true, alreadyClosed: true };

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "rental.ended",
      summary: `Ended rental ${rental.id}`,
      entityType: "rental",
      entityId: String(rental.id),
      metadata: { vehicle_id: rental.vehicle_id, driver_id: rental.driver_id },
    });
    if (process.env.RENTER_LIFECYCLE_NOTICES_ENABLED === "true") await import("@/lib/renter-lifecycle-notices.server").then((m) => m.enrollRenterLifecycleNotice({ event: "rental_ended", applicationId: rental.application_id, rentalId: data.rentalId })).catch((e) => console.error("[renter-lifecycle] rental_ended", e));

    return { ok: true, alreadyClosed: false, lifecycle };
  });

/** Truthful messages for the reasons activate_rental_tx refuses. */
export function activationTxBlocker(msg: string): ActivationBlocker | null {
  // M2 approval_serialize (proposed) raises SQLSTATE 40001 when another
  // approval write holds its lock. The whole activate_rental_tx rolled back,
  // so nothing was written and pressing Activate Rental again is safe.
  if (msg.includes("approval_write_busy_retry"))
    return { code: "write_busy_retry", message: "Another approval was being saved at the same moment. Nothing was changed — try Activate Rental again." };
  if (msg.includes("vehicle_busy"))
    return { code: "vehicle_busy", message: "That vehicle was just activated on another rental. Pick a different one." };
  if (msg.includes("already_active"))
    return { code: "already_active", message: "This driver already has an active rental." };
  if (msg.includes("account_conflict"))
    return { code: "account_conflict", message: "This application's login does not match the driver account. Resolve the identity before activating." };
  if (msg.includes("not_approved"))
    return { code: "not_approved", message: "Application is not approved. Approve it before activating." };
  if (msg.includes("vehicle_unavailable") || msg.includes("vehicle_not_found"))
    return { code: "no_vehicle", message: "That vehicle is no longer in the working fleet." };
  const nr = notReadyMessage(msg);
  if (nr) return { code: "vehicle_not_ready", message: nr };
  if (msg.includes("no_weekly_rate"))
    return { code: "vehicle_not_ready", message: "A weekly rate above $0 is required to start a rental." };
  if (msg.includes("pickup_below_history")) {
    const n = Number(msg.split("pickup_below_history:")[1]?.match(/\d+/)?.[0] ?? 0).toLocaleString("en-US");
    return { code: "mileage_invalid", message: `Pickup mileage is far below this car's mileage history (${n} mi). Check the odometer.` };
  }
  if (msg.includes("invalid_mileage")) return { code: "mileage_invalid", message: "Enter a valid odometer reading." };
  if (msg.includes("invalid_dates"))
    return { code: "no_vehicle", message: "The end date must be after the start date." };
  return null;
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
