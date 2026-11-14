import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import {
  ACTIVE_LEAD_STATUSES,
  LEAD_BUCKETS,
  LEAD_FILTERS,
  LEAD_SELECT,
  leadToday,
  leadBucket,
  leadBucketSort,
  leadFilterBuckets,
  projectLead,
  type LeadBucket,
  type LeadFilter,
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
        filter: z.enum(LEAD_FILTERS).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<LeadPrioritiesResult> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = leadToday();
    const filter = data.filter as LeadFilter;

    const base = (countOnly: boolean) =>
      supabaseAdmin
        .from("applications")
        .select(countOnly ? "id" : LEAD_SELECT, countOnly ? { count: "exact", head: true } : {})
        .is("deleted_at", null)
        .in("status", ACTIVE_LEAD_STATUSES)
        .in(
          "contact_status",
          CONTACT_STATUS_KEYS.filter((s) => s !== "unqualified" && s !== "declined"),
        );

    // Mutually exclusive groups for All / New / Follow-up Due counters and pages.
    // An overdue new/interested lead counts only as overdue in those views.
    const queryBucket = (bucket: LeadBucket, countOnly: boolean) => {
      let q = base(countOnly);
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

    // Interested filter includes overdue interested rows so recent interest surfaces.
    const queryInterestedAll = (countOnly: boolean) =>
      base(countOnly).eq("contact_status", "interested");

    const counted = await Promise.all(LEAD_BUCKETS.map((b) => queryBucket(b, true)));
    if (counted.some((q) => q.error || !Number.isSafeInteger(q.count) || q.count! < 0))
      throw new Error("Lead priorities could not be loaded. Please retry.");
    const bucketCounts = counted.map((q) => q.count!);
    const counts = {
      overdue: bucketCounts[0],
      new: bucketCounts[1],
      hot: bucketCounts[2],
    };

    const orderBucket = (bucket: LeadBucket, q: ReturnType<typeof queryBucket>) => {
      const sort = leadBucketSort(bucket);
      return q
        .order(sort.primary, {
          ascending: sort.ascending,
          nullsFirst: false,
        })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });
    };

    const pageBuckets = leadFilterBuckets(filter);
    let total: number;
    let rows: ReturnType<typeof projectLead>[] = [];

    if (filter === "interested") {
      const interestedCount = await queryInterestedAll(true);
      if (
        interestedCount.error ||
        !Number.isSafeInteger(interestedCount.count) ||
        interestedCount.count! < 0
      )
        throw new Error("Lead priorities could not be loaded. Please retry.");
      total = interestedCount.count!;
      if (total > 0 && data.offset >= total)
        throw new Error("Lead priorities changed. Please refresh.");
      if (total > 0) {
        const result = await orderBucket("interested", queryInterestedAll(false)).range(
          data.offset,
          data.offset + data.limit - 1,
        );
        if (result.error || !result.data)
          throw new Error("Lead priorities changed or could not be loaded. Please refresh.");
        const selected = result.data as unknown as LeadRow[];
        // project with the real bucket so overdue interested stay labeled Urgent.
        rows = selected.map((r) => {
          const bucket = leadBucket(r, today) ?? "interested";
          return projectLead(r, bucket === "overdue" ? "overdue" : "interested");
        });
      }
    } else {
      const indexByBucket = Object.fromEntries(LEAD_BUCKETS.map((b, i) => [b, i])) as Record<
        LeadBucket,
        number
      >;
      total = pageBuckets.reduce((a, b) => a + bucketCounts[indexByBucket[b]], 0);
      if (total > 0 && data.offset >= total)
        throw new Error("Lead priorities changed. Please refresh.");
      let skip = data.offset;
      for (const bucket of pageBuckets) {
        const count = bucketCounts[indexByBucket[bucket]];
        if (skip >= count) {
          skip -= count;
          continue;
        }
        const take = Math.min(data.limit - rows.length, count - skip);
        if (!take) break;
        const result = await orderBucket(bucket, queryBucket(bucket, false)).range(
          skip,
          skip + take - 1,
        );
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
        if (rows.length >= data.limit) break;
      }
    }

    return {
      rows,
      total,
      counts,
      today,
      offset: data.offset,
      nextOffset: data.offset + rows.length < total ? data.offset + rows.length : null,
      filter,
    };
  });
