// Manage Late Fees: read a rental's late fee ledger, forgive fees, undo.
//
// Nothing here sends a message, calls Stripe or touches a collected charge.
// Forgiving lowers what is owed: it records a credit per late day
// (late_fee_forgiveness) and lowers the open rent row's late_fees and
// balance_due by what had been recorded there, so "Late $X", the balance, FLEET's
// balance read and the reminder texts all drop at once. The daily sweep reads
// the same credits, so a forgiven fee is never added back.
//
// Until the late_fee_forgiveness migration is applied (needs Dolmar's
// approval), forgiveness that is whole days from the oldest open day of a week
// is saved as a staff waiver (rent_late_fee_waivers, "waived through"), the
// mechanism the sweep and texts already honor. Anything finer (a part of a
// day's fee, a later day while an earlier one stays) says it needs the update
// and changes nothing.
import { dealWindows } from "@/lib/late-fees.server";
import {
  buildLedger,
  forgiveReasonLabel,
  ledgerPolicyFrom,
  planAsWaivers,
  planForgiveness,
  r2,
  type ForgiveMode,
  type Ledger,
  type LedgerDeal,
  type LedgerForgiveness,
  type LedgerPolicy,
  type LedgerWaiver,
  type LedgerWeekInput,
} from "@/lib/late-fee-ledger";

export const FORGIVENESS_TABLE = "late_fee_forgiveness";
/** Rent rows whose late fees can still be lowered. Never paid, processing (pending) or closed rows. */
export const ADJUSTABLE_STATUSES = ["failed", "overdue", "past_due", "unpaid", "late", "current", "collections"];
const SETTLED = ["paid", "succeeded"];

type Admin = any;

export function isMissingTable(err: any, table: string): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (msg.includes(table) && /does not exist|not find|schema cache/i.test(msg));
}

export type LateFeeContext = {
  policy: LedgerPolicy;
  waiversBy: Map<string, LedgerWaiver[]>;
  forgivenessBy: Map<string, LedgerForgiveness[]>;
  dealsBy: Map<string, LedgerDeal[]>;
  /** False until the late_fee_forgiveness migration is applied. */
  forgivenessTable: boolean;
};

const push = <T,>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

/** Everything the ledger needs besides the weeks, for a set of rentals. Missing tables read as empty. */
export async function loadLateFeeContext(admin: Admin, rentalIds: string[]): Promise<LateFeeContext> {
  const ctx: LateFeeContext = { policy: ledgerPolicyFrom(null), waiversBy: new Map(), forgivenessBy: new Map(), dealsBy: new Map(), forgivenessTable: true };
  const policyRes = await admin.from("app_settings").select("value").eq("key", "late_fee_policy").maybeSingle();
  if (!policyRes?.error) ctx.policy = ledgerPolicyFrom(policyRes?.data?.value);
  if (!rentalIds.length) {
    const probe = await admin.from(FORGIVENESS_TABLE).select("id").limit(1);
    ctx.forgivenessTable = !(probe?.error && isMissingTable(probe.error, FORGIVENESS_TABLE));
    return ctx;
  }
  const [w, f, deals] = await Promise.all([
    admin.from("rent_late_fee_waivers").select("rental_id,due_date,waived_through,waived_by_email,created_at,reason").in("rental_id", rentalIds),
    admin.from(FORGIVENESS_TABLE).select("id,rental_id,due_date,fee_date,amount,reason,note,forgiven_by_email,created_at,undone_at").in("rental_id", rentalIds),
    dealWindows(admin, rentalIds).catch(() => new Map()),
  ]);
  for (const x of (w?.error ? [] : w?.data ?? []) as any[]) {
    push(ctx.waiversBy, x.rental_id, { dueDate: String(x.due_date).slice(0, 10), waivedThrough: x.waived_through ? String(x.waived_through).slice(0, 10) : null, byEmail: x.waived_by_email ?? null, at: x.created_at ?? null, reason: x.reason ?? null });
  }
  if (f?.error) {
    if (isMissingTable(f.error, FORGIVENESS_TABLE)) ctx.forgivenessTable = false;
  } else {
    for (const x of (f?.data ?? []) as any[]) {
      push(ctx.forgivenessBy, x.rental_id, {
        id: x.id, dueDate: String(x.due_date).slice(0, 10), feeDate: x.fee_date ? String(x.fee_date).slice(0, 10) : null,
        amount: Number(x.amount ?? 0), reason: x.reason ?? null, note: x.note ?? null, byEmail: x.forgiven_by_email ?? null,
        at: x.created_at ?? null, undoneAt: x.undone_at ?? null,
      });
    }
  }
  for (const [id, list] of deals as Map<string, LedgerDeal[]>) ctx.dealsBy.set(id, list);
  return ctx;
}

/** Totals of late fees still owed per (rental, due date) after forgiveness: what the sweep subtracts from its target. */
export function forgivenByWeek(ctx: LateFeeContext, rentalId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of ctx.forgivenessBy.get(rentalId) ?? []) {
    if (f.undoneAt || !(f.amount > 0)) continue;
    out.set(f.dueDate, r2((out.get(f.dueDate) ?? 0) + f.amount));
  }
  return out;
}

export type RentalLedgerRead = {
  rentalId: string;
  driverName: string | null;
  mode: "stripe" | "manual";
  rentOwed: number;
  ledger: Ledger;
  policy: LedgerPolicy;
  storage: "table" | "waivers";
  today: string;
  /** Rent rows by due date, for lowering late_fees / balance_due. */
  rows: { id: string; due_date: string; status: string; late_fees: number; balance_due: number | null; amount: number }[];
};

/** One rental's ledger: weeks still owed (as the Active tab works them out) plus recently paid weeks that carried fees. */
export async function readRentalLedger(admin: Admin, rentalId: string, today: string, deps: Record<string, unknown> = {}): Promise<RentalLedgerRead> {
  const { loadBillingStates } = await import("@/lib/rent-reminders.server");
  const { states } = await loadBillingStates(admin, deps as any, today, { rentalIds: [rentalId] });
  const s = states.find((x) => x.rentalId === rentalId) ?? null;
  const ctx = await loadLateFeeContext(admin, [rentalId]);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const pays = await admin.from("payments").select("id,type,status,amount,late_fees,balance_due,due_date,paid_date,created_at").eq("rental_id", rentalId).gte("due_date", since);
  const payRows: any[] = pays?.error ? [] : pays?.data ?? [];
  const rentRows = payRows.filter((p) => String(p.type ?? "rent") === "rent" && p.due_date);

  const weeks: LedgerWeekInput[] = [];
  const owingDues = new Set<string>();
  if (s?.owing && s.dueDate) owingDues.add(s.dueDate.slice(0, 10));
  for (const o of s?.otherInvoices ?? []) if (o.createdOn) owingDues.add(o.createdOn.slice(0, 10));
  const rowFor = (due: string) => rentRows.find((p) => String(p.due_date).slice(0, 10) === due && ADJUSTABLE_STATUSES.includes(String(p.status)))
    ?? rentRows.find((p) => String(p.due_date).slice(0, 10) === due && !SETTLED.includes(String(p.status)));
  for (const due of owingDues) weeks.push({ dueDate: due, asOf: today, owing: true, paymentId: rowFor(due)?.id ?? null });
  // Recently paid weeks with fees, a waiver or forgiveness on them: shown as history (Paid / Forgiven), never forgivable.
  const credited = new Set<string>([...(ctx.waiversBy.get(rentalId) ?? []).map((w) => w.dueDate), ...(ctx.forgivenessBy.get(rentalId) ?? []).map((f) => f.dueDate)]);
  for (const p of rentRows) {
    const due = String(p.due_date).slice(0, 10);
    if (owingDues.has(due) || !SETTLED.includes(String(p.status))) continue;
    if (!(Number(p.late_fees ?? 0) > 0) && !credited.has(due)) continue;
    const paidOn = String(p.paid_date ?? "").slice(0, 10) || today;
    weeks.push({ dueDate: due, asOf: paidOn < today ? paidOn : today, owing: false, settled: true, paymentId: p.id });
  }
  // Late fees collected on their own (a one-off late_fee payment) since the oldest week still owed.
  const oldest = [...owingDues].sort()[0] ?? null;
  const paidLateFees = oldest
    ? payRows.filter((p) => String(p.type) === "late_fee" && SETTLED.includes(String(p.status)) && String(p.paid_date ?? p.created_at ?? "").slice(0, 10) >= oldest).reduce((t, p) => t + Number(p.amount ?? 0), 0)
    : 0;

  const ledger = buildLedger({
    policy: ctx.policy, weeks, waivers: ctx.waiversBy.get(rentalId) ?? [], deals: ctx.dealsBy.get(rentalId) ?? [],
    forgiveness: ctx.forgivenessBy.get(rentalId) ?? [], paidLateFees,
  });
  return {
    rentalId, driverName: s?.firstName ?? null, mode: s?.mode ?? "manual", rentOwed: s?.rentOwed ?? 0, ledger, policy: ctx.policy,
    storage: ctx.forgivenessTable ? "table" : "waivers", today,
    rows: rentRows.map((p) => ({ id: p.id, due_date: String(p.due_date).slice(0, 10), status: String(p.status), late_fees: Number(p.late_fees ?? 0), balance_due: p.balance_due == null ? null : Number(p.balance_due), amount: Number(p.amount ?? 0) })),
  };
}

export type ForgiveInput = { rentalId: string; mode: ForgiveMode; reason: string; note: string | null; expectedOpen?: number | null };
export type ForgiveResult = {
  total: number;
  storage: "table" | "waivers";
  allocations: { dueDate: string; feeDate: string; amount: number }[];
  forgivenessIds: string[];
  waiverIds: string[];
  paymentUpdates: { paymentId: string; lateFeesBefore: number; lateFeesAfter: number; balanceBefore: number | null; balanceAfter: number | null }[];
  warnings: string[];
  openBefore: number;
  openAfter: number;
};

/** Lower an open rent row's recorded late fees (never below 0) and its balance by the same amount. */
function paymentReduction(row: RentalLedgerRead["rows"][number] | undefined, amount: number) {
  if (!row || !ADJUSTABLE_STATUSES.includes(row.status)) return null;
  const take = r2(Math.min(Math.max(0, row.late_fees), Math.max(0, amount)));
  if (take <= 0) return null;
  return {
    row, take,
    lateFeesAfter: r2(row.late_fees - take),
    balanceAfter: row.balance_due == null ? null : r2(Math.max(0, row.balance_due - take)),
  };
}

export async function forgiveLateFees(admin: Admin, input: ForgiveInput, actor: { userId: string; email: string | null }, opts: { now?: Date; deps?: Record<string, unknown> } = {}): Promise<ForgiveResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Choose A Reason.");
  const { easternParts } = await import("@/lib/rent-reminders");
  const now = opts.now ?? new Date();
  const today = easternParts(now).date;
  const read = await readRentalLedger(admin, input.rentalId, today, opts.deps);
  const before = read.ledger;
  const openBefore = r2(before.weeks.filter((w) => w.owing).reduce((t, w) => t + w.open, 0));
  if (input.expectedOpen != null && Math.abs(input.expectedOpen - openBefore) > 0.009) {
    throw new Error("Late Fees Changed Since You Opened This. Refresh And Try Again.");
  }
  const plan = planForgiveness(before, input.mode);
  if (plan.problem) throw new Error(plan.problem);

  const warnings: string[] = [];
  const result: ForgiveResult = { total: 0, storage: read.storage, allocations: [], forgivenessIds: [], waiverIds: [], paymentUpdates: [], warnings, openBefore, openAfter: openBefore };
  // What each week actually drops by (equals the plan with the table; with waivers the weekly cap can absorb some).
  const dropByWeek = new Map<string, number>();

  if (read.storage === "table") {
    for (const a of plan.allocations) dropByWeek.set(a.dueDate, r2((dropByWeek.get(a.dueDate) ?? 0) + a.amount));
    // Work out the rent row changes first so each credit records what it took off the row (Undo puts exactly that back).
    const reductions = new Map<string, ReturnType<typeof paymentReduction>>();
    const perAllocTake = new Map<number, number>();
    for (const [due, drop] of dropByWeek) {
      const week = before.weeks.find((w) => w.dueDate === due);
      const row = read.rows.find((r) => r.id === week?.paymentId);
      const red = paymentReduction(row, drop);
      reductions.set(due, red);
      let left = red?.take ?? 0;
      plan.allocations.forEach((a, i) => {
        if (a.dueDate !== due || left <= 0) return;
        const t = r2(Math.min(left, a.amount));
        perAllocTake.set(i, t);
        left = r2(left - t);
      });
    }
    const rows = plan.allocations.map((a, i) => {
      const week = before.weeks.find((w) => w.dueDate === a.dueDate);
      return {
        rental_id: input.rentalId, due_date: a.dueDate, fee_date: a.feeDate, amount: a.amount, reason: reason.slice(0, 80),
        note: input.note?.trim().slice(0, 500) || null, payment_id: week?.paymentId ?? null, payment_late_fee_reduced: perAllocTake.get(i) ?? 0,
        forgiven_by: actor.userId, forgiven_by_email: actor.email,
      };
    });
    const ins = await admin.from(FORGIVENESS_TABLE).insert(rows).select("id");
    if (ins?.error || !ins?.data) throw new Error("Could Not Save The Forgiveness. Nothing Was Changed.");
    result.forgivenessIds = (ins.data as any[]).map((x) => x.id);
    for (const [due, red] of reductions) {
      if (!red) continue;
      const ok = await applyRowReduction(admin, red);
      if (ok) result.paymentUpdates.push({ paymentId: red.row.id, lateFeesBefore: red.row.late_fees, lateFeesAfter: red.lateFeesAfter, balanceBefore: red.row.balance_due, balanceAfter: red.balanceAfter });
      else {
        warnings.push(`The rent row for the week due ${due} could not be lowered. The forgiveness is saved and the daily sweep will not add those fees back.`);
        const ids = result.forgivenessIds.filter((_, i) => plan.allocations[i]?.dueDate === due);
        if (ids.length) await admin.from(FORGIVENESS_TABLE).update({ payment_late_fee_reduced: 0 }).in("id", ids);
      }
    }
  } else {
    const asWaivers = planAsWaivers(before, plan);
    if (!asWaivers.ok) {
      throw new Error(`${asWaivers.why} Needs The Pending Database Update (Late Fee Forgiveness). Until It Is Approved, Forgive Whole Days From The Oldest, Or Forgive All.`);
    }
    for (const w of asWaivers.waivers) {
      const res = await admin.from("rent_late_fee_waivers").upsert({
        rental_id: input.rentalId, due_date: w.dueDate, waived_through: w.waivedThrough, amount_waived: null,
        reason: `Forgiven: ${forgiveReasonLabel(reason)}${input.note?.trim() ? `. ${input.note.trim()}` : ""}`.slice(0, 500),
        waived_by: actor.userId, waived_by_email: actor.email,
      }, { onConflict: "rental_id,due_date" }).select("id").single();
      if (res?.error || !res?.data) throw new Error(result.waiverIds.length ? "Some Days Were Forgiven, But Not All. Refresh And Check." : "Could Not Save The Forgiveness. Nothing Was Changed.");
      result.waiverIds.push(res.data.id);
    }
    const after = await readRentalLedger(admin, input.rentalId, today, opts.deps);
    for (const w of before.weeks) {
      const a = after.ledger.weeks.find((x) => x.dueDate === w.dueDate);
      const drop = r2(w.open - (a?.open ?? w.open));
      if (drop > 0) dropByWeek.set(w.dueDate, drop);
    }
    for (const [due, drop] of dropByWeek) {
      const week = before.weeks.find((w) => w.dueDate === due);
      const red = paymentReduction(read.rows.find((r) => r.id === week?.paymentId), drop);
      if (!red) continue;
      if (await applyRowReduction(admin, red)) result.paymentUpdates.push({ paymentId: red.row.id, lateFeesBefore: red.row.late_fees, lateFeesAfter: red.lateFeesAfter, balanceBefore: red.row.balance_due, balanceAfter: red.balanceAfter });
      else warnings.push(`The rent row for the week due ${due} could not be lowered. Refresh and check.`);
    }
  }

  result.total = r2([...dropByWeek.values()].reduce((t, x) => t + x, 0));
  result.allocations = plan.allocations.map((a) => ({ dueDate: a.dueDate, feeDate: a.feeDate, amount: a.amount }));
  result.openAfter = r2(Math.max(0, openBefore - result.total));
  if (read.storage === "waivers" && result.total < plan.total) warnings.push(`The weekly late fee cap absorbed $${r2(plan.total - result.total).toFixed(2)} of this.`);
  return result;
}

async function applyRowReduction(admin: Admin, red: NonNullable<ReturnType<typeof paymentReduction>>): Promise<boolean> {
  const patch: Record<string, unknown> = { late_fees: red.lateFeesAfter };
  if (red.balanceAfter != null) patch.balance_due = red.balanceAfter;
  // Guarded on the status and the late fees we read, so a payment or sweep in between is never overwritten.
  const u = await admin.from("payments").update(patch).eq("id", red.row.id).eq("status", red.row.status).eq("late_fees", red.row.late_fees).select("id");
  return !u?.error && Array.isArray(u?.data) && u.data.length > 0;
}

/** Owner only: take a forgiveness back. Puts back exactly what it took off the open rent row. Sends nothing. */
export async function undoLateFeeForgiveness(admin: Admin, input: { forgivenessId: string; note: string | null }, actor: { userId: string; email: string | null }) {
  const r = await admin.from(FORGIVENESS_TABLE).select("id,rental_id,due_date,fee_date,amount,payment_id,payment_late_fee_reduced,undone_at").eq("id", input.forgivenessId).maybeSingle();
  if (r?.error && isMissingTable(r.error, FORGIVENESS_TABLE)) throw new Error("Undo Needs The Pending Database Update.");
  if (r?.error || !r?.data) throw new Error("Forgiveness Not Found.");
  const row = r.data;
  if (row.undone_at) throw new Error("Already Undone.");
  const u = await admin.from(FORGIVENESS_TABLE).update({ undone_at: new Date().toISOString(), undone_by: actor.userId, undone_by_email: actor.email, undo_note: input.note?.trim().slice(0, 500) || null })
    .eq("id", row.id).is("undone_at", null).select("id");
  if (u?.error || !u?.data?.length) throw new Error("Could Not Undo. Nothing Was Changed.");
  let restored = 0;
  const back = r2(Number(row.payment_late_fee_reduced ?? 0));
  if (row.payment_id && back > 0) {
    const p = await admin.from("payments").select("id,status,late_fees,balance_due").eq("id", row.payment_id).maybeSingle();
    if (!p?.error && p?.data && ADJUSTABLE_STATUSES.includes(String(p.data.status))) {
      const lf = Number(p.data.late_fees ?? 0);
      const patch: Record<string, unknown> = { late_fees: r2(lf + back) };
      if (p.data.balance_due != null) patch.balance_due = r2(Number(p.data.balance_due) + back);
      const w = await admin.from("payments").update(patch).eq("id", p.data.id).eq("status", p.data.status).eq("late_fees", lf).select("id");
      if (!w?.error && w?.data?.length) restored = back;
    }
  }
  return { id: row.id, rentalId: row.rental_id as string, dueDate: String(row.due_date).slice(0, 10), feeDate: row.fee_date ? String(row.fee_date).slice(0, 10) : null, amount: Number(row.amount), restoredToRow: restored };
}
