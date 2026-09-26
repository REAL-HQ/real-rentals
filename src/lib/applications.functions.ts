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
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
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
    // ---- Duplicate detection: normalized phone OR email, active records ----
    const emailNorm = data.email.trim().toLowerCase();
    const phoneDigits = data.phone.replace(/\D+/g, "");
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: dupes } = await supabaseAdmin
      .from("applications")
      .select(
        "id, primary_application_id, resubmission_count, resubmission_history, created_at, phone, email, status",
      )
      .or(`phone.ilike.%${phoneDigits.slice(-10)}%,email.ilike.${emailNorm}`)
      .neq("status", "duplicate")
      .gte("created_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(5);
    const existing = (dupes ?? []).find((r) => {
      const p = (r.phone ?? "").replace(/\D+/g, "");
      const e = (r.email ?? "").trim().toLowerCase();
      return (phoneDigits && p.endsWith(phoneDigits.slice(-10))) || (emailNorm && e === emailNorm);
    });
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
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
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
  insurance_carrier: z.string().trim().max(120).nullable().optional(),
  insurance_policy_number: z.string().trim().max(80).nullable().optional(),
  insurance_expires_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  insurance_rideshare_endorsement: z.boolean().nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(60).nullable().optional(),
  zip: z.string().trim().max(20).nullable().optional(),
  how_heard: z.string().trim().max(60).nullable().optional(),
});

/*
 * `applications.score` is legacy.
 *
 * computeScore() lived here and ran on every wizard step, writing a 0–100
 * number that the dashboard then coloured and sorted by. It was retired with
 * the deterministic readiness model, for the reason the whole model exists:
 * it scored every unanswered question as zero, so a thin application was
 * indistinguishable from a poor one. The applicant with a thousand completed
 * trips and an active gig account scored 12 out of 100 because she never
 * finished the web form.
 *
 * The canonical applicant-quality signal is now src/lib/readiness.ts, which
 * reports qualification and coverage separately and is computed on read rather
 * than stored.
 *
 * The column itself stays. It is NOT NULL DEFAULT 0, every historical value is
 * intact, and nothing recomputes, reinterprets or displays it as a current
 * signal — new rows simply take the default. Do not drop it, and do not
 * resurrect a writer for it.
 */

export const savePartialApplication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        full_name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(7).max(30),
        email: z.string().trim().email().max(160),
        sms_consent: z.boolean(),
        market_id: nullableUuid,
        city: nullableString,
        state: nullableString,
        pickup_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        return_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        source: z.enum(["homepage", "city_lp"]),
        utm_source: nullableString,
        utm_medium: nullableString,
        utm_campaign: nullableString,
        utm_term: nullableString,
        utm_content: nullableString,
        gclid: nullableString,
        landing_page: nullableString,
        referrer: nullableString,
      })
      .parse(data),
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
    if (isComplete) patch.status = "new";

    // Derive a single qualify/disqualify signal from whatever insurance detail
    // we have, so the team can triage a new lead without opening the record.
    // Verification is a human step, so this never promotes to "verified".
    if (
      fields.full_coverage_insurance !== undefined ||
      fields.insurance_expires_on !== undefined ||
      fields.insurance_carrier !== undefined
    ) {
      const hasCoverage = fields.full_coverage_insurance;
      const expires = fields.insurance_expires_on ?? null;
      const expired = expires ? new Date(expires) < new Date(new Date().toDateString()) : false;
      patch.insurance_status =
        hasCoverage === false
          ? "none"
          : expired
            ? "expired"
            : hasCoverage === true
              ? "declared"
              : "unknown";
    }

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
      const days = Math.round((new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000);
      patch.rental_duration_days = days;
      patch.rental_duration =
        days <= 14
          ? "1-2 weeks"
          : days <= 28
            ? "2-4 weeks"
            : days <= 60
              ? "1-2 months"
              : "3+ months";
    }

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .update(patch as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Mirror any files the applicant uploaded into the document vault so they
    // show up in the portal (where the renter can replace them) and in the
    // admin vault, instead of living only as a URL column on this row.
    //
    // AWAITED, deliberately. This was fire-and-forget, and on a serverless
    // runtime the worker tears down as soon as the response is returned — any
    // promise still in flight dies with it. Production showed the damage
    // precisely: one applicant uploaded four files and exactly one was
    // registered, the first entry in the loop, because the teardown landed
    // before the second round trip finished. Registering three documents is
    // worth the few hundred milliseconds it adds to a wizard step.
    //
    // Still non-fatal: a vault that failed to record a file must not fail the
    // applicant's step. The backfill in adminListDriverDocuments catches
    // anything missed here.
    try {
      const { syncApplicationUploads } = await import("@/lib/documents.functions");
      await syncApplicationUploads(supabaseAdmin, row);
    } catch (e) {
      console.error("[documents] application sync failed", e);
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
      // Start any active post-application follow-up sequence. Enrollment is
      // idempotent, so a re-submitted wizard never double-texts the applicant.
      try {
        const { enrollInWorkflows } = await import("@/lib/automations.server");
        void enrollInWorkflows({
          trigger: "application_submitted",
          applicationId: row.id,
        }).catch((e) => console.error("[automations] enroll on submit failed", e));
      } catch (e) {
        console.error("[automations] enroll setup failed", e);
      }
    }
    return { ok: true };
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
      .select(
        "id, full_name, pickup_date, return_date, city, state, market_id, current_step, source, license_valid, gig_status, start_timing, vehicle_size, rental_duration, platforms, profile_screenshot_url, trip_screenshots, trips_completed, rating, license_photo_url, full_coverage_insurance, insurance_doc_url, how_heard",
      )
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
            status: "duplicate",
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

/**
 * Approve an applicant and put the rental agreement in front of them.
 *
 * Approval and "send the contract" were previously two separate manual steps,
 * so an approved driver could sit waiting on a contract nobody remembered to
 * send. This does both, and is safe to call repeatedly: if an agreement is
 * already out for signature or already signed, it is not re-sent.
 */
export const approveApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        sendAgreement: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ok: boolean;
      agreementSent: boolean;
      agreementSkippedReason?: string;
      error?: string;
    }> => {
      // Manager, not staff. A Coordinator may read and work an application —
      // that is the vetting job — but approving it commits the business and
      // fires off the rental agreement, so it stays with someone trusted with
      // money.
      const { requireManager } = await import("@/lib/roles.server");
      const actor = await requireManager(context.userId);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: app } = await supabaseAdmin
        .from("applications")
        .select("id,status,email,full_name,contacted_at")
        .eq("id", data.id)
        .maybeSingle();
      if (!app) return { ok: false, agreementSent: false, error: "Application not found" };

      const patch: Record<string, unknown> = { status: "approved" };
      if (!app.contacted_at) patch.contacted_at = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from("applications")
        .update(patch as any)
        .eq("id", data.id);
      if (updErr) return { ok: false, agreementSent: false, error: updErr.message };

      const { logAudit } = await import("@/lib/audit.server");
      await logAudit(actor, {
        action: "application.approved",
        summary: `Approved ${app.full_name ?? app.email ?? data.id}`,
        entityType: "application",
        entityId: data.id,
        metadata: { previous_status: app.status, send_agreement: data.sendAgreement !== false },
      });

      if (data.sendAgreement === false) {
        return { ok: true, agreementSent: false, agreementSkippedReason: "not requested" };
      }
      if (!app.email) {
        return { ok: true, agreementSent: false, agreementSkippedReason: "no email on file" };
      }

      const { hasOpenOrSignedAgreement, issueAgreement } =
        await import("@/lib/agreements.functions");
      if (await hasOpenOrSignedAgreement(supabaseAdmin, data.id)) {
        return {
          ok: true,
          agreementSent: false,
          agreementSkippedReason: "an agreement is already out",
        };
      }

      try {
        await issueAgreement(supabaseAdmin, data.id, { createdBy: context.userId });
        return { ok: true, agreementSent: true };
      } catch (e) {
        // Approval already succeeded; report the send failure without undoing it.
        return {
          ok: true,
          agreementSent: false,
          agreementSkippedReason: e instanceof Error ? e.message : "could not send agreement",
        };
      }
    },
  );

// ---------------------------------------------------------- acknowledgement

/**
 * Record that a staff member has opened an application.
 *
 * The dashboard's "New" count means *unacknowledged*, not "status is still
 * new" — status only moves when somebody changes it by hand, so counting it
 * alone would keep showing work that has already been looked at.
 *
 * Stamped once and never overwritten: the useful fact is when it was first
 * seen, not most recently. Idempotent, so opening the same record twice is
 * free, and deliberately quiet — failing to record a read must never stop
 * somebody reading.
 */
export const acknowledgeApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    try {
      const { requireStaff } = await import("@/lib/roles.server");
      const actor = await requireStaff(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      await supabaseAdmin
        .from("applications")
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: actor.userId } as any)
        .eq("id", data.id)
        .is("reviewed_at", null);

      return { ok: true };
    } catch {
      // Not worth an error toast on top of the record the person came to read.
      return { ok: false };
    }
  });
