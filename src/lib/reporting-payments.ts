import { supabase } from "@/integrations/supabase/client";
import { readEveryPage } from "@/lib/paged-read";

/**
 * Every payments row, any status.
 *
 * Overview and Payments both decide whether a Stripe charge is a deposit from
 * this set. A paid/refunded filter would hide a deposit Stripe already
 * captured while the row is still pending, and the two pages would disagree.
 */
export function loadReportingPayments() {
  return readEveryPage((from, to) =>
    supabase
      .from("payments")
      .select("*", { count: "exact" })
      .order("id", { ascending: true })
      .range(from, to),
  );
}
