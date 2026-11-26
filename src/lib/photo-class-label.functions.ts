// Backfill angle labels. Photo Studio's on/off switch does not apply.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { PHOTO_LABEL_COST_CENTS, PHOTO_LABEL_MODEL } from "@/lib/photo-class-label";
import { enqueuePhotoLabels, listUnlabeledIds } from "@/lib/photo-class-label.server";

const scope = z.object({ vehicleId: z.string().uuid().nullable() });

export const previewAutoLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scope.parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const ids = await listUnlabeledIds(data.vehicleId);
    return {
      ok: true as const,
      count: ids.length,
      costCents: PHOTO_LABEL_COST_CENTS,
      model: PHOTO_LABEL_MODEL,
    };
  });

/** Queue unlabeled originals. Returns before Gemini answers so the page stays responsive. */
export const autoLabelUnlabeled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scope.parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const ids = await listUnlabeledIds(data.vehicleId);
    enqueuePhotoLabels(ids, actor);
    return { ok: true as const, queued: ids.length, costCents: PHOTO_LABEL_COST_CENTS, model: PHOTO_LABEL_MODEL };
  });
