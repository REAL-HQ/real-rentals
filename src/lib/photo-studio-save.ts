// Replacing a live marketing shot. The publish trigger and the one-live-shot
// unique index both have to be satisfied before the new row can be inserted.
import { RETIRE_LIVE_SHOT } from "@/lib/photo-studio";

/** Unpublish and reject every live shot in a slot. A still-published reject
 * is refused by the trigger; this write clears published in the same update. */
export async function retireLiveMarketingShots(
  sb: { from: (table: string) => { update: (patch: Record<string, unknown>) => any } },
  vehicleId: string,
  slot: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from("vehicle_media")
    .update({ ...RETIRE_LIVE_SHOT })
    .eq("vehicle_id", vehicleId)
    .eq("kind", "marketing")
    .eq("shot_slot", slot)
    .neq("studio_review_status", "rejected");
  if (error) return { ok: false, error: error.message || "Could not replace the existing shot." };
  return { ok: true };
}
