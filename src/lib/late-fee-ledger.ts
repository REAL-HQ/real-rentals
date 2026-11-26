// Late fee ledger: one line per late day, so staff can see and forgive each fee.
//
// Pure and client-safe. The Active tab's "Late $X", the Manage Late Fees
// dialog, the rent reminder texts and the forgiveness server function all read
// late fees through this file, so they can never disagree.
//
// How a late fee comes about (docs/late-fees.md): $50 for each Eastern day rent
// stays unpaid, from the day after the due date (app_settings.late_fee_policy:
// daily fee, grace days, flat first-day fee, cap per week). Never charged:
// days staff waived (rent_late_fee_waivers), days inside an approved payment
// deal, days after the car came back. Forgiveness (late_fee_forgiveness) is a
// dollar credit on a specific day's fee, taken off after the cap, so a
// forgiven fee never comes back on the next daily sweep.

export type LedgerPolicy = { daily: number; flat: number; grace: number; cap: number };

/** What the texts have always said when no policy is stored: $50/day, no cap. */
export const FALLBACK_LEDGER_POLICY: LedgerPolicy = { daily: 50, flat: 0, grace: 0, cap: 0 };

/** app_settings.late_fee_policy -> ledger numbers (enabled only gates the sweep, not what is owed on paper). */
export function ledgerPolicyFrom(raw: unknown): LedgerPolicy {
  if (!raw || typeof raw !== "object") return FALLBACK_LEDGER_POLICY;
  const v = raw as Record<string, unknown>;
  const num = (x: unknown, fb: number) => {
    const n = Number(x);
    return x != null && x !== "" && Number.isFinite(n) && n >= 0 ? n : fb;
  };
  return {
    daily: num(v.daily_fee, FALLBACK_LEDGER_POLICY.daily),
    flat: num(v.flat_fee, 0),
    grace: Math.floor(num(v.grace_days, 0)),
    cap: num(v.max_fee, 0),
  };
}

export type LedgerWaiver = { dueDate: string; waivedThrough: string | null; byEmail?: string | null; at?: string | null; reason?: string | null };
export type LedgerDeal = { from: string; through: string };
export type LedgerForgiveness = {
  id: string;
  dueDate: string;
  /** The late day this credit belongs to; null = oldest open fees of the week first. */
  feeDate: string | null;
  amount: number;
  reason: string | null;
  note?: string | null;
  byEmail: string | null;
  at: string | null;
  undoneAt?: string | null;
};

export type LedgerWeekInput = {
  dueDate: string;
  /** Last day fees can accrue: today, the day rent was paid, or the day the car came back. */
  asOf: string;
  /** Rent for this week is still owed now. */
  owing: boolean;
  /** Rent for this week was paid: whatever late fees it carried were settled with it. */
  settled?: boolean;
  paymentId?: string | null;
};

export type LedgerFeeStatus = "open" | "partly_forgiven" | "forgiven" | "waived" | "paid" | "paused";

export type LedgerCredit = { kind: "forgiven" | "waived"; amount: number; byEmail: string | null; at: string | null; reason: string | null; note?: string | null; forgivenessId?: string };

export type LedgerFee = {
  /** Stable id: `${dueDate}|${feeDate}`. */
  id: string;
  dueDate: string;
  feeDate: string;
  /** Day number after the due date (1 = the day after). */
  day: number;
  /** What the day's fee is under the policy (0 for deal days). */
  amount: number;
  paid: number;
  forgiven: number;
  open: number;
  status: LedgerFeeStatus;
  credits: LedgerCredit[];
};

export type LedgerWeek = {
  dueDate: string;
  owing: boolean;
  settled: boolean;
  paymentId: string | null;
  fees: LedgerFee[];
  /** Fees under the policy before any forgiveness (waived and deal days excluded, as the sweep does). */
  gross: number;
  forgiven: number;
  paid: number;
  open: number;
  capReached: boolean;
  wholeWeekWaived: boolean;
  /** Nominal fees on days staff waived (rent_late_fee_waivers); never counted in gross. */
  waived: number;
};

export type Ledger = { weeks: LedgerWeek[]; totalOpen: number; totalForgiven: number; totalPaid: number; totalGross: number; totalWaived: number };

export const r2 = (n: number) => Math.round(n * 100) / 100;

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function buildLedgerWeek(args: {
  policy: LedgerPolicy;
  week: LedgerWeekInput;
  waivers?: LedgerWaiver[];
  deals?: LedgerDeal[];
  forgiveness?: LedgerForgiveness[];
  /** Late-fee dollars collected separately (one-off late_fee payments) applied to this week, oldest day first. */
  paidPool?: number;
}): LedgerWeek {
  const { policy, week } = args;
  const due = week.dueDate.slice(0, 10);
  const daysLate = Math.max(0, dayDiff(due, week.asOf.slice(0, 10)));
  const mine = (args.waivers ?? []).filter((w) => String(w.dueDate).slice(0, 10) === due);
  const whole = mine.find((w) => w.waivedThrough == null) ?? null;
  const fees: LedgerFee[] = [];
  let running = 0;
  let chargeIndex = 0;
  let capReached = false;
  for (let day = 1; day <= daysLate; day++) {
    if (day <= policy.grace) continue;
    const feeDate = addDays(due, day);
    const id = `${due}|${feeDate}`;
    const waiver = whole ?? mine.find((w) => w.waivedThrough && feeDate <= String(w.waivedThrough).slice(0, 10)) ?? null;
    if (waiver) {
      fees.push({ id, dueDate: due, feeDate, day, amount: policy.daily, paid: 0, forgiven: 0, open: 0, status: "waived",
        credits: [{ kind: "waived", amount: policy.daily, byEmail: waiver.byEmail ?? null, at: waiver.at ?? null, reason: waiver.reason ?? null }] });
      continue;
    }
    if ((args.deals ?? []).some((d) => feeDate >= d.from && feeDate <= d.through)) {
      fees.push({ id, dueDate: due, feeDate, day, amount: 0, paid: 0, forgiven: 0, open: 0, status: "paused", credits: [] });
      continue;
    }
    chargeIndex++;
    let amount = policy.daily + (chargeIndex === 1 ? policy.flat : 0);
    if (policy.cap > 0) amount = Math.min(amount, Math.max(0, policy.cap - running));
    amount = r2(amount);
    if (amount <= 0) { capReached = true; break; }
    running = r2(running + amount);
    if (policy.cap > 0 && running >= policy.cap) capReached = true;
    fees.push({ id, dueDate: due, feeDate, day, amount, paid: 0, forgiven: 0, open: amount, status: "open", credits: [] });
  }

  const chargeable = fees.filter((f) => f.status === "open");
  const active = (args.forgiveness ?? []).filter((f) => !f.undoneAt && String(f.dueDate).slice(0, 10) === due && f.amount > 0);
  const credit = (f: LedgerFee, x: LedgerForgiveness, amt: number) => {
    const take = r2(Math.min(amt, f.open));
    if (take <= 0) return 0;
    f.forgiven = r2(f.forgiven + take);
    f.open = r2(f.open - take);
    f.credits.push({ kind: "forgiven", amount: take, byEmail: x.byEmail, at: x.at, reason: x.reason, note: x.note ?? null, forgivenessId: x.id });
    return take;
  };
  // 1) Credits for a named day.
  for (const x of active.filter((x) => x.feeDate)) {
    const f = chargeable.find((c) => c.feeDate === String(x.feeDate).slice(0, 10));
    if (f) credit(f, x, x.amount);
  }
  // 2) A settled week's remaining fees were paid with the rent; otherwise separately collected late fees, oldest first.
  if (week.settled) {
    for (const f of chargeable) { f.paid = f.open; f.open = 0; }
  } else {
    let pool = r2(Math.max(0, args.paidPool ?? 0));
    for (const f of chargeable) {
      if (pool <= 0) break;
      const take = r2(Math.min(pool, f.open));
      f.paid = r2(f.paid + take); f.open = r2(f.open - take); pool = r2(pool - take);
    }
  }
  // 3) Week-level credits, oldest open day first.
  for (const x of active.filter((x) => !x.feeDate)) {
    let left = x.amount;
    for (const f of chargeable) { if (left <= 0) break; left = r2(left - credit(f, x, left)); }
  }
  for (const f of chargeable) {
    if (f.open > 0) f.status = f.forgiven > 0 ? "partly_forgiven" : "open";
    else f.status = f.forgiven > 0 && f.paid <= 0 ? "forgiven" : "paid";
  }
  const sum = (k: "amount" | "forgiven" | "paid" | "open") => r2(chargeable.reduce((t, f) => t + f[k], 0));
  return {
    dueDate: due, owing: week.owing, settled: !!week.settled, paymentId: week.paymentId ?? null, fees,
    gross: sum("amount"), forgiven: sum("forgiven"), paid: sum("paid"), open: sum("open"), capReached, wholeWeekWaived: !!whole,
    waived: (() => { const n = r2(fees.filter((f) => f.status === "waived").reduce((t, f) => t + f.amount, 0)); return policy.cap > 0 ? Math.min(n, policy.cap) : n; })(),
  };
}

export function buildLedger(args: {
  policy: LedgerPolicy;
  weeks: LedgerWeekInput[];
  waivers?: LedgerWaiver[];
  deals?: LedgerDeal[];
  forgiveness?: LedgerForgiveness[];
  /** Total of separately collected late fees (paid late_fee rows), spread oldest week first across owing weeks. */
  paidLateFees?: number;
}): Ledger {
  const seen = new Set<string>();
  const inputs = [...args.weeks]
    .filter((w) => w.dueDate && !seen.has(w.dueDate.slice(0, 10)) && seen.add(w.dueDate.slice(0, 10)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let pool = r2(Math.max(0, args.paidLateFees ?? 0));
  const weeks: LedgerWeek[] = [];
  for (const w of inputs) {
    const built = buildLedgerWeek({ policy: args.policy, week: w, waivers: args.waivers, deals: args.deals, forgiveness: args.forgiveness, paidPool: w.settled ? 0 : pool });
    if (!w.settled) pool = r2(Math.max(0, pool - built.paid));
    weeks.push(built);
  }
  const t = (k: "open" | "forgiven" | "paid" | "gross" | "waived") => r2(weeks.reduce((s, w) => s + w[k], 0));
  return { weeks, totalOpen: t("open"), totalForgiven: t("forgiven"), totalPaid: t("paid"), totalGross: t("gross"), totalWaived: t("waived") };
}

/** Open late fees on the weeks still owed (what "Late $X" shows and what the texts quote). */
export function owingOpen(ledger: Ledger): number {
  return r2(ledger.weeks.filter((w) => w.owing).reduce((s, w) => s + w.open, 0));
}

// ------------------------------------------------------------------ forgiveness plan

export type ForgiveMode =
  | { kind: "all" }
  | { kind: "selected"; feeIds: string[] }
  | { kind: "amount"; amount: number };

export type ForgiveAllocation = { feeId: string; dueDate: string; feeDate: string; amount: number };
export type ForgivePlan = { allocations: ForgiveAllocation[]; total: number; skippedPaid: string[]; problem: string | null };

/** Fees that can be forgiven: open (or partly forgiven) fees on weeks still owed. Paid, waived and deal days cannot. */
export function forgivableFees(ledger: Ledger): LedgerFee[] {
  return ledger.weeks.filter((w) => w.owing && !w.settled).flatMap((w) => w.fees.filter((f) => f.open > 0));
}

export function planForgiveness(ledger: Ledger, mode: ForgiveMode): ForgivePlan {
  const open = forgivableFees(ledger); // weeks are sorted, fees by day: oldest first
  const all = ledger.weeks.flatMap((w) => w.fees);
  const alloc = (f: LedgerFee, amount: number): ForgiveAllocation => ({ feeId: f.id, dueDate: f.dueDate, feeDate: f.feeDate, amount: r2(amount) });
  let allocations: ForgiveAllocation[] = [];
  const skippedPaid: string[] = [];
  let problem: string | null = null;
  if (mode.kind === "all") {
    allocations = open.map((f) => alloc(f, f.open));
  } else if (mode.kind === "selected") {
    const want = new Set(mode.feeIds);
    for (const id of want) {
      const f = all.find((x) => x.id === id);
      if (!f) { problem = "A Selected Fee Is No Longer On This Rental. Refresh And Try Again."; continue; }
      const o = open.find((x) => x.id === id);
      if (!o) { if (f.status === "paid") skippedPaid.push(id); continue; }
      allocations.push(alloc(o, o.open));
    }
    allocations.sort((a, b) => a.feeId.localeCompare(b.feeId));
    if (skippedPaid.length && !allocations.length) problem = "Paid Late Fees Can't Be Forgiven Here.";
  } else {
    let left = r2(mode.amount);
    if (!(left > 0)) problem = "Enter An Amount Above $0.";
    const max = r2(open.reduce((t, f) => t + f.open, 0));
    if (left > max + 0.001) problem = `Only $${max.toFixed(2)} In Late Fees Can Be Forgiven.`;
    for (const f of open) {
      if (left <= 0 || problem) break;
      const take = r2(Math.min(left, f.open));
      allocations.push(alloc(f, take));
      left = r2(left - take);
    }
  }
  const total = r2(allocations.reduce((t, a) => t + a.amount, 0));
  if (!problem && total <= 0) problem = "Nothing To Forgive.";
  return { allocations: problem ? [] : allocations, total: problem ? 0 : total, skippedPaid, problem };
}

/** Allocations as forgiveness rows (not yet saved), for previews and the server. */
export function allocationsAsForgiveness(plan: ForgivePlan, meta: { reason: string; note?: string | null; byEmail: string | null; at: string }): LedgerForgiveness[] {
  return plan.allocations.map((a, i) => ({ id: `preview-${i}`, dueDate: a.dueDate, feeDate: a.feeDate, amount: a.amount, reason: meta.reason, note: meta.note ?? null, byEmail: meta.byEmail, at: meta.at, undoneAt: null }));
}

/**
 * Before the late_fee_forgiveness table exists, forgiveness can still be
 * recorded as a staff waiver (rent_late_fee_waivers: "waived through" a date),
 * but only when it is whole days from the oldest open day of each week with no
 * partial amounts and no paid day in between. Returns the waiver per week, or
 * why it needs the new table.
 */
export function planAsWaivers(ledger: Ledger, plan: ForgivePlan): { ok: true; waivers: { dueDate: string; waivedThrough: string; days: number }[] } | { ok: false; why: string } {
  const out: { dueDate: string; waivedThrough: string; days: number }[] = [];
  const byWeek = new Map<string, ForgiveAllocation[]>();
  for (const a of plan.allocations) (byWeek.get(a.dueDate) ?? byWeek.set(a.dueDate, []).get(a.dueDate)!).push(a);
  for (const [due, allocs] of byWeek) {
    const week = ledger.weeks.find((w) => w.dueDate === due);
    if (!week) return { ok: false, why: "week not found" };
    const through = allocs.map((a) => a.feeDate).sort().at(-1)!;
    for (const f of week.fees) {
      if (f.feeDate > through) break;
      if (f.status === "waived" || f.status === "paused") continue;
      const a = allocs.find((x) => x.feeId === f.id);
      if (!a) return { ok: false, why: "Forgiving a later day while keeping an earlier one" };
      if (f.paid > 0 || f.forgiven > 0 || Math.abs(a.amount - f.amount) > 0.001) return { ok: false, why: "Forgiving part of a day's fee" };
    }
    out.push({ dueDate: due, waivedThrough: through, days: allocs.length });
  }
  return { ok: true, waivers: out };
}

export function feeStatusLabel(f: LedgerFee): string {
  switch (f.status) {
    case "open": return "Unpaid";
    case "partly_forgiven": return "Partly Forgiven";
    case "forgiven": return "Forgiven";
    case "waived": return "Forgiven";
    case "paid": return "Paid";
    case "paused": return "No Fee (Payment Deal)";
  }
}

export const FORGIVE_REASONS = [
  { value: "goodwill", label: "Goodwill" },
  { value: "payment_arrangement", label: "Payment Arrangement" },
  { value: "billing_error", label: "Billing Error" },
  { value: "hardship", label: "Hardship" },
  { value: "staff_error", label: "Staff Error" },
  { value: "other", label: "Other" },
] as const;

export function forgiveReasonLabel(v: string | null | undefined): string {
  return FORGIVE_REASONS.find((r) => r.value === v)?.label ?? (v ? v : "No Reason");
}
