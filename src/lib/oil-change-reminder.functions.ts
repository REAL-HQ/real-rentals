// Read-only list of mileage-photo drafts for rented vehicles.
// Staff copy the text. This function does not send and does not store a draft.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OilChangePhotoDraft } from "@/lib/oil-next-due.server";

export type OilChangeReminderList = { ok: true; reminders: OilChangePhotoDraft[] };

export const listOilChangePhotoReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OilChangeReminderList> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listOilChangePhotoDrafts } = await import("@/lib/oil-next-due.server");
    const reminders = await listOilChangePhotoDrafts(supabaseAdmin);
    return { ok: true, reminders };
  });
