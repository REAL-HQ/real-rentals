// Daily rent plans live in app_settings (key daily_rent_plans), so a rental can
// move to a $/day arrangement without a schema change:
//   { "<rental uuid>": { "dailyRate": 50, "startsOn": "2026-11-16", "endsOn": null, "note": "..." } }
// A failed read is an empty map: every rental reads as weekly, which is what it
// was before this setting existed.
import { DAILY_RENT_PLANS_KEY, readDailyPlans, type DailyRentPlan, type StandingPayment } from "@/lib/rent-standing";

export async function loadDailyRentPlans(admin: any): Promise<Map<string, DailyRentPlan>> {
  try {
    const res = await admin.from("app_settings").select("value").eq("key", DAILY_RENT_PLANS_KEY).maybeSingle();
    if (res?.error) return new Map();
    return readDailyPlans(res?.data?.value ?? null);
  } catch {
    return new Map();
  }
}

/**
 * Paid rent rows per rental, in the shape rent-standing.ts reads. Used by the late
 * fee sweep to see a week already paid on another row. A failed read is an empty
 * map (the sweep then behaves exactly as before).
 */
export async function loadPaidRentByRental(admin: any, rentalIds: string[]): Promise<Map<string, StandingPayment[]>> {
  const out = new Map<string, StandingPayment[]>();
  if (!rentalIds.length) return out;
  try {
    const settled = ["paid"];
    const res = await admin.from("payments").select("rental_id,type,reason,notes,amount,status,due_date,paid_date").in("rental_id", rentalIds).in("status", settled);
    for (const x of (res?.error ? [] : res?.data ?? []) as any[]) {
      (out.get(x.rental_id) ?? out.set(x.rental_id, []).get(x.rental_id)!).push({
        type: x.type, reason: x.reason, notes: x.notes, amount: x.amount, status: x.status, dueDate: x.due_date, paidDate: x.paid_date,
      });
    }
  } catch {
    return new Map();
  }
  return out;
}
