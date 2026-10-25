import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { RentalActivationSettings } from "@/lib/rental-activation-settings";

// Settings → Rentals → Rental Terms: "Allow Activation Without Insurance Verification".
// Owner only. requireOwner refuses Managers and Coordinators here; the database
// function refuses them again (private.is_owner()) because it runs with the
// caller's own JWT, and the app_settings trigger refuses every other writer.

export const getRentalActivationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RentalActivationSettings> => {
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadRentalActivationSettings } =
      await import("@/lib/rental-activation-settings.server");
    return loadRentalActivationSettings(supabaseAdmin);
  });

export const SETTING_NOT_INSTALLED =
  "This setting needs the activation database update before it can be changed. Until then, insurance verification is required.";

export const setAllowActivationWithoutInsuranceVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ allow: z.boolean() }).strict().parse(d))
  .handler(
    async ({ data, context }): Promise<{ from: boolean; to: boolean; changedAt: string }> => {
      const { requireOwner } = await import("@/lib/roles.server");
      await requireOwner(context.userId);
      // The caller's own session, so auth.uid() inside the function is the Owner. The
      // change and its audit row (actor, old -> new, time) commit together or not at all.
      const { data: res, error } = await (
        context.supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>,
          ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
        }
      ).rpc("set_rental_activation_insurance_exception", {
        _allow: data.allow,
      });
      if (error) {
        if (error.code === "PGRST202") throw new Error(SETTING_NOT_INSTALLED);
        if (error.code === "42501" || /owner_required/.test(String(error.message)))
          throw new Error("Only the Owner can change this setting.");
        throw new Error("Could not save the setting. Nothing was changed.");
      }
      const r = (res ?? {}) as { from?: boolean; to?: boolean; changed_at?: string };
      if (r.to !== data.allow) throw new Error("Could not confirm the setting was saved.");
      return { from: r.from === true, to: r.to === true, changedAt: String(r.changed_at ?? "") };
    },
  );
