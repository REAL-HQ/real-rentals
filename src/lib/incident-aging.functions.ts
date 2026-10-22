// Read-only follow-up aging for the existing Incidents list.
// The flag is refused before authentication and before any read.
// RC12's Incident Board does not carry days open, last update, or an
// unresolved deduction, so this extends the Incidents list rather than
// adding a screen. No insert, update, delete, or new table.
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INCIDENT_AGING_ENABLED } from "@/lib/incident-aging-flag";
import { easternCalendarDate, incidentAging, incidentAgingReadError, type IncidentAging } from "@/lib/incident-aging";
import { readInBatches } from "@/lib/waitlist-reads.server";

const refuseIncidentAging = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!INCIDENT_AGING_ENABLED) throw new Error("Incident Aging is off");
  return next();
});

export type IncidentAgingResult = {
  today: string;
  rows: IncidentAging[];
};

type IncidentRow = {
  id: string;
  status: string | null;
  occurred_at: string | null;
  updated_at: string | null;
  driver_responsible_amount: number | string | null;
};

type DeductionRow = {
  id: string;
  incident_id: string | null;
  amount: number | string | null;
};

async function readIncidentRows<T>(
  ids: string[],
  query: Parameters<typeof readInBatches>[1],
): Promise<T[]> {
  try {
    return (await readInBatches(ids, query)) as T[];
  } catch (error) {
    throw new Error(incidentAgingReadError(error instanceof Error ? error.message : ""));
  }
}

/** Manager-only. The flag throws before auth and before any read. */
export const listIncidentAging = createServerFn({ method: "POST" })
  .middleware([refuseIncidentAging, requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ incidentIds: z.array(z.string().uuid()).max(200) }).strict().parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<IncidentAgingResult> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const today = easternCalendarDate(new Date());
    if (data.incidentIds.length === 0) return { today, rows: [] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const incidents = await readIncidentRows<IncidentRow>(data.incidentIds, (ids, from, to) =>
      supabaseAdmin
        .from("incidents")
        .select("id,status,occurred_at,updated_at,driver_responsible_amount", { count: "exact" })
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const deductions = await readIncidentRows<DeductionRow>(data.incidentIds, (ids, from, to) =>
      supabaseAdmin
        .from("deposit_deductions")
        .select("id,incident_id,amount", { count: "exact" })
        .in("incident_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const amounts = new Map<string, unknown[]>();
    for (const row of deductions) {
      if (!row.incident_id) continue;
      const list = amounts.get(row.incident_id) ?? [];
      list.push(row.amount);
      amounts.set(row.incident_id, list);
    }

    return {
      today,
      rows: incidents.map((row) =>
        incidentAging({
          incidentId: row.id,
          status: row.status,
          occurredAt: row.occurred_at,
          updatedAt: row.updated_at,
          responsible: row.driver_responsible_amount,
          deductionAmounts: amounts.get(row.id) ?? [],
          today,
        }),
      ),
    };
  });
