import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import { rentalReadyItems } from "@/lib/vehicle-readiness";
import { owedOn, OUTSTANDING_STATUSES } from "@/lib/payment-collection.server";

export type CloseoutCheck = {
  key: string;
  title: string;
  state: "Ready" | "Needs Attention" | "Unknown";
  explanation: string;
  completedAt?: string | null;
  criticalFailures?: string[];
};
export type CloseoutReadiness = { checks: CloseoutCheck[] };
const unknown = (key: string, title: string): CloseoutCheck => ({
  key,
  title,
  state: "Unknown",
  explanation: "Evidence could not be loaded. No clearance is implied.",
});
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** Informational reads only. Never calls provider APIs or lifecycle transactions. */
export const getRentalCloseoutReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CloseoutReadiness> => {
    await requireManager(context.userId);
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const { data: rental, error } = await sb
      .from("rentals")
      .select(
        "vehicle_id,autopay_active,stripe_subscription_id,deposit_amount,deposit_held,deposit_status,deposit_settled_at,deposit_refund_amount",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error || !rental) throw new Error("Closeout evidence unavailable.");
    // Isolate query failures: one failed source must not turn another into an empty success.
    async function section(key: string, title: string, read: () => Promise<CloseoutCheck>) {
      try {
        return await read();
      } catch {
        return unknown(key, title);
      }
    }
    const checks = await Promise.all([
      section("inspection", "Return Inspection", async () => {
        const { data: rows, error } = await sb
          .from("inspections")
          .select("id,status,completed_at,vehicle_id")
          .eq("rental_id", data.rentalId)
          .eq("inspection_type", "return")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error || !rows) throw new Error();
        const i = rows[0];
        if (!i)
          return {
            key: "inspection",
            title: "Return Inspection",
            state: "Needs Attention",
            explanation: "Missing — no return inspection recorded for this rental.",
          };
        if (i.vehicle_id !== rental.vehicle_id) throw new Error();
        const items = await sb
          .from("inspection_items")
          .select("label,result,is_critical", { count: "exact" })
          .eq("inspection_id", i.id)
          .limit(1000);
        if (
          items.error ||
          !items.data ||
          items.count == null ||
          items.count > items.data.length ||
          !items.data.length
        )
          throw new Error();
        const failures = items.data
          .filter((x) => x.is_critical && x.result === "fail")
          .map((x) => x.label);
        if (!["passed", "failed", "in_progress"].includes(i.status)) throw new Error();
        const complete =
          i.status === "passed" &&
          !!i.completed_at &&
          Number.isFinite(Date.parse(i.completed_at)) &&
          items.data.every((x) => ["pass", "fail", "na"].includes(x.result));
        const failed = i.status === "failed" || failures.length > 0;
        return {
          key: "inspection",
          title: "Return Inspection",
          state: failed || !complete ? "Needs Attention" : "Ready",
          completedAt: i.completed_at,
          criticalFailures: failures,
          explanation: failed
            ? "Failed — review the return inspection before releasing the vehicle."
            : complete
              ? "Completed — latest return checklist passed."
              : "Incomplete — return checklist has not passed.",
        };
      }),
      section("vehicle", "Vehicle Condition", async () => {
        if (!rental.vehicle_id) throw new Error();
        const [v, incidents] = await Promise.all([
          sb
            .from("vehicles")
            .select("year,make,model,vin,weekly_rate,status")
            .eq("id", rental.vehicle_id)
            .maybeSingle(),
          sb
            .from("incidents")
            .select("status,drivable", { count: "exact" })
            .eq("vehicle_id", rental.vehicle_id)
            .limit(1000),
        ]);
        if (
          v.error ||
          !v.data ||
          incidents.error ||
          !incidents.data ||
          incidents.count == null ||
          incidents.count > incidents.data.length
        )
          throw new Error();
        const open = incidents.data.filter((x) => x.status !== "closed");
        const missing = rentalReadyItems(v.data).filter((x) => !x.done);
        const attention =
          open.length > 0 || missing.length > 0 || !["available", "rented"].includes(v.data.status);
        return {
          key: "vehicle",
          title: "Vehicle Condition",
          state: attention ? "Needs Attention" : "Unknown",
          explanation: `${open.length} unresolved incident(s). ${missing.length ? `Rental Ready missing: ${missing.map((x) => x.label).join(", ")}.` : "Rental Ready profile checks pass."} Vehicle status: ${v.data.status}. These records do not certify that all damage or safety issues are cleared.`,
        };
      }),
      section("charges", "Outstanding Charges", async () => {
        const [pay, charges] = await Promise.all([
          sb
            .from("payments")
            .select("status,amount,balance_due", { count: "exact" })
            .eq("rental_id", data.rentalId)
            .limit(1000),
          sb
            .from("toll_charges")
            .select("status", { count: "exact" })
            .eq("rental_id", data.rentalId)
            .limit(1000),
        ]);
        if (
          pay.error ||
          !pay.data ||
          pay.count == null ||
          pay.count > pay.data.length ||
          charges.error ||
          !charges.data ||
          charges.count == null ||
          charges.count > charges.data.length
        )
          throw new Error();
        const terminal = ["paid", "refunded", "void", "waived"];
        const unpaid = pay.data.filter((x) => !terminal.includes(x.status));
        if (
          unpaid.some(
            (x) =>
              !(OUTSTANDING_STATUSES as readonly string[]).includes(x.status) ||
              (x.balance_due == null && x.amount == null) ||
              !Number.isFinite(owedOn(x)),
          )
        )
          throw new Error();
        const balance = unpaid.reduce((sum, x) => sum + owedOn(x), 0);
        const pending = unpaid.filter((x) => x.status === "pending").length;
        // Rebilled tolls already have a payments row. Do not count their amount twice.
        const unposted = charges.data.filter(
          (x) => !["rebilled", "paid", "written_off"].includes(x.status),
        ).length;
        return {
          key: "charges",
          title: "Outstanding Charges",
          state: balance > 0 || pending > 0 || unposted > 0 ? "Needs Attention" : "Ready",
          explanation: `${money(balance)} unpaid recorded balance; ${pending} pending payment charge(s); ${unposted} unposted/disputed toll or other charge(s). Recorded charges only; future charges are not predicted.`,
        };
      }),
    ]);
    checks.push({
      key: "billing",
      title: "Billing",
      state:
        rental.autopay_active === true || !!rental.stripe_subscription_id
          ? "Needs Attention"
          : "Unknown",
      explanation: `Local autopay: ${rental.autopay_active == null ? "unknown" : rental.autopay_active ? "on" : "off"}; subscription link: ${rental.stripe_subscription_id ? "present" : "absent"}. Provider cancellation is unverified. No provider request was made.`,
    });
    const deposit = rental.deposit_amount == null ? null : Number(rental.deposit_amount);
    const disposition = rental.deposit_status ?? "unknown";
    checks.push({
      key: "deposit",
      title: "Deposit",
      state: rental.deposit_held && !rental.deposit_settled_at ? "Needs Attention" : "Unknown",
      explanation: `Recorded deposit: ${deposit == null ? "unknown" : money(deposit)}; held: ${rental.deposit_held == null ? "unknown" : rental.deposit_held ? "yes" : "no"}. Disposition: ${disposition}. ${rental.deposit_settled_at ? "A settlement is recorded." : "No settlement is recorded."} Actual refund confirmation is unavailable; a disposition is not proof of money returned.`,
    });
    return { checks };
  });
