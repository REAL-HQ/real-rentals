import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBookingConversionEnabled,
  BOOKING_CONVERSION_ROW_CAP,
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

const CAP = BOOKING_CONVERSION_ROW_CAP;
const PAGE = CAP + 1;

type ReadResult<T> = { truncated: true } | { truncated: false; rows: T[] };

async function take<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<ReadResult<T>> {
  const loaded = await query;
  if (loaded.error) throw new Error(loaded.error.message);
  const rows = loaded.data ?? [];
  if (rows.length > CAP) return { truncated: true };
  return { truncated: false, rows };
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

    const waitlist = await take(
      supabaseAdmin
        .from("waitlist")
        .select("id,created_at,source,utm_source,gclid,promoted_application_id")
        .gte("created_at", new Date(window.startMs).toISOString())
        .lt("created_at", new Date(window.endMs).toISOString())
        .order("created_at")
        .order("id")
        .limit(PAGE),
    );
    if (waitlist.truncated) return buildBookingConversion({ now, waitlist: [], applications: [], approvals: [], rentals: [], truncated: true });

    const applications = await take(
      supabaseAdmin
        .from("applications")
        .select("id,created_at,status,source,utm_source,gclid,waitlist_source")
        .is("deleted_at", null)
        .gte("created_at", new Date(window.startMs).toISOString())
        .lt("created_at", new Date(window.endMs).toISOString())
        .order("created_at")
        .order("id")
        .limit(PAGE),
    );
    if (applications.truncated) return buildBookingConversion({ now, waitlist: [], applications: [], approvals: [], rentals: [], truncated: true });

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
      const follow = await take(
        supabaseAdmin
          .from("applications")
          .select("id,created_at,status,source,utm_source,gclid,waitlist_source")
          .in("id", chunk)
          .is("deleted_at", null)
          .order("id")
          .limit(PAGE),
      );
      if (follow.truncated) return buildBookingConversion({ now, waitlist: [], applications: [], approvals: [], rentals: [], truncated: true });
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
    const rentals: { applicationId: string }[] = [];
    for (const chunk of chunks(applicationIds, 100)) {
      const [audit, rentalRows] = await Promise.all([
        take(
          supabaseAdmin
            .from("audit_log")
            .select("entity_id,created_at")
            .eq("action", "application.approved")
            .in("entity_id", chunk)
            .order("created_at")
            .order("id")
            .limit(PAGE),
        ),
        take(
          supabaseAdmin
            .from("rentals")
            .select("application_id,created_at")
            .in("application_id", chunk)
            .order("created_at")
            .order("id")
            .limit(PAGE),
        ),
      ]);
      if (audit.truncated || rentalRows.truncated) {
        return buildBookingConversion({ now, waitlist: [], applications: [], approvals: [], rentals: [], truncated: true });
      }
      for (const row of audit.rows) {
        if (row.entity_id) approvals.push({ applicationId: row.entity_id });
      }
      for (const row of rentalRows.rows) {
        if (row.application_id) rentals.push({ applicationId: row.application_id });
      }
    }

    return buildBookingConversion({ now, waitlist: waitFacts, applications: appFacts, approvals, rentals, truncated: false });
  });
