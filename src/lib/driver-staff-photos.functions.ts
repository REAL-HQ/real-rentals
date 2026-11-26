/**
 * Driver portal read of staff condition photos.
 * Preview may name a driver; portalScope checks the staff member.
 * There is no write, and no notice is sent.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DriverStaffAlbum, PhotoKind } from "@/lib/driver-staff-photos";

const previewInput = (value: unknown): { previewDriverId?: string } => {
  const id = (value as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
};

const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))
    throw new Error("Invalid photo");
  return value;
};

export const getDriverStaffPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ data, context }): Promise<DriverStaffAlbum> => {
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context, data, "staff_photos");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadDriverStaffAlbum } = await import("@/lib/driver-staff-photos.server");
    return loadDriverStaffAlbum(supabaseAdmin, scope.userId);
  });

export const openDriverStaffPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => {
    const body = (value ?? {}) as { id?: unknown; kind?: unknown };
    if (body.kind !== "condition" && body.kind !== "swap") throw new Error("Invalid photo");
    return { id: uuid(body.id), kind: body.kind as PhotoKind, ...previewInput(value) };
  })
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context, data, "staff_photo");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openDriverStaffPhoto: open } = await import("@/lib/driver-staff-photos.server");
    return open(supabaseAdmin, scope.userId, data.kind, data.id);
  });
