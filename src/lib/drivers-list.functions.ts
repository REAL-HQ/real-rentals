import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import { tierAllows } from "@/lib/roles";
import { projectDriverRow, type DriverListRow } from "@/lib/drivers-list";

/**
 * The Drivers list read, moved to the server.
 *
 * It used to be `supabase.from("applications").select("*")` in the browser,
 * which worked only because RLS let every staff tier read the whole row.
 * Security migration 0031 ends a Coordinator's direct read of that table, so
 * the list would go empty for them — and "give the Coordinator the table
 * back" is the wrong repair, because the row carries licence numbers, dates
 * of birth, addresses and card digits.
 *
 * So the read happens here, through the service role, and the tier decides
 * what comes back: an Owner or Manager gets the row as before, a Coordinator
 * gets the operational fields and nothing else. The sensitive fields are
 * ABSENT from their answer, so no browser, devtools session or forged
 * request can recover them.
 *
 * It is the same applications row, read once. No second table, no copy, no
 * parallel contact-status store.
 */

export type DriverListResult = {
  rows: DriverListRow[];
  /** False for a Coordinator: the rows carry operational fields only. */
  canSeeSensitive: boolean;
};

export const listDriverRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverListResult> => {
    // Owner, Manager or Coordinator. Everyone below is refused here, before
    // a single row is read.
    const actor = await requireStaff(context.userId);
    const canSeeSensitive = tierAllows(actor.tier, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("applications")
      .select("*")
      .neq("status", "duplicate")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return {
      rows: ((data ?? []) as DriverListRow[]).map((r) => projectDriverRow(r, canSeeSensitive)),
      canSeeSensitive,
    };
  });
