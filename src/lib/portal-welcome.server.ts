/**
 * The ONE automatic Driver Portal login email (t463u / t466u).
 *
 * Nobody gets portal login details until they have picked up the car and
 * paid for the rental at pickup. Then, automatically and exactly once, they
 * get "Welcome To Your Driver Portal" with a set-password link.
 *
 * Called from both places that can complete that condition, in either order:
 *  - activation (activateRentalCore), when the pickup rent was already paid;
 *  - the payments webhook, when the pickup payment lands after activation.
 * Whichever sees both facts first sends; the other finds the audit marker.
 * The Resend idempotency key covers two racing sends.
 *
 * Never for the $50 Reservation Fee. Never names a broker or carrier.
 */
import { isPickupPayment, PORTAL_WELCOME_AUDIT_ACTION, PORTAL_WELCOME_PENDING_ACTION, type WelcomeOutcome } from "@/lib/portal-welcome";

type Admin = any;

export type WelcomeDeps = {
  gate?: () => Promise<"send" | "off" | "held">;
  pickedUp?: (admin: Admin, applicationId: string, status: string | null) => Promise<boolean>;
  provision?: (admin: Admin, args: { applicationId: string; email: string; fullName: string | null }) => Promise<{ userId: string; conflict: boolean }>;
  setPasswordLink?: (admin: Admin, email: string) => Promise<string | null>;
  send?: (args: { to: string; firstName: string | null; setPasswordUrl: string | null; vehicle: string | null; applicationId: string }) => Promise<{ ok: boolean; error?: unknown }>;
  audit?: (entry: Record<string, unknown>) => Promise<void>;
};

async function latestStartedRental(admin: Admin, applicationId: string): Promise<{ id: string; vehicle_id: string | null } | null> {
  const { data } = await admin
    .from("rentals")
    .select("id,status,vehicle_id,created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(20);
  const { rentalMeansPickedUp } = await import("@/lib/portal-pickup-gate");
  const row = (data ?? []).find((r: any) => rentalMeansPickedUp(r.status));
  return row ? { id: row.id, vehicle_id: row.vehicle_id ?? null } : null;
}

export async function pickupPaymentPaid(admin: Admin, applicationId: string, rentalId: string | null): Promise<boolean> {
  const select = "id,type,reason,status,rental_id,driver_id";
  const rows: any[] = [];
  if (rentalId) {
    const { data } = await admin.from("payments").select(select).eq("rental_id", rentalId).eq("status", "paid").limit(50);
    rows.push(...(data ?? []));
  }
  const { data: own } = await admin.from("payments").select(select).eq("driver_id", applicationId).eq("status", "paid").limit(50);
  rows.push(...(own ?? []));
  return rows.some((r) => isPickupPayment(r, { rentalId, applicationId }));
}

async function hasAudit(admin: Admin, action: string, applicationId: string): Promise<boolean> {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("entity_id", applicationId)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Send the welcome if, and only if, the renter has picked up, the pickup
 * payment is paid, and it has never been sent. Never throws.
 */
export async function maybeSendPortalWelcome(
  admin: Admin,
  args: { applicationId: string; rentalId?: string | null; source: "activation" | "payment" },
  deps: WelcomeDeps = {},
): Promise<WelcomeOutcome> {
  try {
    const { data: app } = await admin
      .from("applications")
      .select("id,email,full_name,status")
      .eq("id", args.applicationId)
      .maybeSingle();
    if (!app) return "failed";
    const email = String(app.email ?? "").trim();
    if (!email) return "no_email";

    const pickedUp = deps.pickedUp ?? (await import("@/lib/portal-pickup-gate.server")).applicationPickedUp;
    if (!(await pickedUp(admin, app.id, app.status ?? null))) return "not_picked_up";

    const rental = args.rentalId ? { id: args.rentalId, vehicle_id: null as string | null } : await latestStartedRental(admin, app.id);
    if (!(await pickupPaymentPaid(admin, app.id, rental?.id ?? null))) return "not_paid";
    if (await hasAudit(admin, PORTAL_WELCOME_AUDIT_ACTION, app.id)) return "already";
    // The payment path only finishes a welcome activation deferred. A renter
    // activated before this change has no marker and is left alone.
    if (args.source === "payment" && !(await hasAudit(admin, PORTAL_WELCOME_PENDING_ACTION, app.id))) return "already";

    const gate =
      deps.gate ??
      (async () => {
        const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
        return gateFor(await loadAutomationControls(admin), "portal_welcome_email");
      });
    const decision = await gate();
    if (decision !== "send") return decision;

    const provision = deps.provision ?? (await import("@/lib/driver-account.server")).provisionDriverAccount;
    const account = await provision(admin, { applicationId: app.id, email, fullName: (app.full_name as string | null) ?? null });
    if (account.conflict) return "conflict";

    const setPasswordLink = deps.setPasswordLink ?? (await import("@/lib/driver-account.server")).mintSetPasswordLink;
    const setPasswordUrl = await setPasswordLink(admin, email);

    let vehicle: string | null = null;
    const vehicleId = rental?.vehicle_id ?? null;
    if (vehicleId) {
      const { data: v } = await admin.from("vehicles").select("year,make,model").eq("id", vehicleId).maybeSingle();
      vehicle = [v?.year, v?.make, v?.model].filter(Boolean).join(" ").trim() || null;
    }

    const send = deps.send ?? (await import("@/lib/email.server")).sendPortalWelcomeEmail;
    const res = await send({
      to: email,
      firstName: (app.full_name as string | null) ?? null,
      setPasswordUrl,
      vehicle,
      applicationId: app.id,
    });
    if (!res || res.ok === false) {
      console.error("[portal-welcome] send not accepted", app.id, res?.error);
      return "failed";
    }
    const audit =
      deps.audit ??
      (async (entry: Record<string, unknown>) => {
        const { logAudit } = await import("@/lib/audit.server");
        await logAudit(null, entry as any);
      });
    await audit({
      action: PORTAL_WELCOME_AUDIT_ACTION,
      summary: "Welcome To Your Driver Portal email sent (pickup paid)",
      entityType: "application",
      entityId: app.id,
      metadata: { rental_id: rental?.id ?? null, source: args.source, set_password_link: Boolean(setPasswordUrl) },
    });
    return "sent";
  } catch (e) {
    console.error("[portal-welcome] failed", args.applicationId, e);
    return "failed";
  }
}

/**
 * Activation entry. Sends now when the pickup rent is already paid;
 * otherwise records the pending marker so the payment webhook sends it.
 */
export async function welcomeOrDeferAtActivation(
  admin: Admin,
  args: { applicationId: string; rentalId: string },
  deps: WelcomeDeps = {},
): Promise<WelcomeOutcome> {
  const outcome = await maybeSendPortalWelcome(admin, { ...args, source: "activation" }, deps);
  if (outcome !== "sent" && outcome !== "already" && outcome !== "conflict" && outcome !== "no_email") {
    try {
      const audit =
        deps.audit ??
        (async (entry: Record<string, unknown>) => {
          const { logAudit } = await import("@/lib/audit.server");
          await logAudit(null, entry as any);
        });
      await audit({
        action: PORTAL_WELCOME_PENDING_ACTION,
        summary: "Driver portal welcome waits for the pickup payment",
        entityType: "application",
        entityId: args.applicationId,
        metadata: { rental_id: args.rentalId, outcome },
      });
    } catch (e) {
      console.error("[portal-welcome] pending marker failed", args.applicationId, e);
    }
  }
  return outcome;
}

/**
 * Webhook entry: a payment just landed. Find whose rental it pays for and
 * try the welcome. Reservation Fee payments are ignored outright.
 */
export async function maybeWelcomeAfterPayment(
  admin: Admin,
  ref: { rentalId?: string | null; applicationId?: string | null; reason?: string | null },
  deps: WelcomeDeps = {},
): Promise<WelcomeOutcome | "ignored"> {
  if (String(ref.reason ?? "").toLowerCase() === "reservation_fee") return "ignored";
  let applicationId = ref.applicationId ?? null;
  if (!applicationId && ref.rentalId) {
    const { data } = await admin.from("rentals").select("application_id").eq("id", ref.rentalId).maybeSingle();
    applicationId = (data?.application_id as string | null) ?? null;
  }
  if (!applicationId) return "ignored";
  return maybeSendPortalWelcome(admin, { applicationId, rentalId: ref.rentalId ?? null, source: "payment" }, deps);
}
