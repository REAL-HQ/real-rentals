import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
    // ---- Duplicate detection: same phone OR email within the last 30 days ----
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dupes } = await supabaseAdmin
      .from("applications")
      .select("id, primary_application_id, resubmission_count, resubmission_history, created_at")
      .or(`phone.eq.${data.phone},email.eq.${data.email}`)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = dupes?.[0];
    if (existing) {
      const primaryId = existing.primary_application_id ?? existing.id;
      // Build patch of new/changed fields, ignoring nulls/undefined
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      const history = Array.isArray(existing.resubmission_history)
        ? (existing.resubmission_history as unknown[])
        : [];
      history.push({
        at: new Date().toISOString(),
        source: data.source,
        pickup_date: data.pickup_date ?? null,
        return_date: data.return_date ?? null,
        market_id: data.market_id ?? null,
      });
      patch.resubmission_count = (existing.resubmission_count ?? 0) + 1;
      patch.resubmission_history = history;
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from("applications")
        .update(patch as any)
        .eq("id", primaryId);
      if (updErr) throw new Error(updErr.message);
      // Fire-and-forget lead alert email so ops still sees the return visit.
      try {
        const { sendLeadAlertEmail } = await import("@/lib/email.server");
        let marketName: string | null = null;
        if (data.market_id) {
          const { data: m } = await supabaseAdmin
            .from("markets")
            .select("name")
            .eq("id", data.market_id)
            .maybeSingle();
          marketName = m?.name ?? null;
        }
        void sendLeadAlertEmail({
          event: "new",
          applicationId: primaryId,
          full_name: data.full_name,
          phone: data.phone,
          email: data.email,
          city: data.city ?? null,
          state: data.state ?? null,
          market: marketName,
          pickup_date: data.pickup_date ?? null,
          return_date: data.return_date ?? null,
          platforms: null,
          sms_consent: data.sms_consent ?? null,
          source: `${data.source} (resubmission #${patch.resubmission_count})`,
        }).catch((e) => console.error("[lead-email] resubmission failed", e));
      } catch (e) {
        console.error("[lead-email] resubmission setup failed", e);
      }
      return { id: primaryId };
    }

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
  trip_screenshots: z.array(z.string().trim().max(500)).max(10).nullable().optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  // Driver
  license_photo_url: z.string().trim().max(500).nullable().optional(),
  full_coverage_insurance: z.boolean().nullable().optional(),
  insurance_doc_url: z.string().trim().max(500).nullable().optional(),
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
  if (row.profile_screenshot_url) s += 10;
  const shotCount = Array.isArray(row.trip_screenshots) ? row.trip_screenshots.length : 0;
  if (shotCount >= 2) s += 12;
  else if (shotCount === 1) s += 8;
  const trips = Number(row.trips_completed);
  if (!Number.isNaN(trips)) {
    if (trips >= 1000) s += 14;
    else if (trips >= 500) s += 10;
    else if (trips >= 200) s += 8;
  }
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
      landing_page: nullableString,
      referrer: nullableString,
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // ---- Duplicate detection: same phone OR email within the last 30 days ----
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dupes } = await supabaseAdmin
      .from("applications")
      .select("id, primary_application_id, resubmission_count, resubmission_history, created_at")
      .or(`phone.eq.${data.phone},email.eq.${data.email}`)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = dupes?.[0];
    if (existing) {
      const primaryId = existing.primary_application_id ?? existing.id;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      const history = Array.isArray(existing.resubmission_history)
        ? (existing.resubmission_history as unknown[])
        : [];
      history.push({
        at: new Date().toISOString(),
        source: data.source,
        pickup_date: data.pickup_date ?? null,
        return_date: data.return_date ?? null,
        market_id: data.market_id ?? null,
      });
      patch.resubmission_count = (existing.resubmission_count ?? 0) + 1;
      patch.resubmission_history = history;
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from("applications")
        .update(patch as any)
        .eq("id", primaryId);
      if (updErr) throw new Error(updErr.message);
      return { id: primaryId };
    }

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({ ...data, status: "partial", current_step: "eligibility" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Fire-and-forget lead alert email. Never block the form submission.
    try {
      const { sendLeadAlertEmail } = await import("@/lib/email.server");
      let marketName: string | null = null;
      if (data.market_id) {
        const { data: m } = await supabaseAdmin
          .from("markets")
          .select("name")
          .eq("id", data.market_id)
          .maybeSingle();
        marketName = m?.name ?? null;
      }
      void sendLeadAlertEmail({
        event: "new",
        applicationId: row.id,
        full_name: data.full_name,
        phone: data.phone,
        email: data.email,
        city: data.city ?? null,
        state: data.state ?? null,
        market: marketName,
        pickup_date: data.pickup_date ?? null,
        return_date: data.return_date ?? null,
        platforms: null,
        sms_consent: data.sms_consent,
        source: data.source,
      }).catch((e) => console.error("[lead-email] new failed", e));
    } catch (e) {
      console.error("[lead-email] new setup failed", e);
    }
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

    // Derive rental duration from dates whenever both are known on this update.
    // Fetch current row to fill in any missing date.
    const { data: existing } = await supabaseAdmin
      .from("applications")
      .select("pickup_date, return_date")
      .eq("id", id)
      .maybeSingle();
    const pickup = (patch.pickup_date as string | undefined) ?? existing?.pickup_date ?? null;
    const ret = (patch.return_date as string | undefined) ?? existing?.return_date ?? null;
    if (pickup && ret && ret > pickup) {
      const days = Math.round(
        (new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000,
      );
      patch.rental_duration_days = days;
      patch.rental_duration =
        days <= 14 ? "1-2 weeks" : days <= 28 ? "2-4 weeks" : days <= 60 ? "1-2 months" : "3+ months";
    }

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
    // Wizard-complete alert email. Fire-and-forget.
    if (isComplete) {
      try {
        const { sendLeadAlertEmail } = await import("@/lib/email.server");
        let marketName: string | null = null;
        if (row.market_id) {
          const { data: m } = await supabaseAdmin
            .from("markets")
            .select("name")
            .eq("id", row.market_id)
            .maybeSingle();
          marketName = m?.name ?? null;
        }
        void sendLeadAlertEmail({
          event: "complete",
          applicationId: row.id,
          full_name: row.full_name ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          city: row.city ?? null,
          state: row.state ?? null,
          market: marketName,
          pickup_date: row.pickup_date ?? null,
          return_date: row.return_date ?? null,
          platforms: Array.isArray(row.platforms) ? row.platforms : null,
          sms_consent: row.sms_consent ?? null,
          source: row.source ?? null,
        }).catch((e) => console.error("[lead-email] complete failed", e));
      } catch (e) {
        console.error("[lead-email] complete setup failed", e);
      }
      // Fire-and-forget AI scoring on wizard completion.
      try {
        const { runScoring } = await import("@/lib/scoring.functions");
        void runScoring(supabaseAdmin, row.id).catch((e) =>
          console.error("[ai-scoring] complete failed", e),
        );
      } catch (e) {
        console.error("[ai-scoring] complete setup failed", e);
      }
    }
    return { ok: true, score: newScore };
  });

export const getApplicationForWizard = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      // NOTE: The lead id lives in a shareable /thank-you?id= URL, so this
      // endpoint is effectively public. Do NOT return contact PII (email,
      // phone, full address, zip) or admin-only fields (status, notes,
      // score, user_id). Return only what the wizard needs to resume:
      // progress state, the driver's first name for greeting, and the
      // non-sensitive form values the driver themselves entered.
      .select("id, full_name, pickup_date, return_date, city, state, market_id, current_step, source, license_valid, gig_status, start_timing, vehicle_size, rental_duration, platforms, profile_screenshot_url, trip_screenshots, trips_completed, rating, license_photo_url, full_coverage_insurance, insurance_doc_url, how_heard")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Application not found");
    // Reduce full_name to a first name only. Enough for the greeting,
    // avoids handing out the lead's full identity to anyone with the URL.
    const firstName = (row.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    return { ...row, full_name: firstName };
  });

// ---------------- Admin: merge duplicate applications ----------------
// One-time cleanup: groups existing applications by phone/email and links
// older duplicates to the newest surviving record. Admin-only.
export const mergeDuplicateApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: adminRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: all, error } = await supabaseAdmin
      .from("applications")
      .select("id, phone, email, created_at, primary_application_id, resubmission_count")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const groups = new Map<string, typeof all>();
    for (const row of all ?? []) {
      for (const key of [
        row.phone ? `phone:${row.phone.trim().toLowerCase()}` : null,
        row.email ? `email:${row.email.trim().toLowerCase()}` : null,
      ]) {
        if (!key) continue;
        const arr = groups.get(key) ?? [];
        arr.push(row);
        groups.set(key, arr);
      }
    }

    const linked = new Set<string>();
    let mergedCount = 0;
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      // rows are ordered newest first; primary = first not already linked
      const primary = rows.find((r) => !r.primary_application_id) ?? rows[0];
      for (const r of rows) {
        if (r.id === primary.id) continue;
        if (linked.has(r.id)) continue;
        const { error: uErr } = await supabaseAdmin
          .from("applications")
          .update({
            primary_application_id: primary.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        if (!uErr) {
          linked.add(r.id);
          mergedCount += 1;
        }
      }
      // Bump the primary's resubmission_count to reflect discovered dupes.
      const bump = rows.length - 1;
      if (bump > 0) {
        await supabaseAdmin
          .from("applications")
          .update({
            resubmission_count: (primary.resubmission_count ?? 0) + bump,
          })
          .eq("id", primary.id);
      }
    }
    return { merged: mergedCount };
  });