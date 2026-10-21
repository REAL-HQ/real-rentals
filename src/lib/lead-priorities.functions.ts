import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import {
  ACTIVE_LEAD_STATUSES,
  LEAD_BUCKETS,
  LEAD_SELECT,
  leadToday,
  leadBucket,
  projectLead,
  type LeadBucket,
  type LeadRow,
  type LeadPrioritiesResult,
} from "./lead-priorities";
import { CONTACT_STATUS_KEYS } from "./contact-status";

export const getLeadPriorities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(25).default(5),
        // A card filter. It selects a bucket already built below; it is never
        // interpolated into a PostgREST filter.
        bucket: z.enum(["overdue", "new"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<LeadPrioritiesResult> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = leadToday();
    // Mutually exclusive groups: an overdue new/interested lead counts only as overdue.
    // Count-only requests fetch no notes. Only the requested page loads latest contact notes.
    const query = (bucket: LeadBucket, countOnly: boolean) => {
      let q = supabaseAdmin
        .from("applications")
        .select(countOnly ? "id" : LEAD_SELECT, countOnly ? { count: "exact", head: true } : {})
        .is("deleted_at", null)
        .in("status", ACTIVE_LEAD_STATUSES)
        .in(
          "contact_status",
          CONTACT_STATUS_KEYS.filter((s) => s !== "unqualified"),
        );
      if (bucket === "overdue") return q.lt("contact_follow_up_on", today);
      q = q.or(`contact_follow_up_on.is.null,contact_follow_up_on.gte.${today}`);
      if (bucket === "new") return q.eq("contact_status", "new");
      if (bucket === "interested") return q.eq("contact_status", "interested");
      q = q.not("contact_status", "in", "(new,interested)");
      if (bucket === "today") return q.eq("contact_follow_up_on", today);
      q = q.or(`contact_follow_up_on.is.null,contact_follow_up_on.gt.${today}`);
      if (bucket === "information") return q.eq("contact_status", "documents");
      return q.neq("contact_status", "documents").gt("contact_follow_up_on", today);
    };
    const counted = await Promise.all(LEAD_BUCKETS.map((b) => query(b, true)));
    if (counted.some((q) => q.error || !Number.isSafeInteger(q.count) || q.count! < 0))
      throw new Error("Lead priorities could not be loaded. Please retry.");
    const counts = counted.map((q) => q.count!);
    // The three summary counters always cover every bucket. A clicked New or
    // Overdue card only narrows the rows underneath them.
    const pageBuckets: LeadBucket[] = data.bucket ? [data.bucket] : [...LEAD_BUCKETS];
    const total = pageBuckets.reduce((sum, bucket) => sum + counts[LEAD_BUCKETS.indexOf(bucket)]!, 0);
    if (total > 0 && data.offset >= total)
      throw new Error("Lead priorities changed. Please refresh.");
    const rows: ReturnType<typeof projectLead>[] = [];
    let skip = data.offset;
    for (const bucket of pageBuckets) {
      const available = counts[LEAD_BUCKETS.indexOf(bucket)]!;
      if (skip >= available) {
        skip -= available;
        continue;
      }
      const take = Math.min(data.limit - rows.length, available - skip);
      if (!take) break;
      const result = await query(bucket, false)
        .order("contact_follow_up_on", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(skip, skip + take - 1);
      if (result.error || !result.data || result.data.length !== take)
        throw new Error("Lead priorities changed or could not be loaded. Please refresh.");
      const selected = result.data as unknown as LeadRow[];
      if (
        selected.some(
          (r) => leadBucket(r, today) !== bucket || rows.some((prior) => prior.id === r.id),
        )
      )
        throw new Error("Lead priorities changed. Please refresh.");
      rows.push(...selected.map((r) => projectLead(r, bucket)));
      skip = 0;
    }
    return {
      rows,
      total,
      counts: { overdue: counts[0], new: counts[1], hot: counts[2] },
      today,
      offset: data.offset,
      nextOffset: data.offset + rows.length < total ? data.offset + rows.length : null,
    };
  });
