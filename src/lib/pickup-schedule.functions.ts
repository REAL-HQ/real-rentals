import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PICKUP_SCHEDULE_SETTINGS_KEY,
  validatePickupSchedule,
  type PickupScheduleSettings,
  type PickupSlot,
} from "@/lib/pickup-schedule";

/** Settings -> Rental Terms -> Pickup Schedule. Staff read; Owner saves. */
export const getPickupSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PickupScheduleSettings> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPickupSchedule } = await import("@/lib/reservation-confirmation.server");
    return loadPickupSchedule(supabaseAdmin);
  });

export const savePickupSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as PickupScheduleSettings)
  .handler(async ({ context, data }): Promise<PickupScheduleSettings> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const r = validatePickupSchedule(data);
    if (!r.ok) throw new Error(r.errors.join(" "));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: PICKUP_SCHEDULE_SETTINGS_KEY, value: r.value as never }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    try {
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit(actor, {
        action: "settings.pickup_schedule_saved",
        summary: `Pickup schedule saved (notifications ${r.value.notify.enabled ? "On" : "Off"})`,
        entityType: "app_settings",
        entityId: null,
        metadata: { days: r.value.days, start_times: r.value.startTimes, slot_minutes: r.value.slotMinutes, notify_enabled: r.value.notify.enabled },
      });
    } catch {
      /* best effort */
    }
    return r.value;
  });

/** Open slots for the Reserved dialog, earliest first. */
export const listPickupSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ slots: PickupSlot[]; settings: PickupScheduleSettings }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPickupSchedule } = await import("@/lib/reservation-confirmation.server");
    const { listOpenSlots } = await import("@/lib/fleet-pickup.server");
    const settings = await loadPickupSchedule(supabaseAdmin);
    const slots = await listOpenSlots(supabaseAdmin, settings, new Date(), { limit: 30 });
    return { slots, settings };
  });
