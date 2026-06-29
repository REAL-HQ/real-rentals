import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const nullableString = z.string().trim().max(255).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

const submitApplicationSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(160),
  platform_status: z.enum(["Yes", "Pending", "Not Yet"]).nullable().optional(),
  rental_length: nullableString,
  rental_term: z.enum(["weekly", "monthly"]).nullable().optional(),
  vehicle_id: nullableUuid,
  market_id: nullableUuid,
  city: nullableString,
  state: nullableString,
  sms_consent: z.boolean().nullable().optional(),
  source: z.string().trim().max(40).nullable().optional(),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
      .insert({ ...data, status: "partial", current_step: "eligibility" })
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

// ---------------- Multi-step wizard server fns ----------------

const stepUpdateSchema = z.object({
  id: z.string().uuid(),
  step: z.enum(["eligibility", "rental", "gig", "driver", "complete"]),
  // Eligibility
  license_valid: z.boolean().nullable().optional(),
  gig_status: z.string().trim().max(60).nullable().optional(),
  start_timing: z.string().trim().max(60).nullable().optional(),
  // Rental
  vehicle_size: z.string().trim().max(40).nullable().optional(),
  rental_duration: z.string().trim().max(40).nullable().optional(),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Gig
  platforms: z.array(z.string().trim().min(1).max(60)).max(12).nullable().optional(),
  profile_screenshot_url: z.string().trim().max(500).nullable().optional(),
  trips_completed: z.string().trim().max(40).nullable().optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  // Driver
  license_photo_url: z.string().trim().max(500).nullable().optional(),
  full_coverage_insurance: z.boolean().nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(60).nullable().optional(),
  zip: z.string().trim().max(20).nullable().optional(),
  how_heard: z.string().trim().max(60).nullable().optional(),
});

function computeScore(row: any): number {
  let s = 0;
  if (row.gig_status === "Yes, already driving" || row.gig_status === "Yes") s += 30;
  else if (row.gig_status === "Not yet, ready to start" || row.gig_status === "Pending") s += 12;
  const platformCount = Array.isArray(row.platforms) ? row.platforms.length : 0;
  if (platformCount >= 3) s += 18;
  else if (platformCount === 2) s += 12;
  else if (platformCount === 1) s += 7;
  if (row.profile_screenshot_url) s += 18;
  if (typeof row.rating === "number" && row.rating >= 4.9) s += 10;
  else if (typeof row.rating === "number" && row.rating >= 4.7) s += 6;
  if (row.license_valid === true) s += 12;
  if (row.full_coverage_insurance === true) s += 10;
  if (row.license_photo_url) s += 5;
  if (row.start_timing === "Today" || row.start_timing === "This week") s += 5;
  return Math.min(100, s);
}

export const savePartialApplication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({
      full_name: z.string().trim().min(2).max(120),
      phone: z.string().trim().min(7).max(30),
      email: z.string().trim().email().max(160),
      sms_consent: z.boolean(),
      market_id: nullableUuid,
      city: nullableString,
      state: nullableString,
      pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      source: z.enum(["homepage", "city_lp"]),
      utm_source: nullableString,
      utm_medium: nullableString,
      utm_campaign: nullableString,
      utm_term: nullableString,
      utm_content: nullableString,
      gclid: nullableString,
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({ ...data, status: "partial", current_step: "eligibility" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateApplicationStep = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => stepUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { id, step, ...fields } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Clean undefined keys so we never overwrite with NULL by accident
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }

    const isComplete = step === "complete";
    patch.current_step = step;
    if (isComplete) patch.status = "complete";

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Recompute score on every step update
    const newScore = computeScore(row);
    if (newScore !== row.score) {
      await supabaseAdmin.from("applications").update({ score: newScore }).eq("id", id);
    }
    return { ok: true, score: newScore };
  });

export const getApplicationForWizard = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .select("id, full_name, email, phone, city, state, market_id, pickup_date, return_date, current_step, status, license_valid, gig_status, start_timing, vehicle_size, rental_duration, platforms, profile_screenshot_url, trips_completed, rating, license_photo_url, full_coverage_insurance, address, zip, how_heard")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Application not found");
    return row;
  });