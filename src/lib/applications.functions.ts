import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const nullableString = z.string().trim().max(255).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

const submitApplicationSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(160),
  platform_status: z.enum(["Yes", "Pending", "Not Yet"]),
  rental_length: nullableString,
  rental_term: z.enum(["weekly", "monthly"]).nullable().optional(),
  vehicle_id: nullableUuid,
  market_id: nullableUuid,
  city: nullableString,
  state: nullableString,
  sms_consent: z.boolean().nullable().optional(),
  source: z.string().trim().max(40).nullable().optional(),
  utm_source: nullableString,
  utm_medium: nullableString,
  utm_campaign: nullableString,
  utm_term: nullableString,
  utm_content: nullableString,
  gclid: nullableString,
});

const completeApplicationSchema = z.object({
  id: z.string().uuid(),
  platforms: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  trips_completed: z.string().trim().max(40).nullable().optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  rental_term: z.enum(["weekly", "monthly"]),
  rental_length: z.string().trim().min(1).max(40),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickup_time: z.string().trim().min(1).max(20),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  return_time: z.string().trim().min(1).max(20),
});

export const submitApplication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitApplicationSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({ ...data, status: "new" })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const getApplicationRentalInfo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .select("rental_term, rental_length")
      .eq("id", data.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return { rental_term: row?.rental_term ?? null, rental_length: row?.rental_length ?? null };
  });

export const completeApplicationProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => completeApplicationSchema.parse(data))
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("applications").update(updates).eq("id", id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });