import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applicantPhone } from "@/lib/applicant-validation";
import { z } from "zod";

const nullableString = z.string().trim().max(255).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

/*
 * Three applicant endpoints used to live here: submitApplication,
 * getApplicationRentalInfo and completeApplicationProfile. All three are gone.
 *
 * None of them had a caller anywhere in the app, and all three authorized on a
 * bare application UUID — completeApplicationProfile would take an id off the
 * wire and write rental dates onto that row. A createServerFn is an HTTP
 * endpoint whether or not the UI ever calls it, so leaving them exported would
 * have left exactly the UUID-as-credential hole the resume tokens exist to
 * close. The live paths are savePartialApplication (creates), and
 * getApplicationForWizard / updateApplicationStep (token-authorized).
 */

// ---------------- Multi-step wizard server fns ----------------

/**
 * The wizard's steps, in the order an applicant meets them.
 *
 * Part 1 is `rental` then `driving`; submitting it lands on `submitted`, which
 * is the conversion. Part 2 is `documents`, finishing at `profile_complete`.
 *
 * `submitted` deliberately is not called "complete": the storage and screening
 * gates both treat a current_step of complete/done/confirmation as "this
 * application is finished, stop accepting uploads", and Part 2 is entirely
 * about accepting uploads after Part 1 is in.
 */
export const WIZARD_STEP_VALUES = [
  "rental",
  "driving",
  "submitted",
  "documents",
  "profile_complete",
] as const;

const stepUpdateSchema = z.object({
  // Not the application id. See resume-tokens.server.ts: holding the UUID no
  // longer authorizes anything.
  token: z.string().min(20).max(200),
  step: z.enum(WIZARD_STEP_VALUES),
  // Part 1 — rental intent
  vehicle_size: z.string().trim().max(40).nullable().optional(),
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expected_duration: z
    .enum(["1-2_weeks", "3-4_weeks", "1-2_months", "2plus_months", "ongoing"])
    .nullable()
    .optional(),
  // Part 1 — driving
  drive_type: z.enum(["full_time", "part_time"]).nullable().optional(),
  insurance_answer: z.enum(["yes", "no", "not_sure"]).nullable().optional(),
  // Part 2 — licence
  license_valid: z.boolean().nullable().optional(),
  gig_status: z.string().trim().max(60).nullable().optional(),
  // Gig
  platforms: z.array(z.string().trim().min(1).max(60)).max(12).nullable().optional(),
  profile_screenshot_url: z.string().trim().max(500).nullable().optional(),
  trips_completed: z.string().trim().max(40).nullable().optional(),
  trip_screenshots: z.array(z.string().trim().max(500)).max(10).nullable().optional(),
  // Which of the stored trip screenshots to keep, by index. The browser never
  // receives their storage paths, so it cannot send back a rewritten array —
  // it says which ones to drop and the server does the rewriting.
  trip_screenshots_keep: z.array(z.number().int().min(0).max(49)).max(50).nullable().optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  // Part 2 — insurance and address
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
  // how_heard is deliberately absent. The question is gone from the applicant
  // flow and nothing replaces it; the column and its history stay untouched,
  // but no applicant-facing endpoint may write it any more.
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
        phone: applicantPhone,
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
        // No return_date. The lead forms ask when someone wants to start, not
        // when they will bring the car back — that is a contractual date and
        // an applicant cannot know it at this point. Part 1 asks for an
        // expected duration instead. The column keeps its history.
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
    //
    // Two queries, not one `.or()`.
    //
    // This used to be .or(`phone.eq.${data.phone},email.eq.${data.email}`) —
    // the applicant's own phone number interpolated straight into a PostgREST
    // filter expression, in which a comma separates conditions. A phone of
    // "1234567,status.eq.new" therefore added a third condition of the
    // caller's choosing, widening the match to somebody else's application.
    // The handler then patches whatever it matches with the submitted name,
    // phone and email and returns a resume token for it: an anonymous form
    // post that overwrites a stranger's record and hands back a working link
    // to it.
    //
    // The regex on `phone` above closes that, but a validator is one mistake
    // away from being loosened again. Passing the values as arguments instead
    // of splicing them into a query language removes the class of bug rather
    // than this instance of it.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const dupeCols =
      "id, primary_application_id, resubmission_count, resubmission_history, created_at";
    const [byPhone, byEmail] = await Promise.all([
      supabaseAdmin
        .from("applications")
        .select(dupeCols)
        .eq("phone", data.phone)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin
        .from("applications")
        .select(dupeCols)
        .eq("email", data.email)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const existing = [...(byPhone.data ?? []), ...(byEmail.data ?? [])].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0];
    if (existing) {
      const primaryId = existing.primary_application_id ?? existing.id;

      /*
       * A match is not an authentication.
       *
       * This endpoint is anonymous — it backs the public lead forms — and it
       * matches on email or phone, neither of which is a secret. Returning a
       * resume token here meant that submitting the form with somebody else's
       * email handed the caller a 14-day credential for that person's
       * application: their address, their insurance details, write access to
       * their row, upload access to their folder. The whole premise of this
       * change is that the token is the credential, so it cannot be given out
       * on the strength of a guessable value.
       *
       * The identity fields go the same way. An unauthenticated request must
       * not be able to overwrite the name, phone or email on a record that
       * already exists — that is how a victim stops receiving their own mail.
       * They are recorded in resubmission_history for staff to reconcile.
       */
      const IDENTITY = new Set(["full_name", "phone", "email"]);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (IDENTITY.has(k)) continue;
        if (v !== undefined && v !== null && v !== "") patch[k] = v;
      }
      const history = Array.isArray(existing.resubmission_history)
        ? (existing.resubmission_history as unknown[])
        : [];
      history.push({
        at: new Date().toISOString(),
        source: data.source,
        pickup_date: data.pickup_date ?? null,
        market_id: data.market_id ?? null,
        // Submitted, not applied. Staff decide whether this is the same person.
        submitted_full_name: data.full_name,
        submitted_phone: data.phone,
        submitted_email: data.email,
      });
      patch.resubmission_count = (existing.resubmission_count ?? 0) + 1;
      patch.resubmission_history = history;
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await supabaseAdmin
        .from("applications")
        .update(patch as any)
        .eq("id", primaryId);
      if (updErr) throw new Error(updErr.message);
      // The link goes to the address already on the record, never back to the
      // caller. A genuine returning applicant finds it in the inbox they
      // originally gave us; anybody else learns nothing.
      try {
        const { data: onFile } = await supabaseAdmin
          .from("applications")
          .select("email, full_name")
          .eq("id", primaryId)
          .maybeSingle();
        if (onFile?.email) {
          const { sendApplicationResumeEmail } = await import("@/lib/email.server");
          await sendApplicationResumeEmail({
            to: onFile.email,
            firstName: onFile.full_name ?? null,
            applicationId: primaryId,
          });
        }
      } catch (e) {
        console.error("[lead-email] returning-applicant link failed", primaryId, e);
      }
      return { id: primaryId, token: null as string | null, existing: true as const };
    }

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({ ...data, status: "partial", current_step: "rental" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Minted before anything else can fail. Without it the applicant has a row
    // they can never get back to.
    const { issueResumeToken } = await import("@/lib/resume-tokens.server");
    const token = await issueResumeToken(supabaseAdmin, row.id);
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
        return_date: null,
        platforms: null,
        sms_consent: data.sms_consent,
        source: data.source,
      }).catch((e) => console.error("[lead-email] new failed", e));
    } catch (e) {
      console.error("[lead-email] new setup failed", e);
    }
    return { id: row.id, token: token as string | null, existing: false as const };
  });

export const updateApplicationStep = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => stepUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { token, step, ...fields } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveResumeToken } = await import("@/lib/resume-tokens.server");
    const id = await resolveResumeToken(supabaseAdmin, token);

    // Clean undefined keys so we never overwrite with NULL by accident
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === "trip_screenshots_keep") continue;
      if (v !== undefined) patch[k] = v;
    }

    // Part 1 landing on `submitted` is the conversion: this is a real
    // application from here on, and staff see it whether or not Part 2 is ever
    // touched. Part 2 finishing does not move the status again — the team, not
    // the applicant, decides what happens to a submitted application.
    const isSubmission = step === "submitted";
    patch.current_step = step;

    // One read of the row as it stands. Three later decisions need it:
    // whether this write may promote the status, what coverage answer is
    // already on file, and which stored trip screenshots survive a removal.
    const { data: before } = await supabaseAdmin
      .from("applications")
      .select("status, full_coverage_insurance, trip_screenshots")
      .eq("id", id)
      .maybeSingle();

    // Removal by index, resolved against the stored array. An out-of-range
    // index drops out rather than erroring: the worst it can do is keep a
    // file the applicant wanted gone, which they can retry.
    if (Array.isArray(fields.trip_screenshots_keep)) {
      const stored = Array.isArray(before?.trip_screenshots)
        ? (before.trip_screenshots as string[])
        : [];
      const keep = new Set(fields.trip_screenshots_keep);
      const survivors = stored.filter((_, i) => keep.has(i));
      const added = Array.isArray(patch.trip_screenshots)
        ? (patch.trip_screenshots as string[]).filter((p) => !stored.includes(p))
        : [];
      patch.trip_screenshots = [...survivors, ...added].slice(0, 10);
    }

    // Promote to "new" on submission, and only out of "partial".
    //
    // This used to set status unconditionally, so any write carrying
    // step:"submitted" over a still-live token would walk an approved, active
    // or closed application back to new — a decided record reappearing in the
    // team's queue because somebody reopened an old tab.
    if (isSubmission && String(before?.status ?? "").toLowerCase() === "partial") {
      patch.status = "new";
    }

    // Three-state insurance. "Not sure" is an answer, and it is not "no".
    //
    // full_coverage_insurance stays the boolean it always was and stays NULL
    // for not_sure, so every downstream reader — readiness included — keeps
    // treating it as unknown. insurance_answer is what distinguishes "they
    // told us they don't know" from "we never asked", which is a difference
    // staff can act on and a boolean cannot express.
    if (fields.insurance_answer !== undefined && fields.insurance_answer !== null) {
      patch.full_coverage_insurance =
        fields.insurance_answer === "yes" ? true : fields.insurance_answer === "no" ? false : null;
    }

    // Derive a single qualify/disqualify signal from whatever insurance detail
    // we have, so the team can triage a new lead without opening the record.
    // Verification is a human step, so this never promotes to "verified".
    //
    // The coverage answer comes from Part 1 and the carrier, policy and expiry
    // come from Part 2, so by the time the detail arrives the boolean is only
    // on the row — not in this payload. Reading it from the patch alone made
    // an applicant who answered "yes" and then uploaded their insurance card
    // fall back from "declared" to "unknown": triage lost the signal at the
    // exact moment the evidence got stronger.
    if (
      patch.full_coverage_insurance !== undefined ||
      fields.insurance_expires_on !== undefined ||
      fields.insurance_carrier !== undefined
    ) {
      const hasCoverage = (patch.full_coverage_insurance ??
        before?.full_coverage_insurance) as boolean | null | undefined;
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

    // Rental duration from the applicant's stated expectation.
    //
    // This used to be computed as return_date minus pickup_date. Both of those
    // were guesses typed into a date picker by somebody who had not yet been
    // quoted a rate, and the difference between them was then written into
    // rental_duration as though it were a plan. Now the applicant says how
    // long they expect to need the car and that answer is stored as given.
    //
    // rental_duration_days is still a number, but it is explicitly the
    // midpoint of the band they chose, not a date arithmetic result, and
    // nothing contractual reads it.
    const DURATION_LABELS: Record<string, { label: string; days: number }> = {
      "1-2_weeks": { label: "1-2 weeks", days: 10 },
      "3-4_weeks": { label: "3-4 weeks", days: 24 },
      "1-2_months": { label: "1-2 months", days: 45 },
      "2plus_months": { label: "2+ months", days: 90 },
      ongoing: { label: "Ongoing", days: 90 },
    };
    const band = fields.expected_duration ? DURATION_LABELS[fields.expected_duration] : null;
    if (band) {
      patch.rental_duration = band.label;
      patch.rental_duration_days = band.days;
    }

    // Promote to "new" on submission, and only out of "partial".
    //
    // This used to set status unconditionally, so any write carrying
    // step:"submitted" over a still-live token would walk an approved, active
    // or closed application back to new — a decided record reappearing in the
    // team's queue because somebody reopened an old tab.
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

    // Wizard-complete alert email. Fire-and-forget. Gated on the promotion
    // actually happening, so a replayed submission does not re-alert the team
    // or re-enrol a decided applicant in the follow-up sequence.
    if (isSubmission && patch.status === "new") {
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
          return_date: null,
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

/*
 * WHAT A RESUME TOKEN IS ALLOWED TO SEE
 *
 * A resume token exists so somebody can CONTINUE their own application. It is
 * a bearer credential that travels by email, so it must not double as a
 * retrieval key for everything they ever gave us. Every column on the row is
 * classified below; the payload is built by hand rather than spread, so a
 * column added to the table in future is withheld until somebody decides
 * otherwise.
 *
 * SAFE TO RETURN — the applicant typed it, the wizard renders it, and seeing
 * it again is the difference between resuming and starting over:
 *   first name, city, state, address, zip, pickup_date, expected_duration,
 *   vehicle_size, drive_type, platforms, trips_completed, rating, gig_status,
 *   license_valid, insurance_answer, full_coverage_insurance,
 *   insurance_carrier, insurance_expires_on, insurance_rideshare_endorsement,
 *   current_step, source
 *
 * MASK — useful to recognise, harmful to hand back in full:
 *   insurance_policy_number -> last four digits only, plus a flag. The wizard
 *   shows "Already Provided ••••4821" and offers to replace it. Nothing the
 *   applicant does requires reading the whole value back.
 *
 * PRESENCE-ONLY — the fact of the file, never its storage path. A path plus a
 * bucket name is the shape of an object; the wizard only ever needed to know
 * whether to say "Uploaded":
 *   license_photo_url, insurance_doc_url, profile_screenshot_url ->
 *   booleans; trip_screenshots -> a count and the display names only.
 *
 * DO NOT RETURN — the applicant cannot act on it, or it is ours:
 *   id and market_id (internal identifiers), email and phone (contact
 *   details, and knowing them is how the dedupe attack started), dob,
 *   license_number, license_state, license_expiration, status, notes,
 *   doc_request_note, score, scored_at, ai_score, ai_tier, ai_flags,
 *   ai_summary, user_id, reviewed_at, reviewed_by, contacted_at,
 *   weekly_rent, deposit_amount, deposit_paid, deposit_status,
 *   payment_status, card_last4, card_brand, card_exp_*, card_on_file_at,
 *   stripe_*, vehicle_id, primary_application_id, resubmission_*,
 *   contract_start_date, contract_end_date, background_check_status,
 *   mvr_status, earnings_verified_status, rideshare_history_status,
 *   incident_count, requested_docs, recovery_*, sms_opt_out_at, utm_*,
 *   gclid, landing_page, referrer, return_date, start_timing, how_heard,
 *   platform_status, platform_active, rental_*, weekly_hours,
 *   years_licensed, consent_*, insurance_status, dob.
 *
 * Nothing from driver_screenings, documents, audit_log or the readiness model
 * is reachable from here at all — this endpoint reads one table.
 */
const RESUME_COLUMNS = [
  "full_name",
  "city",
  "state",
  "address",
  "zip",
  "pickup_date",
  "expected_duration",
  "vehicle_size",
  "drive_type",
  "platforms",
  "trips_completed",
  "rating",
  "gig_status",
  "license_valid",
  "insurance_answer",
  "full_coverage_insurance",
  "insurance_carrier",
  "insurance_expires_on",
  "insurance_rideshare_endorsement",
  "current_step",
  "source",
  // Read to be reduced, never returned as-is.
  "insurance_policy_number",
  "license_photo_url",
  "insurance_doc_url",
  "profile_screenshot_url",
  "trip_screenshots",
] as const;

/** Last four characters of a reference, for recognition only. */
function lastFour(value: string | null | undefined): string | null {
  const clean = String(value ?? "").replace(/\s+/g, "");
  if (clean.length < 4) return clean ? "••••" : null;
  return clean.slice(-4);
}

export const getApplicationForWizard = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ token: z.string().min(20).max(200) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveResumeToken } = await import("@/lib/resume-tokens.server");
    const id = await resolveResumeToken(supabaseAdmin, data.token);
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .select(RESUME_COLUMNS.join(","))
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Application not found");

    const r = row as unknown as Record<string, unknown>;
    const trips = Array.isArray(r.trip_screenshots) ? (r.trip_screenshots as string[]) : [];

    return {
      // Enough for the greeting. The surname is not something the wizard
      // renders, so it does not travel.
      full_name: String(r.full_name ?? "").trim().split(/\s+/)[0] ?? "",
      city: (r.city ?? null) as string | null,
      state: (r.state ?? null) as string | null,
      address: (r.address ?? null) as string | null,
      zip: (r.zip ?? null) as string | null,
      pickup_date: (r.pickup_date ?? null) as string | null,
      expected_duration: (r.expected_duration ?? null) as string | null,
      vehicle_size: (r.vehicle_size ?? null) as string | null,
      drive_type: (r.drive_type ?? null) as string | null,
      platforms: (Array.isArray(r.platforms) ? r.platforms : []) as string[],
      trips_completed: (r.trips_completed ?? null) as string | null,
      rating: (r.rating ?? null) as number | null,
      gig_status: (r.gig_status ?? null) as string | null,
      license_valid: (r.license_valid ?? null) as boolean | null,
      insurance_answer: (r.insurance_answer ?? null) as string | null,
      full_coverage_insurance: (r.full_coverage_insurance ?? null) as boolean | null,
      insurance_carrier: (r.insurance_carrier ?? null) as string | null,
      insurance_expires_on: (r.insurance_expires_on ?? null) as string | null,
      insurance_rideshare_endorsement: (r.insurance_rideshare_endorsement ?? null) as
        | boolean
        | null,
      current_step: (r.current_step ?? null) as string | null,
      source: (r.source ?? null) as string | null,

      // Masked.
      insurance_policy_on_file: Boolean(r.insurance_policy_number),
      insurance_policy_last4: lastFour(r.insurance_policy_number as string | null),

      // Presence only — no storage paths cross this boundary.
      license_photo_on_file: Boolean(r.license_photo_url),
      insurance_doc_on_file: Boolean(r.insurance_doc_url),
      profile_screenshot_on_file: Boolean(r.profile_screenshot_url),
      trip_screenshot_names: trips.map((p) => String(p).split("/").pop() ?? ""),
    };
  });

/**
 * Hand the browser a one-time signed URL to upload one applicant file.
 *
 * Applicant uploads used to go straight from the browser to Supabase Storage
 * on the anon key, gated by a policy that checked the folder name was a real
 * application id. That made the application UUID a write credential, which is
 * the whole thing the resume tokens exist to stop.
 *
 * Now the token is checked here, this picks the path, and the service role
 * mints a signed upload URL for that one path. The bytes still go straight
 * from the phone to storage — they never pass through this server — but
 * nothing about the request is chosen by the caller except which document it
 * is, and the old anon INSERT policies are dropped.
 */
export const requestUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20).max(200),
        kind: z.enum(["license", "insurance", "gig_profile", "trip_history"]),
        // An allowlist, not a shape check. `[a-z0-9]{1,5}` would have accepted
        // "html", "svg" or "js" — and while these buckets are private and the
        // browser never picks the path, a file the server agreed to sign is a
        // file somebody eventually opens.
        ext: z.enum(["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveResumeToken } = await import("@/lib/resume-tokens.server");
    const id = await resolveResumeToken(supabaseAdmin, data.token);

    // The storage policies used to carry this check and no longer can: these
    // uploads are signed by the service role, which bypasses RLS entirely. The
    // token's own expiry covers the 14-day window that application_accepts_
    // uploads() enforced, but not the status half of it, so a decided
    // application would have gone on accepting files. Same rule, moved.
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    const decided = ["approved", "rejected", "active", "complete", "completed"];
    if (decided.includes(String(app?.status ?? "").toLowerCase())) {
      throw new Error(
        "This application has already been decided. Email team@drivereal.com and we'll add the document for you.",
      );
    }

    // One signed URL is one opportunity to write an object, so issuance is
    // capped. Generous on purpose: a driver profile is five documents, and
    // retakes on a phone camera are normal. Per application, because that is
    // what the token binds to.
    const WINDOW_MINUTES = 60;
    const MAX_GRANTS_PER_WINDOW = 40;
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("applicant_upload_grants")
      .select("id", { count: "exact", head: true })
      .eq("application_id", id)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_GRANTS_PER_WINDOW) {
      throw new Error(
        "That's a lot of uploads in one go. Give it an hour and try again, or email team@drivereal.com and we'll take the documents that way.",
      );
    }

    // The applicant names a document, never a destination. The bucket comes
    // from the kind, the folder from the token-resolved application id, and
    // the filename from a timestamp and a random suffix — so there is no
    // traversal to attempt, no other application's folder to reach, and no
    // existing object to overwrite. The restricted verification_recording
    // category is not in the `kind` enum at all and lives in a different
    // bucket entirely.
    const bucket =
      data.kind === "license" || data.kind === "insurance"
        ? "license-uploads"
        : "profile-screenshots";
    const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${data.ext}`;

    const { data: signed, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Could not start the upload.");
    // Recorded after the URL exists, so a failed issue does not spend quota.
    await supabaseAdmin
      .from("applicant_upload_grants")
      .insert({ application_id: id, kind: data.kind });
    return { bucket, path, uploadToken: signed.token };
  });

/**
 * Staff: revoke every live resume link for an application and mint a fresh one.
 *
 * This is the reissue path. It exists because the tokens are stored hashed —
 * nobody, including us, can recover a link once it has been sent — so "the
 * applicant lost the email" and "that link ended up somewhere it shouldn't"
 * have the same answer: kill the old ones, make a new one, send it.
 */
export const reissueApplicantLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string; revoked: number }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeResumeTokens, issueResumeToken, resumeUrl } =
      await import("@/lib/resume-tokens.server");

    const revoked = await revokeResumeTokens(supabaseAdmin, data.id);
    const url = resumeUrl(await issueResumeToken(supabaseAdmin, data.id));

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "application.link_reissued",
      summary: `Reissued the applicant link${revoked ? ` and revoked ${revoked}` : ""}`,
      entityType: "application",
      entityId: data.id,
      metadata: { revoked },
    });
    return { url, revoked };
  });

// ---------------- Admin: merge duplicate applications ----------------
// One-time cleanup: groups existing applications by phone/email and links
// older duplicates to the newest surviving record. Admin-only.
//
// KNOWN DEFECT, see docs/BACKLOG.md. Grouping by phone and by email
// separately, with the primary chosen from a stale snapshot, can link A <- B
// <- C instead of A <- B and A <- C. The middle row is then hidden by the
// admin list's status filter and the tail renders as orphaned history. It
// needs a union-find pass over the phone and email edges that picks one
// canonical primary per connected component and flattens the chains already
// in production. Left out of the Part 1 / Part 2 change on purpose.
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
