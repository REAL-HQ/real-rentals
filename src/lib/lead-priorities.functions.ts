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
    const openContacts = CONTACT_STATUS_KEYS.filter((s) => s !== "unqualified" && s !== "declined");
    const loadFailed = new Error("Lead priorities could not be loaded. Please retry.");

    // Anyone with a rental, in any status, is a renter. They are not a lead.
    const renterIds = new Set<string>();
    for (let from = 0; from < 20000; from += 1000) {
      const rentals = await supabaseAdmin
        .from("rentals")
        .select("application_id")
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (rentals.error) throw loadFailed;
      const batch = (rentals.data ?? []) as { application_id?: string | null }[];
      for (const rental of batch) {
        const id = String(rental.application_id ?? "").trim();
        if (id) renterIds.add(id);
      }
      if (batch.length < 1000) break;
    }

    const loadApplications = async (statuses: readonly string[]): Promise<LeadRow[]> => {
      const out: LeadRow[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const result = await supabaseAdmin
          .from("applications")
          .select(LEAD_SELECT)
          .is("deleted_at", null)
          .in("status", statuses as string[])
          .in("contact_status", openContacts)
          .order("id", { ascending: true })
          .range(from, from + 999);
        if (result.error) throw loadFailed;
        const batch = (result.data ?? []) as unknown as LeadRow[];
        out.push(...batch);
        if (batch.length < 1000) break;
      }
      return out;
    };

    // Buckets are decided here so a follow-up older than the last contact can
    // move to the next business day. That date is not a stored column.
    const eligible = [
      ...(await loadApplications(ACTIVE_LEAD_STATUSES)),
      ...(await loadApplications(["partial"])),
    ].filter((row) => !renterIds.has(row.id));
    const grouped = new Map<LeadBucket, LeadRow[]>(LEAD_BUCKETS.map((bucket) => [bucket, []]));
    for (const row of eligible) {
      const bucket = leadBucket(row, today);
      if (bucket) grouped.get(bucket)!.push(row);
    }
    const compare = (bucket: LeadBucket) => {
      const sort = leadBucketSort(bucket);
      return (a: LeadRow, b: LeadRow) => {
        const av = a[sort.primary];
        const bv = b[sort.primary];
        if (av !== bv) {
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * (sort.ascending ? 1 : -1);
        }
        const createdA = a.created_at ?? "";
        const createdB = b.created_at ?? "";
        if (createdA !== createdB) return createdA < createdB ? 1 : -1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      };
    };
    for (const bucket of LEAD_BUCKETS) grouped.get(bucket)!.sort(compare(bucket));
    const counts = {
      overdue: grouped.get("overdue")!.length,
      new: grouped.get("new")!.length,
      hot: grouped.get("interested")!.length,
      incomplete: grouped.get("incomplete")!.length,
    };

    const pageBuckets = leadFilterBuckets(filter);
    let total: number;
    let rows: ReturnType<typeof projectLead>[] = [];

    if (filter === "interested") {
      // Interested filter includes overdue interested rows so recent interest surfaces.
      const interested = eligible.filter((row) => row.contact_status === "interested").sort(compare("interested"));
      total = interested.length;
      if (total > 0 && data.offset >= total) throw new Error("Lead priorities changed. Please refresh.");
      const selected = interested.slice(data.offset, data.offset + data.limit);
      rows = selected.map((r) => {
        const bucket = leadBucket(r, today) ?? "interested";
        return projectLead(r, bucket === "overdue" ? "overdue" : "interested");
      });
    } else {
      total = pageBuckets.reduce((sum, bucket) => sum + grouped.get(bucket)!.length, 0);
      if (total > 0 && data.offset >= total) throw new Error("Lead priorities changed. Please refresh.");
      let skip = data.offset;
      for (const bucket of pageBuckets) {
        const list = grouped.get(bucket)!;
        if (skip >= list.length) {
          skip -= list.length;
          continue;
        }
        const take = Math.min(data.limit - rows.length, list.length - skip);
        if (!take) break;
        const selected = list.slice(skip, skip + take);
        if (selected.some((r) => leadBucket(r, today) !== bucket || rows.some((prior) => prior.id === r.id)))
          throw new Error("Lead priorities changed. Please refresh.");
        rows.push(...selected.map((r) => projectLead(r, bucket)));
        skip = 0;
        if (rows.length >= data.limit) break;
      }
    }

    // "Bad Email" on the card: the same rule that stops automated email to it.
    if (rows.length) {
      const { badEmailsFor } = await import("@/lib/email-suppression.server");
      const { normEmail } = await import("@/lib/email-suppression");
      const bad = await badEmailsFor(supabaseAdmin, rows.map((r) => r.email));
      rows = rows.map((r) => (r.email && bad.has(normEmail(r.email)) ? { ...r, email_bad: true } : r));
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
