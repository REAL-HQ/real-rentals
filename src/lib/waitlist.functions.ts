import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff, requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

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
  promoted_at: string | null;
  source: string | null;
  created_at: string;
  position: number | null;
};

export const listWaitlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    entries: WaitlistEntry[];
    carsAvailable: number | null;
    waitingCount: number;
  }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Staff-gated, so read the setting directly rather than through the
    // public rpc — one query, no reason to hop through another function.
    const { data: settingRow } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "fleet_availability")
      .maybeSingle();
    const rawSetting = (settingRow?.value as any)?.cars_available;
    const carsAvailable =
      typeof rawSetting === "number" && Number.isInteger(rawSetting) && rawSetting >= 0
        ? rawSetting
        : null;

    // Oldest first: that is the queue. Position is computed on read —
    // renumbering rows on every promotion is state we would only get wrong.
    const { data: rows } = await supabaseAdmin
      .from("waitlist")
      .select(
        "id,full_name,email,phone,city,state,market_id,pickup_date,status,notified_at,promoted_application_id,promoted_at,source,created_at",
      )
      .order("created_at", { ascending: true });

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
        promoted_at: r.promoted_at,
        source: r.source,
        created_at: r.created_at,
        position,
      };
    });

    return {
      entries,
      carsAvailable,
      waitingCount: entries.filter((e) => e.status === "waiting").length,
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
    let sent = 0;
    for (const r of rows as any[]) {
      const res = await sendEmail({
        to: r.email,
        subject: "A car just opened up — you're next",
        html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
          <p style="font-size:15px;line-height:1.6">Hi ${escapeHtml(String(r.full_name ?? "").split(" ")[0])},</p>
          <p style="font-size:15px;line-height:1.6">Good news — a car just became available${r.city ? ` in ${escapeHtml(r.city)}` : ""}. You were at the top of the waitlist, so it's yours to claim before we offer it to anyone else.</p>
          <p style="margin:28px 0">
            <a href="${siteOrigin()}/apply" style="background:#D03020;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Claim it — finish your application</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#666">This link takes you straight into the application you started. If the car has already been claimed, you stay at the top of the list for the next one.</p>
          <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · ${escapeHtml(companyPhone)}</p>
        </div>`,
      });
      if (res.ok) sent += 1;
      // Mark regardless: the offer went out. A failed send is retried by
      // re-running this action, but only against rows still marked waiting.
      await supabaseAdmin
        .from("waitlist")
        .update({ status: "notified", notified_at: new Date().toISOString() })
        .eq("id", r.id);
    }

    await logAudit(actor, {
      action: "waitlist.notified",
      summary: `Emailed the top ${sent} on the waitlist about an opening`,
      entityType: "waitlist",
      entityId: null,
      metadata: { requested: data.limit, notified: sent },
    });

    return { ok: true as const, notified: sent };
  });

export const promoteToApplicant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ entryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: entry } = await supabaseAdmin
      .from("waitlist")
      .select("id,full_name,email,phone,city,state,market_id,pickup_date,status,promoted_application_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,gclid")
      .eq("id", data.entryId)
      .maybeSingle();
    if (!entry) return { ok: false as const, error: "That waitlist entry no longer exists." };
    if ((entry as any).promoted_application_id) {
      return { ok: false as const, error: "This entry was already promoted." };
    }

    // Same shape a hero submission lands in: a partial application the driver
    // can resume from the link we send, and staff see immediately.
    const { data: app, error: appErr } = await supabaseAdmin
      .from("applications")
      .insert({
        full_name: (entry as any).full_name,
        email: (entry as any).email,
        phone: (entry as any).phone,
        city: (entry as any).city,
        state: (entry as any).state,
        market_id: (entry as any).market_id,
        pickup_date: (entry as any).pickup_date,
        sms_consent: false,
        source: "city_lp",
        status: "new",
        current_step: "rental",
        utm_source: (entry as any).utm_source,
        utm_medium: (entry as any).utm_medium,
        utm_campaign: (entry as any).utm_campaign,
        utm_content: (entry as any).utm_content,
        utm_term: (entry as any).utm_term,
        gclid: (entry as any).gclid,
      })
      .select("id")
      .single();
    if (appErr || !app) {
      console.error("[waitlist] promote insert failed", appErr?.message);
      return { ok: false as const, error: "Could not create the application. Please try again." };
    }

    const { issueResumeToken } = await import("@/lib/resume-tokens.server");
    const token = await issueResumeToken(supabaseAdmin, (app as any).id);

    const { error: updErr } = await supabaseAdmin
      .from("waitlist")
      .update({
        status: "promoted",
        promoted_application_id: (app as any).id,
        promoted_at: new Date().toISOString(),
      })
      .eq("id", data.entryId);
    if (updErr) {
      console.error("[waitlist] promote status update failed", updErr.message);
    }

    await logAudit(actor, {
      action: "waitlist.promoted",
      summary: `Promoted ${(entry as any).full_name} from the waitlist to an application`,
      entityType: "waitlist",
      entityId: data.entryId,
      metadata: { application_id: (app as any).id, email: (entry as any).email },
    });

    return { ok: true as const, applicationId: (app as any).id, token };
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
