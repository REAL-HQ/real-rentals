import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { LIVE_RENTAL_RELEASE } from "@/lib/live-rental-release";
import {
  evaluateIntake,
  summarizeSubscription,
  planPaymentImport,
  collectedTotal,
  RECORD_CONFIRM_PHRASE,
  RECORD_RENTAL_ENABLED,
  type DriverIdentityFacts,
  type IntakeBlocker,
  type IntakeInput,
  type SubscriptionSummary,
  type PaymentImportRow,
} from "@/lib/rental-intake";

// Record Rental — for rentals that already started outside REAL RENTALS.
//
// What this file must never do (scripts/rental-intake.test.ts checks it):
// create/update/cancel anything in Stripe, send email or SMS, provision a
// driver login, or write rentals outside one database transaction.
// Stripe access is read-only through `readOnlyStripe` below.
//
// Live Stripe lookups stay off until the Owner approves them. Sandbox (test
// mode) works so the flow can be exercised end to end with synthetic data.
const LIVE_STRIPE_INTAKE_APPROVED = false;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const inputSchema = z.object({
  applicationId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  pickupDate: ymd,
  pickupMileage: z.number().int().min(0).max(2_000_000).nullable(),
  weeklyRate: z.number().positive().max(100000),
  depositCollected: z.number().min(0).max(100000).nullable(),
  stripeCustomerId: z.string().trim().regex(/^cus_[A-Za-z0-9]+$/).nullable(),
  stripeSubscriptionId: z.string().trim().regex(/^sub_[A-Za-z0-9]+$/).nullable(),
  environment: z.enum(["sandbox", "live"]),
});

/** Only read calls are reachable from intake code. */
async function readOnlyStripe(env: "sandbox" | "live") {
  const { createStripeClient } = await import("@/lib/stripe.server");
  const s = createStripeClient(env);
  return {
    getSubscription: (id: string) => s.subscriptions.retrieve(id),
    listInvoices: (subscription: string) =>
      s.invoices.list({ subscription, limit: 100, expand: ["data.charge", "data.payment_intent"] } as any),
  };
}

export type IntakePreflight = {
  blockers: IntakeBlocker[];
  subscription: SubscriptionSummary | null;
  paymentsToImport: PaymentImportRow[];
  collected: number | null;
  stripeError: string | null;
};

/** Identity evidence for one application (service role, after a staff check). */
export async function loadDriverIdentityFacts(admin: any, applicationId: string): Promise<DriverIdentityFacts | null> {
  const [{ data: app }, { data: reviews }, { data: docs }] = await Promise.all([
    admin.from("applications").select("id,status,deleted_at,license_number,license_expiration").eq("id", applicationId).maybeSingle(),
    admin.from("application_identity_reviews").select("status,resolution").eq("application_id", applicationId),
    admin.from("documents").select("category").eq("driver_id", applicationId).in("category", ["license_front", "license_back"]),
  ]);
  if (!app) return null;
  const cats = new Set((docs ?? []).map((d: any) => String(d.category)));
  return {
    status: app.status ?? null,
    deleted: !!app.deleted_at,
    openIdentityReviews: (reviews ?? []).filter((r: any) => r.status === "open").length,
    differentPersonResolved: (reviews ?? []).some((r: any) => r.resolution === "different_person"),
    hasLicenseNumber: !!String(app.license_number ?? "").trim(),
    licenseExpiration: app.license_expiration ? String(app.license_expiration).slice(0, 10) : null,
    hasLicenseFront: cats.has("license_front"),
    hasLicenseBack: cats.has("license_back"),
  };
}

async function gather(admin: any, input: IntakeInput, env: "sandbox" | "live"): Promise<IntakePreflight> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [{ data: driver }, { data: vehicle }] = await Promise.all([
    admin.from("applications").select("id,status,user_id").eq("id", input.applicationId).maybeSingle(),
    admin.from("vehicles").select("id,status,archived_at,current_odometer").eq("id", input.vehicleId).maybeSingle(),
  ]);

  const missingRes = vehicle ? await admin.rpc("vehicle_rental_ready_missing", { _vehicle_id: input.vehicleId }) : { data: [] };
  const [{ data: onVehicle }, { data: forDriver }, { data: dup }, { data: hist }] = await Promise.all([
    admin.from("rentals").select("id").eq("vehicle_id", input.vehicleId).eq("status", "active").limit(1),
    admin.from("rentals").select("id").eq("application_id", input.applicationId).eq("status", "active").limit(1),
    admin.from("rentals").select("id").eq("application_id", input.applicationId).eq("vehicle_id", input.vehicleId).eq("start_date", input.pickupDate).limit(1),
    admin.from("odometer_readings").select("mileage").eq("vehicle_id", input.vehicleId).eq("status", "valid").order("mileage", { ascending: false }).limit(1),
  ]);
  // A login, if one exists, may already hold an active rental under another application.
  let driverBusy = !!forDriver?.length;
  if (!driverBusy && driver?.user_id) {
    const { data } = await admin.from("rentals").select("id").eq("driver_id", driver.user_id).eq("status", "active").limit(1);
    driverBusy = !!data?.length;
  }

  let subscription: SubscriptionSummary | null = null;
  let paymentsToImport: PaymentImportRow[] = [];
  let stripeChecked = false;
  let stripeError: string | null = null;
  let linkedElsewhere = false;
  const wantsStripe = !!(input.stripeCustomerId || input.stripeSubscriptionId);
  const liveBlocked = wantsStripe && env === "live" && !LIVE_STRIPE_INTAKE_APPROVED;

  if (wantsStripe && !liveBlocked && input.stripeSubscriptionId) {
    try {
      const stripe = await readOnlyStripe(env);
      subscription = summarizeSubscription(await stripe.getSubscription(input.stripeSubscriptionId));
      stripeChecked = true;
      const { data: linked } = await admin.from("rentals").select("id").eq("stripe_subscription_id", subscription.id).limit(1);
      linkedElsewhere = !!linked?.length;
      const invoices = LIVE_RENTAL_RELEASE.historicalPayments ? (await stripe.listInvoices(subscription.id)).data ?? [] : [];
      const invIds = invoices.map((i: any) => i.id);
      const { data: existing } = invIds.length
        ? await admin.from("payments").select("stripe_invoice_id,stripe_payment_intent_id").in("stripe_invoice_id", invIds)
        : { data: [] };
      paymentsToImport = planPaymentImport(invoices, {
        invoiceIds: (existing ?? []).map((r: any) => r.stripe_invoice_id).filter(Boolean),
        paymentIntentIds: (existing ?? []).map((r: any) => r.stripe_payment_intent_id).filter(Boolean),
        chargeIds: [],
      });
    } catch (e) {
      const { getStripeErrorMessage } = await import("@/lib/stripe.server");
      stripeError = getStripeErrorMessage(e);
      stripeChecked = true;
    }
  }

  const identity = driver ? await loadDriverIdentityFacts(admin, input.applicationId) : null;
  const blockers = evaluateIntake(input, {
    today,
    driver: driver ? { id: driver.id, status: driver.status } : null,
    identity,
    vehicle: vehicle ? { id: vehicle.id, status: vehicle.status, archived: !!vehicle.archived_at } : null,
    rentalReadyMissing: Array.isArray(missingRes.data) ? missingRes.data : [],
    activeRentalOnVehicle: !!onVehicle?.length,
    activeRentalForDriver: driverBusy,
    duplicateRental: !!dup?.length,
    mileageHistoryMax: hist?.[0]?.mileage != null ? Number(hist[0].mileage) : null,
    subscription,
    stripeChecked,
    stripeLiveBlocked: liveBlocked,
    subscriptionLinkedElsewhere: linkedElsewhere,
  });
  if (wantsStripe && !LIVE_RENTAL_RELEASE.historicalPayments)
    blockers.push({ code: "feature_disabled", message: "Historical reconciliation and subscription linkage remain disabled pending database approval." });
  return { blockers, subscription, paymentsToImport,
    collected: LIVE_RENTAL_RELEASE.historicalPayments && stripeChecked && !stripeError ? collectedTotal(paymentsToImport) : null,
    stripeError };
}

/** Read-only. Nothing is written anywhere. */
export const previewRecordRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }): Promise<IntakePreflight> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return gather(supabaseAdmin, data, data.environment);
  });

export type RecordRentalResult = { ok: true; rentalId: string; paymentsRecorded: number } | { ok: false; blockers: IntakeBlocker[] };

/**
 * Creates the rental, links the existing Stripe subscription and records past
 * payments — in ONE database transaction (record_existing_rental_tx), which
 * re-checks every rule under row locks. No Stripe writes, no messages, no login.
 */
export const recordExistingRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    inputSchema.extend({ confirm: z.string(), reason: z.string().trim().min(5).max(500) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RecordRentalResult> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    // Off until the reviewed database function is installed and the Owner enables it.
    if (!RECORD_RENTAL_ENABLED)
      return { ok: false, blockers: [{ code: "feature_disabled", message: "Record Rental is not enabled yet." }] };
    if (data.confirm !== RECORD_CONFIRM_PHRASE)
      return { ok: false, blockers: [{ code: "confirmation_required", message: `Type ${RECORD_CONFIRM_PHRASE} to confirm.` }] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pre = await gather(supabaseAdmin, data, data.environment);
    if (pre.blockers.length) return { ok: false, blockers: pre.blockers };

    // Called as the signed-in user, never the service role: the database reads
    // auth.uid(), re-checks Manager/Owner and attributes the audit entry. No actor is passed.
    const { data: rentalId, error } = await (context.supabase as any).rpc("record_existing_rental_tx", {
      _application_id: data.applicationId,
      _vehicle_id: data.vehicleId,
      _start: data.pickupDate,
      _weekly_rate: data.weeklyRate,
      _deposit: data.depositCollected,
      _pickup_miles: data.pickupMileage,
      _stripe_customer_id: pre.subscription?.customerId ?? data.stripeCustomerId,
      _stripe_subscription_id: pre.subscription?.id ?? null,
      _next_payment_due: pre.subscription?.nextBillingDate ?? null,
      _payments: pre.paymentsToImport,
      _reason: data.reason,
    });
    if (error) {
      const msg = String(error.message ?? "");
      if (error.code === "PGRST202" || /could not find the function/i.test(msg))
        return { ok: false, blockers: [{ code: "db_not_installed", message: "Record Rental is not installed in the database yet (awaiting approved migration)." }] };
      const known: Record<string, IntakeBlocker["code"]> = {
        vehicle_busy: "vehicle_busy", already_active: "driver_has_active_rental", duplicate_rental: "duplicate_rental",
        vehicle_unavailable: "vehicle_unavailable", subscription_already_linked: "subscription_already_linked",
        not_authenticated: "forbidden", forbidden: "forbidden", application_not_approved: "application_not_approved",
        identity_review_open: "identity_review_open", identity_conflict: "identity_conflict",
        license_missing_or_expired: "license_missing_or_expired", license_documents_missing: "license_documents_missing",
        payment_conflict: "payment_conflict", payment_without_provider_id: "payment_conflict",
      };
      const code = Object.keys(known).find((k) => msg.includes(k));
      return { ok: false, blockers: [{ code: code ? known[code] : ("vehicle_not_ready" as const), message: msg }] };
    }
    return { ok: true, rentalId: String(rentalId), paymentsRecorded: pre.paymentsToImport.length };
  });
