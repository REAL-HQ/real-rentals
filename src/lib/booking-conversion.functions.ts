import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBookingConversionEnabled,
  BOOKING_CONVERSION_MAX_PAGES,
  BOOKING_CONVERSION_PAGE_SIZE,
  buildBookingConversion,
  conversionWindow,
  type ApplicationFact,
  type WaitlistFact,
} from "@/lib/booking-conversion";

/**
 * Read-only conversion for Bookings and Leads.
 * The gate throws before auth, the role check, and every query.
 * Nothing here inserts, updates, or deletes.
 */

const bookingConversionGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  assertBookingConversionEnabled();
  return next();
});

const PAGE_SIZE = BOOKING_CONVERSION_PAGE_SIZE;
const MAX_PAGES = BOOKING_CONVERSION_MAX_PAGES;

/**
 * Inclusive ranges of PAGE_SIZE, at most MAX_PAGES.
 * A short page ends the read. A full final page sets truncated and keeps the rows.
 */
async function readPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const loaded = await load(from, to);
    if (loaded.error) throw new Error(loaded.error.message);
    const batch = loaded.data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const getBookingConversion = createServerFn({ method: "GET" })
  .middleware([bookingConversionGate, requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertBookingConversionEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const window = conversionWindow(now);

    let truncated = false;
    const waitlist = await readPages((from, to) =>
      supabaseAdmin
        .from("waitlist")
        .select("id,created_at,source,utm_source,gclid,promoted_application_id")
        .gte("created_at", new Date(window.startMs).toISOString())
        .lt("created_at", new Date(window.endMs).toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    truncated = truncated || waitlist.truncated;

    const applications = await readPages((from, to) =>
      supabaseAdmin
        .from("applications")
        .select("id,created_at,status,source,utm_source,gclid,waitlist_source")
        .is("deleted_at", null)
        .gte("created_at", new Date(window.startMs).toISOString())
        .lt("created_at", new Date(window.endMs).toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    truncated = truncated || applications.truncated;

    const waitFacts: WaitlistFact[] = waitlist.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      utmSource: row.utm_source,
      gclid: row.gclid,
      promotedApplicationId: row.promoted_application_id,
    }));
    const appFacts: ApplicationFact[] = applications.rows
      .filter((row) => row.created_at)
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at as string,
        status: row.status,
        source: row.source,
        utmSource: row.utm_source,
        gclid: row.gclid,
        waitlistSource: row.waitlist_source,
      }));

    const known = new Set(appFacts.map((row) => row.id));
    const followIds = [...new Set(waitFacts.flatMap((row) => (row.promotedApplicationId && !known.has(row.promotedApplicationId) ? [row.promotedApplicationId] : [])))];
    for (const chunk of chunks(followIds, 100)) {
      const follow = await readPages((from, to) =>
        supabaseAdmin
          .from("applications")
          .select("id,created_at,status,source,utm_source,gclid,waitlist_source")
          .in("id", chunk)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      );
      truncated = truncated || follow.truncated;
      for (const row of follow.rows) {
        if (!row.created_at || known.has(row.id)) continue;
        known.add(row.id);
        appFacts.push({
          id: row.id,
          createdAt: row.created_at,
          status: row.status,
          source: row.source,
          utmSource: row.utm_source,
          gclid: row.gclid,
          waitlistSource: row.waitlist_source,
        });
      }
    }

    const applicationIds = [...known];
    const approvals: { applicationId: string }[] = [];
    const rentals: { applicationId: string; status: string | null }[] = [];
    for (const chunk of chunks(applicationIds, 100)) {
      const [audit, rentalRows] = await Promise.all([
        readPages((from, to) =>
          supabaseAdmin
            .from("audit_log")
            .select("entity_id,created_at")
            .eq("action", "application.approved")
            .in("entity_id", chunk)
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
        readPages((from, to) =>
          supabaseAdmin
            .from("rentals")
            .select("application_id,created_at,status")
            .in("application_id", chunk)
            .not("status", "in", "(cancelled,canceled,void,voided)")
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
      ]);
      truncated = truncated || audit.truncated || rentalRows.truncated;
      for (const row of audit.rows) {
        if (row.entity_id) approvals.push({ applicationId: row.entity_id });
      }
      for (const row of rentalRows.rows) {
        if (row.application_id) rentals.push({ applicationId: row.application_id, status: row.status });
      }
    }

    return buildBookingConversion({ now, waitlist: waitFacts, applications: appFacts, approvals, rentals, truncated });
  });
