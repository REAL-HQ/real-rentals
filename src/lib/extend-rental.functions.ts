import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { BILLING_EFFECTS, EXTEND_RENTAL_ENABLED } from "@/lib/extend-rental";

const DISABLED = "Extend Rental is disabled pending installation and acceptance";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const billingPlanSchema = z
  .object({
    effect: z.enum(BILLING_EFFECTS),
    nextPaymentDue: dateOnly.nullable(),
    includedCharges: z.array(dateOnly),
    cancelAt: z.string().min(10),
    proration: z.literal("none"),
    stripe: z
      .object({
        performed: z.literal(false),
        subscriptionId: z.string().nullable(),
        call: z.literal("stripe.subscriptions.update").nullable(),
        params: z
          .object({
            cancel_at: z.number().int().positive(),
            proration_behavior: z.literal("none"),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const named = plan.stripe.call != null;
    if (named !== (plan.stripe.params != null) || named !== (plan.stripe.subscriptionId != null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Stripe plan shape mismatch" });
    }
    if (plan.stripe.performed !== false || plan.proration !== "none") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Stripe was not authorized" });
    }
  });

const extendResultSchema = z
  .object({
    contract: z.literal("extend-rental-v1"),
    rentalId: z.string().uuid(),
    operationId: z.string().uuid(),
    previousEnd: dateOnly,
    newEnd: dateOnly,
    extraDays: z.number().int().positive(),
    extraWeeks: z.number().positive(),
    weeklyRate: z.number().positive(),
    extensionCost: z.number().nonnegative(),
    billingPlan: billingPlanSchema,
    recovered: z.boolean(),
  })
  .strict();

export type ExtendRentalResult = z.infer<typeof extendResultSchema>;

export type ExtendRentalContext = {
  endDate: string | null;
  weeklyRate: number | null;
  nextPaymentDue: string | null;
  hasSubscription: boolean;
};

function extendError(message: string): Error {
  if (message.includes("vehicle_conflict_booking")) {
    return new Error("That vehicle has another booking in the extended dates.");
  }
  if (message.includes("vehicle_conflict_waitlist")) {
    return new Error("That vehicle has a waitlist hold in the extended dates.");
  }
  if (message.includes("stale_end")) return new Error("The end date changed. Refresh and try again.");
  if (message.includes("end_date_required")) {
    return new Error("An end date is required before this rental can be extended.");
  }
  if (message.includes("no_weekly_rate")) return new Error("This rental has no weekly rate.");
  if (message.includes("extend_contention_retry_whole_transaction")) {
    return new Error("Someone else is updating this rental. Try again.");
  }
  if (message.includes("operation_conflict")) {
    return new Error("This extension was already submitted with different details.");
  }
  if (message.includes("rental_not_active")) return new Error("This rental is not active.");
  if (message.includes("end_not_extended")) {
    return new Error("The new end date must be after the current end date.");
  }
  if (message.includes("end_before_today")) {
    return new Error("The new end date must be today or later, Eastern Time.");
  }
  return new Error(message);
}

export const loadExtendContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rentalId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<ExtendRentalContext> => {
    if (!EXTEND_RENTAL_ENABLED) throw new Error(DISABLED);
    await requireManager(context.userId);
    const { data: row, error } = await (context.supabase as any)
      .from("rentals")
      .select("id,status,end_date,weekly_rate,next_payment_due,stripe_subscription_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.status !== "active") throw new Error("This rental is not active.");
    return {
      endDate: row.end_date,
      weeklyRate: row.weekly_rate == null ? null : Number(row.weekly_rate),
      nextPaymentDue: row.next_payment_due,
      hasSubscription: Boolean(row.stripe_subscription_id),
    };
  });

export const extendRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        operationId: z.string().uuid(),
        rentalId: z.string().uuid(),
        expectedEnd: dateOnly,
        newEnd: dateOnly,
        reason: z.string().trim().min(5).max(500),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ExtendRentalResult> => {
    if (!EXTEND_RENTAL_ENABLED) throw new Error(DISABLED);
    await requireManager(context.userId);
    const { data: result, error } = await (context.supabase as any).rpc("extend_rental_tx", {
      _operation_id: data.operationId,
      _rental_id: data.rentalId,
      _expected_end: data.expectedEnd,
      _new_end: data.newEnd,
      _reason: data.reason,
    });
    if (error) throw extendError(error.message);
    const parsed = extendResultSchema.parse(result);
    if (parsed.billingPlan.stripe.performed !== false || parsed.billingPlan.proration !== "none") {
      throw new Error("Stripe was not authorized");
    }
    if (parsed.rentalId !== data.rentalId || parsed.operationId !== data.operationId) {
      throw new Error("Extend response binding mismatch");
    }
    return parsed;
  });
