import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { OWNER_PNL_ENABLED } from "./owner-pnl-flag";
import { PNL_PRESETS, type PnlPreset } from "./owner-pnl-range";
import { OWNER_INCOME_SOURCES, type OwnerIncomeSource } from "./owner-pnl";
import type { OwnerPnlResponse, OwnerPnlViewResponse } from "./owner-pnl.server";

/**
 * Owner-only monthly P&L. While OWNER_PNL_ENABLED is false this returns
 * before the owner check and before any table or Stripe read.
 * Charges are listed by readLivePartnerCharges. Fees are listed by
 * readLiveOwnerPnlFees after the owner check. No writes, no new SQL, no email.
 */

const DISABLED: OwnerPnlResponse = { status: "disabled", report: null };

export const getOwnerPnl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<OwnerPnlResponse> => {
    if (!OWNER_PNL_ENABLED) return DISABLED;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOwnerPnlDirectory, runOwnerPnl } = await import("./owner-pnl.server");
    const { readLivePartnerCharges } = await import("./partner-statement-read.server");
    const { readLiveOwnerPnlFees } = await import("./owner-pnl-fees-read.server");
    return runOwnerPnl({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      month: data.month,
      load: () => loadOwnerPnlDirectory(supabaseAdmin),
      readCharges: (window) => readLivePartnerCharges(window),
      readFees: (window) => readLiveOwnerPnlFees(window),
    });
  });

const DISABLED_VIEW: OwnerPnlViewResponse = { status: "disabled", view: null };
const SOURCES = OWNER_INCOME_SOURCES.map((row) => row.source) as [OwnerIncomeSource, ...OwnerIncomeSource[]];

/**
 * Owner-only P&L for a chosen Eastern Time range. Same flag, same owner
 * check, and the same read-only Stripe and table reads. No writes.
 */
export const getOwnerPnlView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    preset: z.enum(PNL_PRESETS).default("this_month"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    vehicleId: z.string().uuid().nullable().optional(),
    driverId: z.string().uuid().nullable().optional(),
    source: z.enum(SOURCES).nullable().optional(),
    category: z.string().trim().min(1).max(40).nullable().optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<OwnerPnlViewResponse> => {
    if (!OWNER_PNL_ENABLED) return DISABLED_VIEW;
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOwnerPnlDirectory, runOwnerPnlView } = await import("./owner-pnl.server");
    const { readLivePartnerChargesTimed } = await import("./partner-statement-read.server");
    const { readLiveOwnerPnlFeeLines } = await import("./owner-pnl-fees-read.server");
    return runOwnerPnlView({
      enabled: true,
      userId: context.userId,
      tier: "owner",
      preset: data.preset as PnlPreset,
      from: data.from,
      through: data.through,
      filter: {
        vehicleId: data.vehicleId,
        driverId: data.driverId,
        source: data.source,
        category: data.category,
      },
      load: () => loadOwnerPnlDirectory(supabaseAdmin),
      readCharges: (window) => readLivePartnerChargesTimed(window, 45_000),
      readFeeLines: (window) => readLiveOwnerPnlFeeLines(window, 45_000),
    });
  });
