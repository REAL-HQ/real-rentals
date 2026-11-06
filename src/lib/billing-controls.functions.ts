import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BILLING_DAY_APPLY_ENABLED,
  BILLING_DAY_APPLY_OFF,
  BILLING_DAY_CHANGE_ENABLED,
  BILLING_DAY_CHANGE_OFF,
  BILLING_EXTENSION_RECORD_ENABLED,
  BILLING_EXTENSION_RECORD_OFF,
  BILLING_ONE_TIME_EXTENSION_ENABLED,
  BILLING_ONE_TIME_EXTENSION_OFF,
  BILLING_PM_UPDATE_LINK_ENABLED,
  BILLING_PM_UPDATE_LINK_OFF,
} from "./billing-controls-flag";

const rentalInput = z.object({ rentalId: z.string().uuid() }).strict();
const weekdayInput = rentalInput.extend({ weekday: z.number().int().min(0).max(6) }).strict();
const paymentMethodInput = rentalInput.extend({ paymentMethodId: z.string().min(3).max(255) }).strict();
const extensionInput = rentalInput.extend({
  invoiceId: z.string().min(3).max(255),
  reason: z.string().trim().min(1).max(2000),
  newDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const gatePaymentMethodLink = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
  return next();
});

const gateBillingDayPreview = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!BILLING_DAY_CHANGE_ENABLED) throw new Error(BILLING_DAY_CHANGE_OFF);
  return next();
});

const gateBillingDayApply = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!BILLING_DAY_CHANGE_ENABLED) throw new Error(BILLING_DAY_CHANGE_OFF);
  if (!BILLING_DAY_APPLY_ENABLED) throw new Error(BILLING_DAY_APPLY_OFF);
  return next();
});

const gatePaymentExtension = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!BILLING_ONE_TIME_EXTENSION_ENABLED) throw new Error(BILLING_ONE_TIME_EXTENSION_OFF);
  if (!BILLING_EXTENSION_RECORD_ENABLED) throw new Error(BILLING_EXTENSION_RECORD_OFF);
  return next();
});

/** Owner or Manager. The flag throws before auth and before the role check. */
export const createBillingPaymentMethodLink = createServerFn({ method: "POST" })
  .middleware([gatePaymentMethodLink, requireSupabaseAuth])
  .inputValidator((input: unknown) => rentalInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performCreatePaymentMethodLink } = await import("./billing-controls.server");
    const created = await performCreatePaymentMethodLink(data.rentalId);
    return { url: created.url };
  });

/** Staff-initiated send. Creating a link does not email. */
export const sendBillingPaymentMethodLink = createServerFn({ method: "POST" })
  .middleware([gatePaymentMethodLink, requireSupabaseAuth])
  .inputValidator((input: unknown) => rentalInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performSendPaymentMethodLink } = await import("./billing-controls.server");
    return performSendPaymentMethodLink(data.rentalId);
  });

export const verifyBillingPaymentMethod = createServerFn({ method: "POST" })
  .middleware([gatePaymentMethodLink, requireSupabaseAuth])
  .inputValidator((input: unknown) => rentalInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performVerifyPaymentMethod } = await import("./billing-controls.server");
    return performVerifyPaymentMethod(data.rentalId);
  });

/** Owner confirms the attached method becomes the subscription default. */
export const setBillingSubscriptionDefault = createServerFn({ method: "POST" })
  .middleware([gatePaymentMethodLink, requireSupabaseAuth])
  .inputValidator((input: unknown) => paymentMethodInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_PM_UPDATE_LINK_ENABLED) throw new Error(BILLING_PM_UPDATE_LINK_OFF);
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { performSetSubscriptionDefault } = await import("./billing-controls.server");
    return performSetSubscriptionDefault(data.rentalId, data.paymentMethodId);
  });

/** Read-only preview. Apply stays behind the journal flag. */
export const previewBillingDay = createServerFn({ method: "POST" })
  .middleware([gateBillingDayPreview, requireSupabaseAuth])
  .inputValidator((input: unknown) => weekdayInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_DAY_CHANGE_ENABLED) throw new Error(BILLING_DAY_CHANGE_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performPreviewBillingDay } = await import("./billing-controls.server");
    return performPreviewBillingDay(data.rentalId, data.weekday);
  });

export const applyBillingDay = createServerFn({ method: "POST" })
  .middleware([gateBillingDayApply, requireSupabaseAuth])
  .inputValidator((input: unknown) => weekdayInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_DAY_CHANGE_ENABLED) throw new Error(BILLING_DAY_CHANGE_OFF);
    if (!BILLING_DAY_APPLY_ENABLED) throw new Error(BILLING_DAY_APPLY_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performApplyBillingDay } = await import("./billing-controls.server");
    return performApplyBillingDay({
      actorId: context.userId,
      claims: context.claims,
      rentalId: data.rentalId,
      targetWeekday: data.weekday,
    });
  });

export const grantBillingExtension = createServerFn({ method: "POST" })
  .middleware([gatePaymentExtension, requireSupabaseAuth])
  .inputValidator((input: unknown) => extensionInput.parse(input))
  .handler(async ({ context, data }) => {
    if (!BILLING_ONE_TIME_EXTENSION_ENABLED) throw new Error(BILLING_ONE_TIME_EXTENSION_OFF);
    if (!BILLING_EXTENSION_RECORD_ENABLED) throw new Error(BILLING_EXTENSION_RECORD_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { performGrantPaymentExtension } = await import("./billing-controls.server");
    return performGrantPaymentExtension({
      actorId: context.userId,
      claims: context.claims,
      rentalId: data.rentalId,
      invoiceId: data.invoiceId,
      reason: data.reason,
      newDue: data.newDue,
    });
  });
