import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import {
  assertCloseoutSummaryEnabled,
  buildCloseoutSummary,
  closeoutApplies,
  etCalendarDate,
  type CloseoutSummary,
  type ReturnChecklistRead,
} from "@/lib/closeout-summary";

/**
 * Read-only Closeout Summary for owners and managers.
 *
 * requireManager runs first, then the flag. A disabled call does not import
 * the database client and does not read. This file does not insert, update,
 * delete, settle a deposit, or call Stripe.
 *
 * return_checklists is #77 and is not installed here. A missing table or row
 * is Unknown. Any other read error is thrown.
 */

const rentalSchema = z.object({ rentalId: z.string().uuid() });

export type CloseoutSummaryResult = { applies: false } | CloseoutSummary;

export const getCloseoutSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rentalSchema.parse(data))
  .handler(async ({ context, data }): Promise<CloseoutSummaryResult> => {
    await requireManager(context.userId);
    assertCloseoutSummaryEnabled();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rentalQuery = await supabaseAdmin
      .from("rentals")
      .select("id, status, start_date, end_date, weekly_rate, deposit_amount, deposit_held, deposit_status, vehicle_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rentalQuery.error) throw new Error(rentalQuery.error.message);
    const rental = rentalQuery.data;
    if (!rental) throw new Error("Rental not found.");
    if (!closeoutApplies(rental.status)) return { applies: false };

    const paymentQuery = await supabaseAdmin
      .from("payments")
      .select("type, status, net_collected")
      .eq("rental_id", rental.id);
    if (paymentQuery.error) throw new Error(paymentQuery.error.message);

    let registrationExpiresOn: string | null = null;
    let insuranceExpiresOn: string | null = null;
    if (rental.vehicle_id) {
      const vehicleQuery = await supabaseAdmin
        .from("vehicles")
        .select("registration_expires_on, insurance_expires_on")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (vehicleQuery.error) throw new Error(vehicleQuery.error.message);
      registrationExpiresOn = vehicleQuery.data?.registration_expires_on ?? null;
      insuranceExpiresOn = vehicleQuery.data?.insurance_expires_on ?? null;
    }

    const incidentQuery = await supabaseAdmin
      .from("incidents")
      .select("status, incident_type")
      .eq("rental_id", rental.id)
      .in("status", ["open", "in_claim", "repairing"]);
    if (incidentQuery.error) throw new Error(incidentQuery.error.message);

    const issueQuery = await supabaseAdmin.from("issues").select("status, title, kind").eq("rental_id", rental.id);
    if (issueQuery.error) throw new Error(issueQuery.error.message);

    const checklist = await readChecklist(supabaseAdmin, rental.id);

    return buildCloseoutSummary({
      status: rental.status,
      startDate: rental.start_date,
      endDate: rental.end_date,
      todayEt: etCalendarDate(new Date()),
      weeklyRate: asNumber(rental.weekly_rate),
      payments: (paymentQuery.data ?? []).map((row) => ({
        type: row.type,
        status: row.status,
        netCollected: asNumber(row.net_collected),
      })),
      depositHeld: rental.deposit_held,
      depositStatus: rental.deposit_status,
      depositAmount: asNumber(rental.deposit_amount),
      registrationExpiresOn,
      insuranceExpiresOn,
      incidents: (incidentQuery.data ?? []).map((row) => ({ status: row.status, type: row.incident_type })),
      issues: issueQuery.data ?? [],
      checklist,
    });
  });

function asNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

type ChecklistQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        limit: (count: number) => Promise<{ data: ChecklistRow[] | null; error: DbError | null }>;
      };
    };
  };
};
type ItemQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => Promise<{ data: { result: string | null }[] | null; error: DbError | null }>;
  };
};

async function readChecklist(client: unknown, rentalId: string): Promise<ReturnChecklistRead> {
  const from = (client as { from: (table: string) => unknown }).from;
  const query = await (from("return_checklists") as ChecklistQuery)
    .select("id, keys_returned, deposit_decision_needed")
    .eq("rental_id", rentalId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (query.error) {
    if (missingRelation(query.error, "return_checklists")) return { known: false };
    throw new Error(query.error.message);
  }
  const row = (query.data ?? [])[0];
  if (!row || row.keys_returned == null || row.deposit_decision_needed == null) return { known: false };

  const items = await (from("return_checklist_items") as ItemQuery).select("result").eq("checklist_id", row.id);
  if (items.error) {
    if (missingRelation(items.error, "return_checklist_items")) {
      return { known: true, keysReturned: row.keys_returned, depositDecisionNeeded: row.deposit_decision_needed, damageCount: null };
    }
    throw new Error(items.error.message);
  }
  const damageCount = (items.data ?? []).filter((item) => String(item.result ?? "").trim().toLowerCase() === "damage").length;
  return { known: true, keysReturned: row.keys_returned, depositDecisionNeeded: row.deposit_decision_needed, damageCount };
}

type DbError = { code?: string; message?: string };
type ChecklistRow = { id: string; keys_returned: boolean | null; deposit_decision_needed: boolean | null };

function missingRelation(error: DbError, name: string): boolean {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || message.includes(name.toLowerCase());
}
