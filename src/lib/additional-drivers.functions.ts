import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { additionalDriverAgeBlock, type AdditionalDriverRow } from "@/lib/additional-drivers";

const driverInput = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(10).max(30),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licenseNumber: z.string().trim().min(4).max(30),
  licenseState: z.string().trim().regex(/^[A-Za-z]{2}$/),
  licenseExpiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  licensePhotoPath: z.string().min(8).max(240).nullable(),
  relationship: z.string().trim().min(2).max(40),
  smsConsent: z.boolean(),
});

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const saveApplicantAdditionalDrivers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(20).max(200), drivers: z.array(driverInput).max(3) }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveResumeToken } = await import("@/lib/resume-tokens.server");
    const { insertAdditionalDriver } = await import("@/lib/additional-drivers.server");
    const id = await resolveResumeToken(supabaseAdmin, data.token);
    const { data: app } = await supabaseAdmin.from("applications").select("status").eq("id", id).maybeSingle();
    const status = String(app?.status ?? "").toLowerCase();
    if (status && !["partial", "new", "reviewing", "docs_pending"].includes(status)) {
      return { ok: false, error: "This application is no longer accepting additional drivers." };
    }
    const today = todayEt();
    for (const driver of data.drivers) {
      const age = additionalDriverAgeBlock(driver.dob, today);
      if (age) return { ok: false, error: age };
      if (driver.licensePhotoPath && !driver.licensePhotoPath.startsWith(`${id}/`)) {
        return { ok: false, error: "That license photo is not one we issued." };
      }
      try {
        await insertAdditionalDriver(supabaseAdmin, null, { ...driver, applicationId: id });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save this driver." };
      }
    }
    return { ok: true };
  });

export const listStaffAdditionalDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid().optional(), rentalId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ rows: AdditionalDriverRow[]; reservationFeeSettled: boolean; includedDriverCount: number; weeklyFees: Record<string, number> }> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { includedAdditionalDriverCount, listAdditionalDrivers, reservationFeeSettled } = await import("@/lib/additional-drivers.server");
    const { weeklyFeeOnAgreement } = await import("@/lib/agreement-prep");
    const { currentAgreementMerge } = await import("@/lib/agreement-weekly.server");
    const rows = await listAdditionalDrivers(supabaseAdmin, data);
    const applicationId = data.applicationId ?? rows.find((r) => r.applicationId)?.applicationId ?? null;
    let included = 0;
    let weeklyFees: Record<string, number> = {};
    try {
      included = await includedAdditionalDriverCount(supabaseAdmin, { applicationId, rentalId: data.rentalId ?? rows.find((r) => r.rentalId)?.rentalId ?? null });
      const merge = await currentAgreementMerge(supabaseAdmin, applicationId);
      weeklyFees = Object.fromEntries(rows.flatMap((row) => {
        const fee = weeklyFeeOnAgreement(merge, row.name);
        return fee == null ? [] : [[row.id, fee]];
      }));
    } catch {
      included = 0;
    }
    return { rows, reservationFeeSettled: await reservationFeeSettled(supabaseAdmin, applicationId), includedDriverCount: included, weeklyFees };
  });

export const addStaffAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => driverInput.extend({ applicationId: z.string().uuid().nullable(), rentalId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager, getActor } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const actor = await getActor(context.userId);
    if (!actor) throw new Error("Forbidden");
    const age = additionalDriverAgeBlock(data.dob, todayEt());
    if (age) throw new Error(age);
    // A new application has no rental yet. Either id is enough. Status is not a gate.
    if (!data.applicationId && !data.rentalId) throw new Error("Choose an application or a rental.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { insertAdditionalDriver } = await import("@/lib/additional-drivers.server");
    return insertAdditionalDriver(supabaseAdmin, actor, data);
  });

async function managerActor(userId: string) {
  const { requireManager, getActor } = await import("@/lib/roles.server");
  await requireManager(userId);
  const actor = await getActor(userId);
  if (!actor) throw new Error("Forbidden");
  return actor;
}

export const approveAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await managerActor(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setAdditionalDriverStatus } = await import("@/lib/additional-drivers.server");
    return setAdditionalDriverStatus(supabaseAdmin, actor, data.id, "approved");
  });

export const declineAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await managerActor(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setAdditionalDriverStatus } = await import("@/lib/additional-drivers.server");
    return setAdditionalDriverStatus(supabaseAdmin, actor, data.id, "declined");
  });

export const markAdditionalDriverInsurance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await managerActor(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { markAdditionalDriverInsured } = await import("@/lib/additional-drivers.server");
    return markAdditionalDriverInsured(supabaseAdmin, actor, data.id);
  });

export const removeAdditionalDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await managerActor(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setAdditionalDriverStatus, unbillAdditionalDriver } = await import("@/lib/additional-drivers.server");
    const { data: existing } = await (supabaseAdmin as any).from("rental_additional_drivers").select("stripe_subscription_item_id").eq("id", data.id).maybeSingle();
    if (existing?.stripe_subscription_item_id) {
      const { createStripeClient } = await import("@/lib/stripe.server");
      await unbillAdditionalDriver(supabaseAdmin, actor, data.id, createStripeClient("live"));
    }
    return setAdditionalDriverStatus(supabaseAdmin, actor, data.id, "removed");
  });

export const billAdditionalDriverWeekly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await managerActor(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { billAdditionalDriver } = await import("@/lib/additional-drivers.server");
    const { createStripeClient } = await import("@/lib/stripe.server");
    return billAdditionalDriver(supabaseAdmin, actor, data.id, createStripeClient("live"));
  });
