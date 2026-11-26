import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FORFEITED_FEE_CREDIT_MODES,
  readForfeitedFeeCreditSettings,
  type CancelledRentalCredit,
  type ForfeitedFeeCreditSettings,
} from "@/lib/forfeited-fee-credit";

const settingsInput = z.object({
  mode: z.enum(FORFEITED_FEE_CREDIT_MODES),
  days: z.number().int().min(1).max(3650),
});

/** Staff can read the policy. Saving is Manager and above. */
export const getForfeitedFeeCreditSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ForfeitedFeeCreditSettings> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadForfeitedFeeCreditSettings } = await import("@/lib/forfeited-fee-credit.server");
    return loadForfeitedFeeCreditSettings(supabaseAdmin);
  });

export const saveForfeitedFeeCreditSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsInput.parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveForfeitedFeeCreditSettings: save } = await import("@/lib/forfeited-fee-credit.server");
    const { logAudit } = await import("@/lib/audit.server");
    const settings = readForfeitedFeeCreditSettings(data);
    const saved = await save(supabaseAdmin, settings);
    if (!saved.ok) throw new Error(saved.error);
    await logAudit(actor, {
      action: "settings.forfeited_fee_credit",
      summary: `Forfeited fee credit ${settings.mode}, ${settings.days} days`,
      entityType: "app_settings",
      entityId: "forfeited_fee_credit",
      metadata: settings,
    });
    return { ok: true };
  });

export const listKeptFeeCreditOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      rentalIds: z.array(z.string().uuid()).max(100),
      applicationIds: z.array(z.string().uuid()).max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{
    mode: ForfeitedFeeCreditSettings["mode"];
    offers: { rentalId: string; paymentId: string }[];
    credits: CancelledRentalCredit[];
  }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadCancelledRentalCredits, loadKeptFeeOffers } = await import("@/lib/forfeited-fee-credit.server");
    const [found, credits] = await Promise.all([
      loadKeptFeeOffers(supabaseAdmin, data.rentalIds),
      loadCancelledRentalCredits(supabaseAdmin, data.rentalIds, data.applicationIds ?? []),
    ]);
    return { mode: found.settings.mode, offers: found.offers, credits };
  });
