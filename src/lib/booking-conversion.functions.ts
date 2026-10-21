import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBookingConversionEnabled,
  BOOKING_CONVERSION_ENABLED,
  BOOKING_CONVERSION_ROW_CAP,
  buildBookingConversion,
  parseBookingRange,
  rangeInstants,
  takeCapped,
  type BookingAgreementRow,
  type BookingApplicationRow,
  type BookingApprovalRow,
  type BookingConversionReport,
  type BookingLeadRow,
  type BookingRentalRow,
} from "@/lib/booking-conversion";

/**
 * Managers only. Read-only. bookingConversionGate throws before auth.
 * The handler throws again before the role check and before any table read.
 * Each read asks for the cap plus one row and returns overflow instead of a
 * partial rate.
 */

const bookingConversionGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (BOOKING_CONVERSION_ENABLED !== true) {
    throw new Error("Booking conversion is not enabled.");
  }
  return next();
});

const INPUT = z.object({
  from: z.string(),
  to: z.string(),
});

const APP_COLUMNS =
  "id,status,created_at,deleted_at,waitlist_signed_up_at,card_on_file_at,card_last4,stripe_payment_method_id";

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };
type LimitedQuery<T> = { limit: (count: number) => PromiseLike<QueryResult<T>> };

const LIMIT = BOOKING_CONVERSION_ROW_CAP + 1;

function overflow(from: string, to: string): BookingConversionReport {
  return { status: "overflow", timeZone: "America/New_York", from, to, cap: BOOKING_CONVERSION_ROW_CAP };
}

async function readCapped<T>(query: LimitedQuery<T>): Promise<T[] | "overflow"> {
  const { data, error } = await query.limit(LIMIT);
  if (error) throw new Error(error.message);
  const taken = takeCapped(data ?? []);
  if (!taken.ok) return "overflow";
  return taken.rows;
}

export const getBookingConversion = createServerFn({ method: "POST" })
  .middleware([bookingConversionGate, requireSupabaseAuth])
  .inputValidator((input: unknown) => INPUT.parse(input))
  .handler(async ({ data, context }): Promise<BookingConversionReport> => {
    assertBookingConversionEnabled();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const range = parseBookingRange(data.from, data.to);
    if (!range.ok) throw new Error(range.reason);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const window = rangeInstants(range.from, range.to);
    const apps = new Map<string, BookingApplicationRow>();
    const leads = new Map<string, BookingLeadRow>();

    const rememberApps = (rows: AppRecord[]) => {
      for (const row of rows) apps.set(row.id, toApplication(row));
    };
    const rememberLeads = (rows: LeadRecord[]) => {
      for (const row of rows) leads.set(row.id, toLead(row));
    };

    const leadsInRange = await readCapped<LeadRecord>(
      supabaseAdmin
        .from("waitlist")
        .select("id,created_at,promoted_application_id")
        .gte("created_at", window.start)
        .lt("created_at", window.end)
        .order("id", { ascending: true }),
    );
    if (leadsInRange === "overflow") return overflow(range.from, range.to);
    rememberLeads(leadsInRange);

    const startedInRange = await readCapped<AppRecord>(
      supabaseAdmin
        .from("applications")
        .select(APP_COLUMNS)
        .is("deleted_at", null)
        .gte("created_at", window.start)
        .lt("created_at", window.end)
        .order("id", { ascending: true }),
    );
    if (startedInRange === "overflow") return overflow(range.from, range.to);
    rememberApps(startedInRange);

    const signedUpInRange = await readCapped<AppRecord>(
      supabaseAdmin
        .from("applications")
        .select(APP_COLUMNS)
        .is("deleted_at", null)
        .gte("waitlist_signed_up_at", window.start)
        .lt("waitlist_signed_up_at", window.end)
        .order("id", { ascending: true }),
    );
    if (signedUpInRange === "overflow") return overflow(range.from, range.to);
    rememberApps(signedUpInRange);

    const promoted = [
      ...new Set(leadsInRange.map((row) => row.promoted_application_id).filter((id): id is string => Boolean(id))),
    ].filter((id) => !apps.has(id));
    if (apps.size + promoted.length > BOOKING_CONVERSION_ROW_CAP) return overflow(range.from, range.to);
    const followed = await readIds(promoted, (chunk) =>
      supabaseAdmin.from("applications").select(APP_COLUMNS).is("deleted_at", null).in("id", chunk).order("id", { ascending: true }),
    );
    if (followed === "overflow") return overflow(range.from, range.to);
    rememberApps(followed);
    if (apps.size > BOOKING_CONVERSION_ROW_CAP) return overflow(range.from, range.to);

    const appIds = [...apps.keys()];
    const linkedLeads = await readIds(appIds, (chunk) =>
      supabaseAdmin
        .from("waitlist")
        .select("id,created_at,promoted_application_id")
        .in("promoted_application_id", chunk)
        .order("id", { ascending: true }),
    );
    if (linkedLeads === "overflow") return overflow(range.from, range.to);
    rememberLeads(linkedLeads);

    const agreementRows = await readIds(appIds, (chunk) =>
      supabaseAdmin
        .from("agreements")
        .select("id,application_id,status,signed_at,voided_at")
        .in("application_id", chunk)
        .order("id", { ascending: true }),
    );
    if (agreementRows === "overflow") return overflow(range.from, range.to);

    const rentalRows = await readIds(appIds, (chunk) =>
      supabaseAdmin
        .from("rentals")
        .select("id,application_id,created_at")
        .in("application_id", chunk)
        .order("id", { ascending: true }),
    );
    if (rentalRows === "overflow") return overflow(range.from, range.to);

    const approvalRows = await readIds(appIds, (chunk) =>
      supabaseAdmin
        .from("audit_log")
        .select("id,entity_id,created_at")
        .eq("action", "application.approved")
        .eq("entity_type", "application")
        .in("entity_id", chunk)
        .order("id", { ascending: true }),
    );
    if (approvalRows === "overflow") return overflow(range.from, range.to);

    return buildBookingConversion({
      from: range.from,
      to: range.to,
      leads: [...leads.values()],
      applications: [...apps.values()],
      agreements: agreementRows.map(toAgreement),
      rentals: rentalRows.map(toRental),
      approvals: approvalRows.map(toApproval),
    });
  });

async function readIds<T>(ids: string[], run: (chunk: string[]) => LimitedQuery<T>): Promise<T[] | "overflow"> {
  if (ids.length === 0) return [];
  const all: T[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const rows = await readCapped(run(ids.slice(index, index + 100)));
    if (rows === "overflow") return "overflow";
    all.push(...rows);
    if (all.length > BOOKING_CONVERSION_ROW_CAP) return "overflow";
  }
  return all;
}

type LeadRecord = { id: string; created_at: string; promoted_application_id: string | null };
type AppRecord = {
  id: string;
  status: string | null;
  created_at: string | null;
  deleted_at: string | null;
  waitlist_signed_up_at: string | null;
  card_on_file_at: string | null;
  card_last4: string | null;
  stripe_payment_method_id: string | null;
};
type AgreementRecord = {
  application_id: string | null;
  status: string | null;
  signed_at: string | null;
  voided_at: string | null;
};
type RentalRecord = { application_id: string | null; created_at: string | null };
type ApprovalRecord = { entity_id: string | null; created_at: string | null };

function toLead(row: LeadRecord): BookingLeadRow {
  return { id: row.id, createdAt: row.created_at, promotedApplicationId: row.promoted_application_id };
}

function toApplication(row: AppRecord): BookingApplicationRow {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    waitlistSignedUpAt: row.waitlist_signed_up_at,
    cardOnFileAt: row.card_on_file_at,
    cardLast4: row.card_last4,
    stripePaymentMethodId: row.stripe_payment_method_id,
  };
}

function toAgreement(row: AgreementRecord): BookingAgreementRow {
  return { applicationId: row.application_id, status: row.status, signedAt: row.signed_at, voidedAt: row.voided_at };
}

function toRental(row: RentalRecord): BookingRentalRow {
  return { applicationId: row.application_id, createdAt: row.created_at };
}

function toApproval(row: ApprovalRecord): BookingApprovalRow {
  return { applicationId: row.entity_id, createdAt: row.created_at };
}
