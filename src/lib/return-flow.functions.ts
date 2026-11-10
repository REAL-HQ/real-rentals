import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  RETURN_FLOW_ENABLED,
  destinationForComplete,
  finalAmountAfterDeposit,
  moneyCents,
  normalizeFinalCharge,
  normalizeSkipReason,
  photosReady,
  sumBalanceCents,
  type FinalChargeDraft,
  type ReturnBalanceLine,
  type ReturnBalanceSummary,
  type SubscriptionCancelMode,
} from "@/lib/return-flow";
import {
  RETURN_CHECKLIST_ENABLED,
  RETURN_PHOTO_BUCKET,
  buildReturnChecklist,
  emptyReturnChecklist,
  type ReturnChecklistDraft,
} from "@/lib/return-checklist";

function refuseWhileOff(): void {
  if (!RETURN_FLOW_ENABLED) throw new Error("Return is off");
}

async function requireReturnManager(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  return requireManager(userId);
}

function dollarsToCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Heuristic: values already in cents are large integers; weekly rates are dollars.
  if (Number.isInteger(n) && n >= 1000 && n % 1 === 0 && n > 500) {
    // Still treat payment.amount as dollars (350 = $350).
  }
  return Math.round(n * 100);
}

export const getReturnBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ReturnBalanceSummary> => {
    refuseWhileOff();
    await requireReturnManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rentalRaw, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id,status,application_id,driver_id,vehicle_id,weekly_rate,stripe_customer_id,stripe_subscription_id,autopay_active",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rentalRaw) throw new Error(error?.message || "Rental not found");
    const rental = rentalRaw as typeof rentalRaw & {
      reservation_deposit_amount?: number | null;
      reservation_deposit_status?: string | null;
      balance_due_cents?: number | null;
    };
    // Optional deposit columns arrive with the reservations migration; read softly.
    try {
      const extra = await (supabaseAdmin as any)
        .from("rentals")
        .select("reservation_deposit_amount,reservation_deposit_status,balance_due_cents")
        .eq("id", data.rentalId)
        .maybeSingle();
      if (extra?.data) Object.assign(rental, extra.data);
    } catch {
      /* columns may not exist until migrations apply */
    }
    if (String(rental.status) !== "active") throw new Error("Only an active rental can be returned.");

    const applicationId = (rental.application_id as string | null) ?? null;
    let driverName = "Driver";
    let driverPhone: string | null = null;
    let driverEmail: string | null = null;
    let appCustomer: string | null = null;
    if (applicationId) {
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("full_name,phone,email,stripe_customer_id")
        .eq("id", applicationId)
        .maybeSingle();
      if (app) {
        driverName = String(app.full_name || driverName);
        driverPhone = (app.phone as string | null) ?? null;
        driverEmail = (app.email as string | null) ?? null;
        appCustomer = (app.stripe_customer_id as string | null) ?? null;
      }
    }

    let vehicleLabel: string | null = null;
    const vehicleId = (rental.vehicle_id as string | null) ?? null;
    if (vehicleId) {
      const { data: v } = await supabaseAdmin
        .from("vehicles")
        .select("year,make,model,unit_number,license_plate")
        .eq("id", vehicleId)
        .maybeSingle();
      if (v) {
        vehicleLabel = [v.year, v.make, v.model].filter(Boolean).join(" ") || null;
        if (v.unit_number) vehicleLabel = `${vehicleLabel ?? "Vehicle"} · ${v.unit_number}`;
        if (v.license_plate) vehicleLabel = `${vehicleLabel ?? "Vehicle"} · ${v.license_plate}`;
      }
    }

    const lines: ReturnBalanceLine[] = [];
    const { data: pays } = await supabaseAdmin
      .from("payments")
      .select("id,type,status,amount,balance_due,due_date")
      .eq("rental_id", data.rentalId)
      .order("due_date", { ascending: true })
      .limit(100);

    for (const p of pays ?? []) {
      const status = String(p.status ?? "").toLowerCase();
      if (["paid", "refunded", "void", "waived", "cancelled", "canceled"].includes(status)) continue;
      const cents = dollarsToCents(p.balance_due != null && Number(p.balance_due) > 0 ? p.balance_due : p.amount);
      if (cents <= 0) continue;
      const type = String(p.type ?? "rent").toLowerCase();
      const kind: ReturnBalanceLine["kind"] =
        type.includes("late") ? "late" : type.includes("deposit") ? "deposit" : type.includes("toll") ? "toll" : type.includes("damage") ? "damage" : "rent";
      const waived = status === "waived";
      lines.push({
        key: String(p.id),
        label: kind === "late" ? "Late Fee" : kind === "rent" ? "Unpaid Rent" : type.replace(/_/g, " "),
        cents,
        kind,
        waived,
      });
    }

    const depositStatus = String((rental as any).reservation_deposit_status ?? "");
    const depositHeld =
      depositStatus === "paid" || depositStatus === "held"
        ? dollarsToCents((rental as any).reservation_deposit_amount)
        : 0;

    const stripeCustomerId =
      (rental.stripe_customer_id as string | null) || appCustomer || null;

    return {
      lines,
      totalOwedCents: sumBalanceCents(lines),
      depositHeldCents: depositHeld,
      depositApplyCents: depositHeld,
      hasStripeCustomer: !!stripeCustomerId,
      stripeCustomerId,
      stripeSubscriptionId: (rental.stripe_subscription_id as string | null) ?? null,
      autopayActive: rental.autopay_active === true,
      weeklyRateCents: rental.weekly_rate != null ? dollarsToCents(rental.weekly_rate) : null,
      driverName,
      driverPhone,
      driverEmail,
      applicationId,
      vehicleId,
      vehicleLabel: vehicleLabel ?? "Unknown",
    };
  });

export const createFinalInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        amountCents: z.number().int().min(1).max(500_000_00),
        description: z.string().min(3).max(200),
        confirm: z.literal(true),
        extraCharges: z
          .array(
            z.object({
              label: z.string().max(120),
              cents: z.number().int().min(1).max(100_000_00),
              kind: z.enum(["damage", "cleaning", "toll", "other"]),
            }),
          )
          .max(20)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    refuseWhileOff();
    await requireReturnManager(context.userId);
    if (data.confirm !== true) throw new Error("Confirm creating the final invoice.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id,status,application_id,stripe_customer_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error(error?.message || "Rental not found");
    if (String(rental.status) !== "active") throw new Error("Only an active rental can get a final invoice.");

    let customerId = (rental.stripe_customer_id as string | null) ?? null;
    if (!customerId && rental.application_id) {
      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("stripe_customer_id,email,full_name")
        .eq("id", rental.application_id)
        .maybeSingle();
      customerId = (app?.stripe_customer_id as string | null) ?? null;
    }
    if (!customerId) {
      throw new Error("This renter has no Stripe customer. Record the amount owed and send payment options manually.");
    }

    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient("live");
    const extras = (data.extraCharges ?? [])
      .map((c) => normalizeFinalCharge(c as FinalChargeDraft))
      .filter((c): c is FinalChargeDraft => !!c);

    for (const charge of extras) {
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: charge.cents,
        currency: "usd",
        description: charge.label,
      });
    }
    if (extras.length === 0 || data.amountCents > sumBalanceCents(extras.map((e) => ({ key: e.label, label: e.label, cents: e.cents, kind: "other" as const })))) {
      const already = extras.reduce((s, e) => s + e.cents, 0);
      const remainder = Math.max(0, data.amountCents - already);
      if (remainder > 0) {
        await stripe.invoiceItems.create({
          customer: customerId,
          amount: remainder,
          currency: "usd",
          description: data.description,
        });
      }
    }

    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 7,
      metadata: { rentalId: data.rentalId, purpose: "final_return" },
      auto_advance: false,
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    const url =
      typeof finalized.hosted_invoice_url === "string" && finalized.hosted_invoice_url.startsWith("https://invoice.stripe.com/")
        ? finalized.hosted_invoice_url
        : null;
    if (!url) throw new Error("Stripe did not return this customer's hosted invoice link.");

    await (supabaseAdmin as any)
      .from("rentals")
      .update({ final_invoice_id: finalized.id, final_invoice_url: url })
      .eq("id", data.rentalId);

    return {
      ok: true as const,
      invoiceId: finalized.id as string,
      hostedUrl: url,
      amountCents: data.amountCents,
      amountLabel: moneyCents(data.amountCents),
    };
  });

export const cancelReturnSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: z.string().uuid(),
        mode: z.enum(["period_end", "now"]),
        confirm: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    refuseWhileOff();
    await requireReturnManager(context.userId);
    if (data.confirm !== true) throw new Error("Confirm cancelling the subscription.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id,status,stripe_subscription_id,autopay_active")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error(error?.message || "Rental not found");
    const subId = rental.stripe_subscription_id as string | null;
    if (!subId && !rental.autopay_active) {
      return { ok: true as const, mode: "none" as SubscriptionCancelMode, message: "No weekly subscription is on this rental." };
    }
    if (!subId) {
      await supabaseAdmin.from("rentals").update({ autopay_active: false }).eq("id", data.rentalId);
      return { ok: true as const, mode: "none" as SubscriptionCancelMode, message: "Autopay flag cleared. No Stripe subscription id was on file." };
    }

    const { createStripeClient } = await import("@/lib/stripe.server");
    const stripe = createStripeClient("live");
    if (data.mode === "period_end") {
      const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
      return {
        ok: true as const,
        mode: "period_end" as const,
        message: "Subscription will cancel at period end. Weekly charges stop after the current period.",
        cancelAt: sub.cancel_at ?? null,
        status: sub.status,
      };
    }

    const { subscriptionEnded } = await import("@/lib/subscription-cancel.server");
    const problem = await subscriptionEnded(stripe, subId);
    if (problem) throw new Error(problem);
    await supabaseAdmin
      .from("rentals")
      .update({ stripe_subscription_id: null, autopay_active: false })
      .eq("id", data.rentalId);
    return {
      ok: true as const,
      mode: "now" as const,
      message: "Subscription cancelled. No more weekly charges.",
    };
  });

const completeSchema = z.object({
  rentalId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  returnedAtEt: z.string().min(16).max(16),
  mileage: z.string().max(20),
  fuelOrCharge: z.enum(["empty", "quarter", "half", "three_quarter", "full"]),
  conditionNotes: z.string().max(2000).optional(),
  keysReturned: z.boolean(),
  vehicleDestination: z.enum(["available", "maintenance", "needs_inspection"]),
  photos: z
    .array(
      z.object({
        bucket: z.literal(RETURN_PHOTO_BUCKET),
        path: z.string().min(3).max(400),
        angle: z.string().max(40),
      }),
    )
    .max(40),
  photosSkippedReason: z.string().max(500).nullable().optional(),
  balanceDueCents: z.number().int().min(0).max(500_000_00),
  depositApplyCents: z.number().int().min(0).max(500_000_00).optional(),
  tollsTicketsNote: z.string().max(2000).optional(),
});

export const completeReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => completeSchema.parse(d))
  .handler(async ({ data, context }) => {
    refuseWhileOff();
    const actor = await requireReturnManager(context.userId);
    if (!photosReady({ photoCount: data.photos.length, skipReason: data.photosSkippedReason })) {
      throw new Error("Add return photos, or skip with a reason.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("id,status,stripe_subscription_id,autopay_active,vehicle_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error(error?.message || "Rental not found");
    if (String(rental.status) !== "active") throw new Error("This rental is already closed.");
    if (rental.stripe_subscription_id || rental.autopay_active) {
      throw new Error(
        "Cancel the weekly Stripe subscription in the Billing step first (now or at period end), then complete the return.",
      );
    }

    const skip = normalizeSkipReason(data.photosSkippedReason);
    const draft: ReturnChecklistDraft = {
      ...emptyReturnChecklist(),
      returnedAtEt: data.returnedAtEt,
      odometer: data.mileage,
      fuelOrCharge: data.fuelOrCharge,
      keysReturned: data.keysReturned,
      tollsTicketsNote: data.tollsTicketsNote ?? "",
      depositDecisionNeeded: (data.depositApplyCents ?? 0) > 0,
      depositDecisionNote: (data.depositApplyCents ?? 0) > 0 ? `Apply deposit ${moneyCents(data.depositApplyCents ?? 0)}` : "",
      photos: data.photos,
      items: emptyReturnChecklist().items.map((item) => ({ ...item, result: "na" as const })),
    };

    // Save checklist when the flag/tables are on. Migration installs the tables;
    // until applied, skip quietly and still end the rental.
    if (RETURN_CHECKLIST_ENABLED) {
      try {
        const record = buildReturnChecklist(data.vehicleId, draft);
        const inserted = await (supabaseAdmin as any)
          .from("return_checklists")
          .insert({
            rental_id: data.rentalId,
            vehicle_id: data.vehicleId,
            recorded_by: context.userId,
            returned_at: record.returnedAt,
            odometer: record.odometer,
            fuel_or_charge: record.fuelOrCharge,
            keys_returned: record.keysReturned,
            condition_notes: (data.conditionNotes ?? "").trim().slice(0, 2000) || null,
            tolls_tickets_note: record.tollsTicketsNote,
            deposit_decision_needed: record.depositDecisionNeeded,
            deposit_decision_note: record.depositDecisionNote,
            photos_skipped_reason: skip,
          })
          .select("id")
          .single();
        if (!inserted.error && inserted.data?.id && record.photos.length) {
          await (supabaseAdmin as any).from("return_checklist_photos").insert(
            record.photos.map((photo: { bucket: string; path: string; angle: string }) => ({
              checklist_id: inserted.data.id,
              storage_bucket: photo.bucket,
              storage_path: photo.path,
              angle: photo.angle,
            })),
          );
        }
      } catch (e) {
        console.error("[return-flow] checklist save", e);
      }
    }

    const endDate = data.returnedAtEt.slice(0, 10);
    const miles = Number(String(data.mileage).replace(/[^\d]/g, ""));
    const vehicleStatus = destinationForComplete(data.vehicleDestination);

    // end_rental_tx remains the only closer (same RPC endRental uses).
    const { data: outcome, error: endErr } = await (supabaseAdmin as any).rpc("end_rental_tx", {
      _rental_id: data.rentalId,
      _end: endDate,
      _vehicle_status: vehicleStatus,
      _return_miles: Number.isFinite(miles) ? miles : null,
      _actor: context.userId,
    });
    if (endErr) {
      const m = String(endErr.message ?? "");
      if (m.includes("return_below_pickup")) throw new Error("Return mileage can't be lower than pickup mileage.");
      if (m.includes("return_below_history")) throw new Error("Return mileage is far below this car's mileage history.");
      throw new Error(endErr.message);
    }
    const alreadyClosed = outcome === "already_closed";

    const due = Math.max(0, data.balanceDueCents);
    await (supabaseAdmin as any)
      .from("rentals")
      .update({
        balance_due_cents: due,
        return_photos_skipped_reason: skip,
      })
      .eq("id", data.rentalId);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "rental.returned",
      summary: `Completed return for rental ${data.rentalId}`,
      entityType: "rental",
      entityId: data.rentalId,
      metadata: {
        vehicle_id: data.vehicleId,
        balance_due_cents: due,
        vehicle_status: vehicleStatus,
        photos: data.photos.length,
        photos_skipped: !!skip,
      },
    });

    return {
      ok: true as const,
      alreadyClosed,
      balanceDueCents: due,
      balanceDueLabel: moneyCents(due),
      badge: due > 0 ? "Balance Due" : "Completed",
      vehicleStatus,
    };
  });

