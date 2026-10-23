import { tierAllows, tierFromRoles } from "@/lib/roles";
import {
  CLOSED_RENTAL_STATUSES,
  classifyDepositRefunds,
  easternToday,
  type DepositRefundsDueResponse,
} from "./deposit-refunds-due";

const PAGE = 200;
const MAX_ROWS = 100_000;
const ID_BATCH = 50;

const RENTAL_COLUMNS = "id,status,end_date,deposit_held,deposit_status,deposit_refund_amount,application_id";
const PAYMENT_COLUMNS = "id,rental_id,type,status,amount,net_collected,refunded_amount";
const DEDUCTION_COLUMNS = "id,rental_id,amount";
const APPLICATION_COLUMNS = "id,full_name";

type PageResult = { data: unknown[] | null; error: unknown; count: number | null };

export type DepositQuery = {
  select: (columns: string, options: { count: "exact" }) => DepositQuery;
  in: (column: string, values: readonly string[]) => DepositQuery;
  eq: (column: string, value: string) => DepositQuery;
  order: (column: string, options: { ascending: boolean }) => DepositQuery;
  range: (from: number, to: number) => PromiseLike<PageResult>;
};

export type DepositReads = {
  from: (table: string) => DepositQuery;
};

type ReadOutcome =
  | { status: "ok"; rows: Record<string, unknown>[] }
  | { status: "capped" }
  | { status: "degraded" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Same completion rules as waitlist completeRead, with a full read split from a failed read. */
export async function completeCounted(
  query: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<ReadOutcome> {
  try {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    do {
      const page = await query(rows.length, rows.length + PAGE - 1);
      const count = page.count;
      if (page.error || !Array.isArray(page.data) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        return { status: "degraded" };
      }
      if (count > MAX_ROWS) return { status: "capped" };
      if (total !== undefined && total !== count) return { status: "degraded" };
      total = count;
      if (page.data.length === 0 && rows.length < total) return { status: "degraded" };
      for (const row of page.data) {
        const record = asRecord(row);
        const id = record?.id;
        if (!record || typeof id !== "string" || seen.has(id)) return { status: "degraded" };
        seen.add(id);
        rows.push(record);
      }
      if (rows.length > total) return { status: "degraded" };
    } while (rows.length < total);
    return { status: "ok", rows };
  } catch {
    return { status: "degraded" };
  }
}

async function readInBatches(
  ids: string[],
  query: (ids: string[], from: number, to: number) => PromiseLike<PageResult>,
): Promise<ReadOutcome> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const page = await completeCounted((from, to) => query(ids.slice(i, i + ID_BATCH), from, to));
    if (page.status !== "ok") return page;
    rows.push(...page.rows);
  }
  return { status: "ok", rows };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw || null;
}

async function assertManager(supabase: DepositReads, userId: string): Promise<void> {
  const page = await completeCounted((from, to) =>
    supabase
      .from("user_roles")
      .select("id,role", { count: "exact" })
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (page.status !== "ok") throw new Error("Forbidden");
  const roles = page.rows.map((row) => String(row.role ?? ""));
  if (!tierAllows(tierFromRoles(roles), "manager")) throw new Error("Forbidden");
}

export async function loadDepositRefundsDue(supabase: DepositReads, now = new Date()): Promise<DepositRefundsDueResponse> {
  const rentals = await completeCounted((from, to) =>
    supabase
      .from("rentals")
      .select(RENTAL_COLUMNS, { count: "exact" })
      .in("status", CLOSED_RENTAL_STATUSES)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (rentals.status !== "ok") return { status: rentals.status };

  const rentalIds = rentals.rows.map((row) => String(row.id));
  const payments = await readInBatches(rentalIds, (ids, from, to) =>
    supabase
      .from("payments")
      .select(PAYMENT_COLUMNS, { count: "exact" })
      .in("rental_id", ids)
      .eq("type", "deposit")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (payments.status !== "ok") return { status: payments.status };

  const deductions = await readInBatches(rentalIds, (ids, from, to) =>
    supabase
      .from("deposit_deductions")
      .select(DEDUCTION_COLUMNS, { count: "exact" })
      .in("rental_id", ids)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (deductions.status !== "ok") return { status: deductions.status };

  const applicationIds = [
    ...new Set(rentals.rows.map((row) => text(row.application_id)).filter((id): id is string => !!id)),
  ];
  const applications = await readInBatches(applicationIds, (ids, from, to) =>
    supabase
      .from("applications")
      .select(APPLICATION_COLUMNS, { count: "exact" })
      .in("id", ids)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (applications.status !== "ok") return { status: applications.status };

  const asOf = easternToday(now);
  return {
    status: "ready",
    report: {
      asOf,
      rows: classifyDepositRefunds({
        asOf,
        rentals: rentals.rows.map((row) => ({
          id: String(row.id),
          status: text(row.status),
          endDate: text(row.end_date),
          depositHeld: row.deposit_held === true,
          depositStatus: text(row.deposit_status),
          depositRefundAmount:
            row.deposit_refund_amount == null ? null : (row.deposit_refund_amount as string | number),
          applicationId: text(row.application_id),
        })),
        payments: payments.rows.map((row) => ({
          id: String(row.id),
          rentalId: text(row.rental_id),
          type: text(row.type),
          status: text(row.status),
          amount: row.amount == null ? null : (row.amount as string | number),
          netCollected: row.net_collected == null ? null : (row.net_collected as string | number),
          refundedAmount: row.refunded_amount == null ? null : (row.refunded_amount as string | number),
        })),
        deductions: deductions.rows.map((row) => ({
          id: String(row.id),
          rentalId: text(row.rental_id),
          amount: row.amount == null ? null : (row.amount as string | number),
        })),
        applications: applications.rows.map((row) => ({
          id: String(row.id),
          fullName: text(row.full_name),
        })),
      }),
    },
  };
}

export async function runDepositRefundsDue(input: {
  enabled: boolean;
  supabase: unknown;
  userId: string;
  now?: Date;
}): Promise<DepositRefundsDueResponse> {
  if (!input.enabled) return { status: "disabled" };
  const supabase = input.supabase as DepositReads;
  await assertManager(supabase, input.userId);
  return loadDepositRefundsDue(supabase, input.now ?? new Date());
}
