import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const nullableString = z.string().trim().max(255).nullable().optional();

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(7).max(30),
  vin: z.string().trim().length(17),
  year: z.number().int().min(1980).max(2100),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  trim: nullableString,
  mileage: z.number().int().nonnegative().nullable().optional(),
  title_status: nullableString,
  lien_status: nullableString,
  registration_state: nullableString,
  currently_insured: z.boolean().nullable().optional(),
  condition: nullableString,
  message: nullableString,
});

export const createFleetOwnerSubmission = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("fleet_owner_submissions")
      .insert({ ...data, photo_urls: [] })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

const updatePhotosSchema = z.object({
  id: z.string().uuid(),
  photo_urls: z.array(z.string().trim().min(1).max(300)).max(20),
});

export const updateFleetOwnerPhotos = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updatePhotosSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only accept paths scoped under this submission's folder.
    const prefix = `${data.id}/`;
    const cleaned = data.photo_urls.filter((p) => p.startsWith(prefix));
    const { error } = await supabaseAdmin
      .from("fleet_owner_submissions")
      .update({ photo_urls: cleaned })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });