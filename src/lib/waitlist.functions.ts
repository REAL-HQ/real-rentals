import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { completeRead, readInBatches } from "@/lib/waitlist-reads.server";
import type { ReadinessResult } from "@/lib/readiness";

// Cars Available + waitlist.
//
// The owner sets a single number: how many cars are open right now. Above
// zero the public hero shows a scarcity line and takes normal applications;
// at zero it switches to waitlist mode and signed-out visitors join a queue.
// Positions exist only here and in the back office — the applicant-facing
// surface never shows a number, so nobody reads anything into their place
// in line.
//
// Availability lives in app_settings under key `fleet_availability`. A SQL
// function (cars_available()) exposes just that one number to anon callers;
// nothing else in settings is reachable without a session.

const emailLower = z
  .string()
  .email()
  .transform((e) => e.trim().toLowerCase());

// ---------------------------------------------------------------- public

export const getAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabasePublic = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabasePublic.rpc("cars_available");
  // Unset or unreadable means the feature is off: hero behaves as it always
  // did, and the back office shows "not set" rather than 0.
  if (error) {
    console.error("[waitlist] cars_available rpc failed", error.message);
    return { carsAvailable: null as number | null };
  }
  const n = typeof data === "number" ? data : Number(data);
  return { carsAvailable: Number.isFinite(n) && n >= 0 ? n : null };
});

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        full_name: z.string().min(2).max(120),
        email: emailLower,
        phone: z.string().min(7).max(30),
        // The hero sends the same shape it sends applications — nulls for
        // "not answered", so every optional field accepts null too.
        pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        market_id: z.string().uuid().nullish(),
        city: z.string().max(120).nullish(),
        state: z.string().max(60).nullish(),
        source: z.string().max(60).nullish(),
        utm_source: z.string().max(200).nullish(),
        utm_medium: z.string().max(200).nullish(),
        utm_campaign: z.string().max(200).nullish(),
        utm_content: z.string().max(200).nullish(),
        utm_term: z.string().max(200).nullish(),
        gclid: z.string().max(300).nullish(),
        landing_page: z.string().max(500).nullish(),
        referrer: z.string().max(500).nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // One spot per address. Say success either way so a repeat click or a
    // second submission from the same person is not a second queue entry —
    // and so the endpoint cannot be used to discover who is already waiting.
    const { data: existing } = await supabaseAdmin
      .from("waitlist")
      .select("id")
      .ilike("email", data.email)
      .eq("status", "waiting")
      .limit(1);
    if (existing?.length) return { ok: true as const, already: true };

    const { error } = await supabaseAdmin.from("waitlist").insert({
      full_name: data.full_name,
      email: data.email,
      phone: data.phone,
      pickup_date: data.pickup_date ?? null,
      market_id: data.market_id ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      status: "waiting",
      source: data.source || "fleet_waitlist",
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
      utm_content: data.utm_content ?? null,
      utm_term: data.utm_term ?? null,
      gclid: data.gclid ?? null,
      // landing_page/referrer are captured for applications but the waitlist
      // table has no such columns — accepted in the payload, not persisted.
    });

    // The unique index also blocks duplicates; both paths answer the same.
    if (error && !String(error.message).includes("duplicate")) {
      console.error("[waitlist] insert failed", error.message);
      return { ok: false as const, error: "Could not join the waitlist. Please try again." };
    }

    let marketName: string | null = null;
    if (data.market_id) {
      const { data: m } = await supabaseAdmin
        .from("markets")
        .select("name")
        .eq("id", data.market_id)
        .maybeSingle();
      marketName = m?.name ?? null;
    }
    const cityLabel = marketName ?? [data.city, data.state].filter(Boolean).join(", ") ?? null;

    const { sendEmail } = await import("@/lib/email.server");
    const companyPhone = (await (await import("@/lib/company.server")).getBusinessPhone()).display;
    void sendEmail({
      to: data.email,
      subject: "You're on the REAL RENTALS waitlist",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
        <p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(data.full_name.split(" ")[0])},</p>
        <p style="font-size:15px;line-height:1.6">You're on the list${cityLabel ? ` for a car in <strong>${escapeHtml(cityLabel)}</strong>` : ""}. Every car that opens up goes to the next person on the list first — you'll get an email the moment it's your turn.</p>
        <p style="font-size:14px;line-height:1.6;color:#555">No deposit, no obligation while you wait. If you find a car elsewhere in the meantime, you can leave the list by replying to this email.</p>
        <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · ${escapeHtml(companyPhone)}</p>
      </div>`,
    }).catch((e) => console.error("[waitlist] confirmation email failed", e));

    return { ok: true as const, already: false };
  });

// ---------------------------------------------------------------- admin

export type WaitlistEntry = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  market_id: string | null;
  pickup_date: string | null;
  status: string;
  notified_at: string | null;
  promoted_application_id: string | null;
  review_reason: string | null;
  promoted_at: string | null;
  source: string | null;
  created_at: string;
  position: number | null;
  /** null = no linked application: the list shows "Not Started". */
  readiness: { result: Pick<ReadinessResult, "state" | "coverage"> | null; docCount: number } | null;
};

/**
 * The three availability numbers, kept separate on purpose:
 *  fleetAvailable  vehicles whose status is Available (same rule as Overview)
 *  rentalReady     Available cars that pass every hard rental-start blocker
 *  carsAvailable   the optional manual public override (app_settings)
 */
export type FleetAvailability = { fleetAvailable: number; rentalReady: number };

export const listWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    entries: WaitlistEntry[];
    carsAvailable: number | null;
    waitingCount: number;
    fleet: FleetAvailability;
  }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Staff-gated, so read the setting directly rather than through the
    // public rpc — one query, no reason to hop through another function.
    const { data: settingRow, error: settingError } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "fleet_availability")
      .maybeSingle();
    if (settingError) throw new Error("Waitlist data unavailable. Please retry.");
    const rawSetting = (settingRow?.value as any)?.cars_available;
    const carsAvailable =
      typeof rawSetting === "number" && Number.isInteger(rawSetting) && rawSetting >= 0
        ? rawSetting
        : null;

    // Oldest first: that is the queue. Position is computed on read —
    // renumbering rows on every promotion is state we would only get wrong.
    const { data: rows, error: waitlistError } = await supabaseAdmin
      .from("waitlist")
      .select(
        "id,full_name,email,phone,city,state,market_id,pickup_date,status,notified_at,promoted_application_id,promoted_at,source,created_at,review_reason",
      )
      .order("created_at", { ascending: true });

    if (waitlistError) throw new Error("Waitlist data unavailable. Please retry.");

    // Readiness only for entries linked to a real application (promotion
    // writes promoted_application_id). No email/phone matching: that would be
    // an identity guess. Same three bulk queries and the same module as Drivers.
    const appIds = Array.from(
      new Set(((rows ?? []) as any[]).map((r) => r.promoted_application_id).filter(Boolean)),
    ) as string[];
    const { buildReadinessIndex, READINESS_APPLICATION_SELECT, READINESS_SCREENING_SELECT, READINESS_DOCUMENT_SELECT } =
      await import("@/lib/readiness-index");
    const { requiredDocCounts } = await import("@/lib/required-docs");
    let readinessIndex = new Map<string, ReadinessResult>();
    let docCounts: Record<string, number> = {};
    if (appIds.length) {
      const [apps, scr, docs] = await Promise.all([
        readInBatches(appIds, (ids, from, to) => supabaseAdmin.from("applications").select(READINESS_APPLICATION_SELECT, { count: "exact" }).in("id", ids).is("deleted_at", null).order("id").range(from, to)),
        readInBatches(appIds, (ids, from, to) => supabaseAdmin.from("driver_screenings").select(`id,${READINESS_SCREENING_SELECT}`, { count: "exact" }).in("lead_id", ids).order("id").range(from, to)),
        readInBatches(appIds, (ids, from, to) => supabaseAdmin.from("documents").select(`id,${READINESS_DOCUMENT_SELECT}`, { count: "exact" }).in("driver_id", ids).order("id").range(from, to)),
      ]);
      readinessIndex = buildReadinessIndex(apps, scr, docs);
      docCounts = requiredDocCounts(docs);
    }

    // Fleet numbers from the existing rules — nothing here writes or infers status.
    //  fleetAvailable: status Available, via summarizeFleet (same as Overview).
    //  rentalReady ("Ready To Rent Now"): the hard rental-start blockers in
    //    rentals.functions.ts / activate_rental_tx, applied to cars a human
    //    already made Available: not archived, no active rental, the DB's own
    //    vehicle_rental_ready_missing returns nothing, and a passed pre-delivery
    //    inspection exists. Registration/insurance/plate are warnings at rental
    //    start today, so they are not counted here.
    const { summarizeFleet } = await import("@/lib/fleet-summary");
    const vlist = await completeRead((from, to) => supabaseAdmin.from("vehicles").select("id,status,archived_at", { count: "exact" }).order("id").range(from, to));
    const candidates = vlist
      .filter((v) => !v.archived_at && String(v.status ?? "").toLowerCase() === "available")
      .map((v) => v.id as string);
    let rentalReady = 0;
    if (candidates.length) {
      const [busyRows, inspectionRows] = await Promise.all([
        readInBatches(candidates, (ids, from, to) => supabaseAdmin.from("rentals").select("id,vehicle_id", { count: "exact" }).in("vehicle_id", ids).eq("status", "active").order("id").range(from, to)),
        readInBatches(candidates, (ids, from, to) => supabaseAdmin.from("inspections").select("id,vehicle_id", { count: "exact" }).in("vehicle_id", ids).eq("inspection_type", "pre_delivery").eq("status", "passed").order("id").range(from, to)),
      ]);
      const busy = new Set(busyRows.map((r) => r.vehicle_id));
      const inspected = new Set(inspectionRows.map((r) => r.vehicle_id));
      // Bound RPC concurrency; errors are unavailable, never a zero count.
      const eligible = candidates.filter((id) => !busy.has(id) && inspected.has(id));
      for (let i = 0; i < eligible.length; i += 10) {
        const checks = await Promise.all(eligible.slice(i, i + 10).map((id) =>
          (supabaseAdmin as any).rpc("vehicle_rental_ready_missing", { _vehicle_id: id })));
        if (checks.some((r: any) => r.error || !Array.isArray(r.data))) throw new Error("Waitlist data unavailable. Please retry.");
        rentalReady += checks.filter((r: any) => r.data.length === 0).length;
      }
    }

    const fleet: FleetAvailability = { fleetAvailable: summarizeFleet(vlist).available, rentalReady };

    const counters = new Map<string, number>();
    const entries: WaitlistEntry[] = ((rows ?? []) as any[]).map((r) => {
      const waiting = String(r.status ?? "waiting") === "waiting";
      let position: number | null = null;
      if (waiting) {
        const key = r.market_id ?? "_";
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        position = next;
      }
      return {
        id: r.id,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        city: r.city,
        state: r.state,
        market_id: r.market_id,
        pickup_date: r.pickup_date,
        status: String(r.status ?? "waiting"),
        notified_at: r.notified_at,
        promoted_application_id: r.promoted_application_id,
        review_reason: r.review_reason ?? null,
        promoted_at: r.promoted_at,
        source: r.source,
        created_at: r.created_at,
        position,
        readiness: r.promoted_application_id && readinessIndex.has(r.promoted_application_id)
          ? { result: { state: readinessIndex.get(r.promoted_application_id)!.state, coverage: readinessIndex.get(r.promoted_application_id)!.coverage }, docCount: docCounts[r.promoted_application_id] ?? 0 }
          : null,
      };
    });

    return {
      entries,
      carsAvailable,
      waitingCount: entries.filter((e) => e.status === "waiting").length,
      fleet,
    };
  });

export const setCarsAvailable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ count: z.number().int().min(0).max(999).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read first so the hero can tell a real 0→positive move from a repeat.
    const { data: beforeRow } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "fleet_availability")
      .maybeSingle();
    const previous = (beforeRow?.value as any)?.cars_available;
    const numeric = typeof previous === "number" ? previous : null;

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        { key: "fleet_availability", value: { cars_available: data.count } },
        { onConflict: "key" },
      );
    if (error) return { ok: false as const, error: error.message, previous: numeric };

    await logAudit(actor, {
      action: "availability.set",
      summary:
        data.count === null
          ? "Cleared the Cars Available setting"
          : `Set Cars Available to ${data.count}`,
      entityType: "app_settings",
      entityId: "fleet_availability",
      metadata: { previous: numeric, new: data.count },
    });

    return { ok: true as const, previous: numeric };
  });

export const notifyWaitlistTop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Top of the queue, oldest first, waiting only. Anything already notified
    // or promoted keeps its place in the history without a second email.
    const { data: rows } = await supabaseAdmin
      .from("waitlist")
      .select("id,full_name,email,city,pickup_date")
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(data.limit);

    if (!rows?.length) return { ok: true as const, notified: 0 };

    const { sendEmail } = await import("@/lib/email.server");
    const companyPhone = (await (await import("@/lib/company.server")).getBusinessPhone(supabaseAdmin)).display;
    const { WAITLIST_CLAIM_ENABLED, deliverOpeningEmails } = await import("@/lib/waitlist-claim");
    // Flag off: the email is still the bare /apply link, and a failed send
    // still marks Notified. claimUrl is not called on that path.
    const { sent } = await deliverOpeningEmails({
      enabled: WAITLIST_CLAIM_ENABLED,
      rows: rows as { id: string; full_name: string | null; email: string; city: string | null }[],
      origin: siteOrigin(),
      companyPhone,
      claimUrl: async (row) => {
        const { waitlistClaimUrl } = await import("@/lib/waitlist-claim.server");
        return waitlistClaimUrl({ entryId: row.id, email: row.email, origin: siteOrigin() });
      },
      reserve: async (id, tokenHash) => {
        const { data, error } = await (supabaseAdmin.from("waitlist") as any)
          .update({ claim_token_hash: tokenHash })
          .eq("id", id)
          .eq("status", "waiting")
          .is("claim_token_hash", null)
          .select("id");
        return !error && Array.isArray(data) && data.length === 1;
      },
      release: async (id, tokenHash) => {
        await (supabaseAdmin.from("waitlist") as any)
          .update({ claim_token_hash: null })
          .eq("id", id)
          .eq("status", "waiting")
          .eq("claim_token_hash", tokenHash);
      },
      send: (message) => sendEmail(message),
      markNotified: async (id, tokenHash) => {
        if (!WAITLIST_CLAIM_ENABLED) {
          const { error } = await supabaseAdmin
            .from("waitlist")
            .update({ status: "notified", notified_at: new Date().toISOString() })
            .eq("id", id)
            .eq("status", "waiting");
          return !error;
        }
        if (!tokenHash) return false;
        const { data, error } = await (supabaseAdmin.from("waitlist") as any)
          .update({ status: "notified", notified_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "waiting")
          .eq("claim_token_hash", tokenHash)
          .select("id");
        return !error && Array.isArray(data) && data.length === 1;
      },
    });

    await logAudit(actor, {
      action: "waitlist.notified",
      summary: `Emailed the top ${sent} on the waitlist about an opening`,
      entityType: "waitlist",
      entityId: null,
      metadata: { requested: data.limit, notified: sent },
    });

    return { ok: true as const, notified: sent };
  });

/**
 * Opens a claim link into a prefill. With the flag off this returns
 * immediately and does not read the waitlist. It never promotes and never
 * issues an application resume token. With the flag on, the first open
 * clears claim_token_hash. A missing WAITLIST_CLAIM_SECRET or a missing
 * column fails closed before a prefill is returned.
 */
export const readWaitlistClaim = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const { WAITLIST_CLAIM_ENABLED } = await import("@/lib/waitlist-claim");
    if (!WAITLIST_CLAIM_ENABLED) return { ok: false as const };

    const { readClaimSecret, openWaitlistClaim, claimStoreFromSupabase } = await import("@/lib/waitlist-claim.server");
    // WAITLIST_CLAIM_SECRET must be its own 32+ character value. readClaimSecret
    // refuses the service-role key and a missing secret before any waitlist read.
    const secret = readClaimSecret();
    if (!secret) return { ok: false as const, error: "This link is not valid." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return openWaitlistClaim(claimStoreFromSupabase(supabaseAdmin), data.token, secret);
  });

export const promoteToApplicant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ entryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Owner + Manager only — Coordinators may view the waitlist but not promote.
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // One atomic database call: locks the entry, reuses an existing applicant
    // by exact email/phone, never creates a second profile, keeps the original
    // signup date/source, and is safe to retry. Sends nothing.
    const { data: res, error } = await supabaseAdmin.rpc("promote_waitlist_entry", { _entry: data.entryId });
    if (error || !res) {
      console.error("[waitlist] promote failed", error?.message);
      return { ok: false as const, error: "Could not move this person into Drivers. Please try again." };
    }
    const r = res as { application_id: string; created: boolean; already: boolean; needs_review?: boolean; reason?: string };
    if (r.needs_review) {
      await logAudit(actor, {
        action: "waitlist.promotion_needs_review",
        summary: "Waitlist promotion held for manual identity review",
        entityType: "waitlist",
        entityId: data.entryId,
        metadata: { reason: r.reason },
      });
      const why =
        r.reason === "phone_only_match"
          ? "the phone number matches an existing driver but the email doesn't"
          : r.reason === "email_match_phone_differs"
            ? "the email matches an existing driver but the phone number is different"
            : "the email and phone point to different existing drivers";
      return {
        ok: false as const,
        error: `Needs manual review: ${why}. Nothing was created or merged.`,
        conflict: r.reason === "email_match_phone_differs" ? ("email_match_phone_differs" as const) : null,
      };
    }
    if (r.already) return { ok: true as const, applicationId: r.application_id, token: null, reused: true };

    let token: string | null = null;
    if (r.created) {
      const { issueResumeToken } = await import("@/lib/resume-tokens.server");
      token = await issueResumeToken(supabaseAdmin, r.application_id);
    }
    await logAudit(actor, {
      action: "waitlist.promoted",
      summary: r.created
        ? "Promoted a waitlist entry to a new application"
        : "Linked a waitlist entry to the existing application",
      entityType: "waitlist",
      entityId: data.entryId,
      metadata: { application_id: r.application_id, created: r.created },
    });
    return { ok: true as const, applicationId: r.application_id, token, reused: !r.created };
  });

// ------------------------------------------------- waitlist holds (Drivers)

/** Application ids currently held on the waitlist, with when they were added. */
export const listWaitlistHolds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("application_waitlist_holds")
      .select("application_id,added_at")
      .is("removed_at", null);
    return { holds: (data ?? []) as { application_id: string; added_at: string }[] };
  });

/** Add/Remove Waitlist. Owner + Manager only; idempotent; records who and when; sends nothing. */
export const setWaitlistHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ applicationId: z.string().uuid(), on: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id,full_name,status")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (!app || app.status === "duplicate") return { ok: false as const, error: "That driver record was not found." };

    if (data.on) {
      const { error } = await supabaseAdmin
        .from("application_waitlist_holds")
        .insert({ application_id: data.applicationId, added_by: actor.userId });
      // Unique partial index: a retry or double click is already on the waitlist.
      if (error && (error as any).code === "23505") return { ok: true as const, changed: false };
      if (error) return { ok: false as const, error: "Could not add to the waitlist. Please try again." };
    } else {
      const { data: closed, error } = await supabaseAdmin
        .from("application_waitlist_holds")
        .update({ removed_at: new Date().toISOString(), removed_by: actor.userId })
        .eq("application_id", data.applicationId)
        .is("removed_at", null)
        .select("id");
      if (error) return { ok: false as const, error: "Could not remove from the waitlist. Please try again." };
      if (!closed?.length) return { ok: true as const, changed: false };
    }
    await logAudit(actor, {
      action: data.on ? "waitlist.hold_added" : "waitlist.hold_removed",
      summary: `${data.on ? "Added" : "Removed"} ${app.full_name ?? "a driver"} ${data.on ? "to" : "from"} the waitlist`,
      entityType: "application",
      entityId: data.applicationId,
      metadata: { underlying_status: app.status },
    });
    return { ok: true as const, changed: true };
  });

/** Why an application cannot be deleted (waitlist links keep its history). */
export const getDeleteBlockers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: w }, { count: h }] = await Promise.all([
      supabaseAdmin.from("waitlist").select("id", { count: "exact", head: true }).eq("promoted_application_id", data.applicationId),
      supabaseAdmin.from("application_waitlist_holds").select("id", { count: "exact", head: true }).eq("application_id", data.applicationId),
    ]);
    return { waitlistLinked: (w ?? 0) + (h ?? 0) > 0 };
  });

function siteOrigin(): string {
  return process.env.SITE_URL || "https://drivereal.com";
}

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------------------------------------------- phone conflict review (Manager+)
//
// Promotion refuses to guess when the email matches an existing applicant but
// the phone differs. These two functions let an Owner/Manager compare the two
// records and link them deliberately. The write goes through one database
// function (resolve_waitlist_phone_conflict) that re-locks both rows, rejects
// stale data, never creates an application/account/message, and writes the
// audit row in the same transaction. Never use mergeDuplicateApplications here.

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export type ConflictSide = {
  id: string;
  name: string;
  emailMasked: string;
  phone: string | null;
  status: string;
  signedUpAt: string;
  source: string | null;
  documentCount: number | null;
  rentalCount: number | null;
};

export const getWaitlistConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ entryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<
    | { ok: true; waitlist: ConflictSide; application: ConflictSide }
    | { ok: false; error: string }
  > => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: w, error } = await supabaseAdmin
      .from("waitlist")
      .select("id,full_name,email,phone,status,created_at,source,promoted_application_id")
      .eq("id", data.entryId)
      .maybeSingle();
    if (error || !w) return { ok: false, error: "Waitlist entry not found." };
    if (w.promoted_application_id) return { ok: false, error: "This entry is already linked to a driver." };
    const { data: apps, error: aErr } = await supabaseAdmin
      .from("applications")
      .select("id,full_name,email,phone,status,created_at,source")
      .ilike("email", w.email.trim())
      .neq("status", "duplicate")
      .is("deleted_at", null);
    if (aErr) return { ok: false, error: "Could not load the matching driver." };
    const matches = (apps ?? []).filter((a) => (a.email ?? "").trim().toLowerCase() === w.email.trim().toLowerCase());
    if (matches.length !== 1) {
      return { ok: false, error: matches.length === 0 ? "No matching driver was found." : "More than one driver uses this email — resolve those first." };
    }
    const a = matches[0];
    const [docs, rentals] = await Promise.all([
      supabaseAdmin.from("documents").select("id", { count: "exact", head: true }).eq("driver_id", a.id),
      supabaseAdmin.from("rentals").select("id", { count: "exact", head: true }).eq("application_id", a.id),
    ]);
    return {
      ok: true,
      waitlist: {
        id: w.id, name: w.full_name, emailMasked: maskEmail(w.email), phone: w.phone,
        status: w.status, signedUpAt: w.created_at, source: w.source, documentCount: null, rentalCount: null,
      },
      application: {
        id: a.id, name: a.full_name, emailMasked: maskEmail(a.email), phone: a.phone,
        status: a.status ?? "", signedUpAt: a.created_at ?? "", source: a.source,
        documentCount: docs.error ? null : docs.count ?? 0,
        rentalCount: rentals.error ? null : rentals.count ?? 0,
      },
    };
  });

const CONFLICT_ERRORS: Record<string, string> = {
  not_found: "Waitlist entry not found.",
  already_linked_elsewhere: "This entry is already linked to a different driver.",
  application_unavailable: "The existing driver record is no longer available.",
  email_mismatch: "The emails no longer match. Nothing was changed.",
  stale: "One of the records changed since you opened it. Reopen Review Conflict and check again.",
  multiple_email_matches: "More than one driver uses this email — resolve those first.",
  phone_belongs_to_other: "The waitlist phone belongs to a different driver. Nothing was changed.",
  reason_required: "Write a reason for changing the phone number.",
  no_waitlist_phone: "The waitlist entry has no phone number to use.",
};

export const resolveWaitlistConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        entryId: z.string().uuid(),
        applicationId: z.string().uuid(),
        phoneChoice: z.enum(["existing", "waitlist"]),
        reason: z.string().trim().max(500).optional().default(""),
        affirmed: z.literal(true),
        expectedWaitlistPhone: z.string().max(40).nullable(),
        expectedApplicationPhone: z.string().max(40).nullable(),
      })
      .refine((v) => v.phoneChoice === "existing" || v.reason.length >= 5, { message: "Write a reason for changing the phone number." })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("resolve_waitlist_phone_conflict", {
      _entry: data.entryId,
      _application: data.applicationId,
      _use_waitlist_phone: data.phoneChoice === "waitlist",
      _reason: data.reason,
      _expected_waitlist_phone: data.expectedWaitlistPhone ?? "",
      _expected_application_phone: data.expectedApplicationPhone ?? "",
      _actor: actor.userId,
      _actor_email: actor.email ?? "",
      _actor_role: actor.role,
    });
    if (error || !res) {
      console.error("[waitlist] resolve conflict failed", error?.message);
      return { ok: false as const, error: "Could not link these records. Nothing was changed." };
    }
    const r = res as { ok: boolean; error?: string; already?: boolean; application_id?: string };
    if (!r.ok) return { ok: false as const, error: CONFLICT_ERRORS[r.error ?? ""] ?? "Could not link these records." };
    return { ok: true as const, applicationId: r.application_id!, already: !!r.already };
  });
