// Late fees on overdue rent.
//
// The policy lives in app_settings so an operator can change it without a
// deploy, and it ships disabled — charging people money is not something to
// turn on by accident.
//
// Fees are assessed per day and recorded against payments.late_fee_applied_through,
// so re-running the sweep (or running it twice in a day) never charges the
// same day twice.

export type LateFeePolicy = {
  enabled: boolean;
  /** Days after the due date before anything is charged. */
  grace_days: number;
  /** One-off fee the first time a payment goes late. */
  flat_fee: number;
  /** Additional fee per day late, after the grace period. */
  daily_fee: number;
  /** Ceiling on total late fees for a single payment. 0 means no cap. */
  max_fee: number;
  /** Only rent is charged late fees (not tolls, damage or other charges). */
  rent_only: boolean;
};

export const DEFAULT_LATE_FEE_POLICY: LateFeePolicy = {
  enabled: false,
  grace_days: 3,
  flat_fee: 25,
  daily_fee: 0,
  max_fee: 100,
  rent_only: false,
};

export function normalizePolicy(raw: unknown): LateFeePolicy {
  const v = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    enabled: v.enabled === true,
    grace_days: Math.floor(num(v.grace_days, DEFAULT_LATE_FEE_POLICY.grace_days)),
    flat_fee: num(v.flat_fee, DEFAULT_LATE_FEE_POLICY.flat_fee),
    daily_fee: num(v.daily_fee, DEFAULT_LATE_FEE_POLICY.daily_fee),
    max_fee: num(v.max_fee, DEFAULT_LATE_FEE_POLICY.max_fee),
    rent_only: v.rent_only === true,
  };
}

/** Whole days from `from` to `to`, floored at zero. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export type FeeComputation = {
  /** Fee to add on this run. Zero means nothing to do. */
  addition: number;
  /** New value for late_fee_applied_through. */
  appliedThrough: string;
  reason: string;
};

/**
 * Work out what to add to a payment's late fees today.
 *
 * `alreadyCharged` is what the payment has accrued so far, and
 * `appliedThrough` is the last date assessed — both are what make this
 * idempotent across repeated runs.
 */
export function computeLateFee(args: {
  policy: LateFeePolicy;
  dueDate: string;
  today: string;
  alreadyCharged: number;
  appliedThrough: string | null;
  /** Late days that carry no fee (staff waivers, approved payment deals). */
  excludedDays?: number;
  /** Dollars staff forgave on this payment's week (late_fee_forgiveness), taken off after the cap. */
  forgivenAmount?: number;
}): FeeComputation {
  const { policy, dueDate, today, alreadyCharged, appliedThrough } = args;
  const none = { addition: 0, appliedThrough: appliedThrough ?? dueDate, reason: "" };

  if (!policy.enabled) return { ...none, reason: "policy disabled" };

  const daysLate = daysBetween(dueDate, today);
  if (daysLate <= policy.grace_days) return { ...none, reason: "within grace period" };

  // Already assessed through today (or later) — nothing to add.
  if (appliedThrough && daysBetween(appliedThrough, today) <= 0) {
    return { ...none, reason: "already assessed today" };
  }

  const chargeableDays = Math.max(0, daysLate - policy.grace_days - Math.max(0, Math.floor(args.excludedDays ?? 0)));

  // Compute what the total *should* be today and charge the difference,
  // rather than incrementing. Two things fall out of that: a missed run
  // catches up instead of silently losing a day, and a repeat run in the
  // same day adds nothing because the target has not moved.
  //
  // The base must be the policy, never the amount already charged — that
  // amount already contains the daily component, so using it as the base
  // would compound the daily fee every run.
  let target = chargeableDays > 0 ? policy.flat_fee + policy.daily_fee * chargeableDays : 0;

  if (policy.max_fee > 0) target = Math.min(target, policy.max_fee);
  // Forgiven fees stay forgiven: the target drops by what staff forgave, so
  // the next run never adds a forgiven fee back.
  target = Math.max(0, round2(target - Math.max(0, Number(args.forgivenAmount ?? 0) || 0)));

  const addition = Math.max(0, round2(target - alreadyCharged));
  if (addition === 0) {
    return { ...none, appliedThrough: today, reason: "at cap or nothing further due" };
  }

  return {
    addition,
    appliedThrough: today,
    reason: `${daysLate} days late (${chargeableDays} chargeable)`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LateFeeRun = {
  examined: number;
  charged: number;
  totalAdded: number;
  skipped: number;
  errors: number;
  policyEnabled: boolean;
  /** Payments skipped because the renter is in an approved payment deal. */
  pausedDeal?: number;
  /** Per payment, what was (or with dryRun would be) added. */
  details?: { payment_id: string; rental_id: string | null; due_date: string; addition: number; reason: string }[];
};

const ET = "America/New_York";
/** Today's date in Eastern time (fees are by the Eastern calendar day). */
export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(now);
}
const etDay = (iso: unknown): string | null => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? easternToday(new Date(t)) : null;
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export type DealWindow = { from: string; through: string };
/**
 * Approved payment deals (D33-D36): while a deal is open no new late fees
 * accrue. Two sources: payment_text_pauses (FLEET's pause endpoint) and the
 * deal pauses recorded before that existed, as rent_reminder_log rows with
 * outcome "skipped:paused_deal" whose detail reads "Paused through YYYY-MM-DD".
 */
export async function dealWindows(admin: any, rentalIds: string[]): Promise<Map<string, DealWindow[]>> {
  const out = new Map<string, DealWindow[]>();
  if (!rentalIds.length) return out;
  const push = (id: string, w: DealWindow) => { if (w.from && w.through && w.from <= w.through) (out.get(id) ?? out.set(id, []).get(id)!).push(w); };
  const pauses = await admin.from("payment_text_pauses").select("rental_id,starts_at,created_at,pause_until,cancelled_at").in("rental_id", rentalIds);
  if (!pauses.error) for (const p of (pauses.data ?? []) as any[]) {
    if (p.cancelled_at) continue;
    push(p.rental_id, { from: etDay(p.starts_at ?? p.created_at)!, through: etDay(p.pause_until)! });
  }
  const logs = await admin.from("rent_reminder_log").select("rental_id,outcome,detail,created_at").in("rental_id", rentalIds).eq("outcome", "skipped:paused_deal");
  if (!logs.error) for (const l of (logs.data ?? []) as any[]) {
    const m = /Paused through (\d{4}-\d{2}-\d{2})/i.exec(String(l.detail ?? ""));
    if (m) push(l.rental_id, { from: etDay(l.created_at)!, through: m[1] });
  }
  return out;
}

/** Late days (due+1 .. today) inside a waiver or a deal window. */
export function excludedLateDays(args: { dueDate: string; today: string; waivers: { due_date: string; waived_through: string | null }[]; deals: DealWindow[] }): { days: number; wholeWeekWaived: boolean } {
  const { dueDate, today } = args;
  const mine = args.waivers.filter((w) => String(w.due_date).slice(0, 10) === dueDate);
  if (mine.some((w) => w.waived_through == null)) return { days: daysBetween(dueDate, today), wholeWeekWaived: true };
  let days = 0;
  for (let d = addDays(dueDate, 1); d <= today; d = addDays(d, 1)) {
    const waived = mine.some((w) => w.waived_through && d <= String(w.waived_through).slice(0, 10));
    const deal = args.deals.some((w) => d >= w.from && d <= w.through);
    if (waived || deal) days++;
  }
  return { days, wholeWeekWaived: false };
}

export async function applyLateFees(today?: string, opts: { admin?: any; now?: Date; dryRun?: boolean; policy?: LateFeePolicy } = {}): Promise<LateFeeRun> {
  const supabaseAdmin = opts.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const todayStr = today ?? easternToday(opts.now ?? new Date());

  let policy = opts.policy;
  if (!policy) {
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "late_fee_policy")
      .maybeSingle();
    policy = normalizePolicy(setting?.value);
  }

  const run: LateFeeRun = {
    examined: 0,
    charged: 0,
    totalAdded: 0,
    skipped: 0,
    errors: 0,
    policyEnabled: policy.enabled,
    pausedDeal: 0,
    details: [],
  };
  if (!policy.enabled) return run;

  const { data: overdue } = await supabaseAdmin
    .from("payments")
    .select("id,driver_id,rental_id,type,amount,balance_due,late_fees,due_date,status,late_fee_applied_through")
    .lt("due_date", todayStr)
    // Not "pending": a charge Stripe is still processing (or has not confirmed) must not be
    // reopened as owed, or a second attempt could start while the first may have collected.
    .in("status", ["failed", "overdue", "past_due", "unpaid", "late", "current"])
    .limit(500);

  const rows = ((overdue ?? []) as any[]).filter((p) => !policy!.rent_only || String(p.type ?? "rent").toLowerCase() === "rent");
  const rentalIds = [...new Set(rows.map((p) => p.rental_id).filter(Boolean))] as string[];
  // Context per rental: waivers, approved deals, and when the car came back.
  const [waiverRes, deals, returnsRes, rentalsRes] = rentalIds.length
    ? await Promise.all([
        supabaseAdmin.from("rent_late_fee_waivers").select("rental_id,due_date,waived_through").in("rental_id", rentalIds),
        dealWindows(supabaseAdmin, rentalIds),
        supabaseAdmin.from("return_checklists").select("rental_id,returned_at").in("rental_id", rentalIds),
        supabaseAdmin.from("rentals").select("id,status,end_date").in("id", rentalIds),
      ])
    : [{ data: [] }, new Map<string, DealWindow[]>(), { data: [] }, { data: [] }];
  // Staff forgiveness (Manage Late Fees). Absent until its migration is applied: then nothing is subtracted.
  const forgivenBy = new Map<string, number>();
  if (rentalIds.length) {
    const fr = await supabaseAdmin.from("late_fee_forgiveness").select("rental_id,due_date,amount,undone_at").in("rental_id", rentalIds);
    for (const f of (fr?.error ? [] : fr?.data ?? []) as any[]) {
      if (f.undone_at || !(Number(f.amount) > 0)) continue;
      const k = `${f.rental_id}|${String(f.due_date).slice(0, 10)}`;
      forgivenBy.set(k, round2((forgivenBy.get(k) ?? 0) + Number(f.amount)));
    }
  }
  const waiversBy = new Map<string, any[]>();
  for (const w of (waiverRes.error ? [] : waiverRes.data ?? []) as any[]) (waiversBy.get(w.rental_id) ?? waiversBy.set(w.rental_id, []).get(w.rental_id)!).push(w);
  // Late fees stop once the car is back at the shop (D33).
  const stopBy = new Map<string, string>();
  for (const r of (returnsRes.error ? [] : returnsRes.data ?? []) as any[]) {
    const d = etDay(r.returned_at);
    if (d && (!stopBy.has(r.rental_id) || d < stopBy.get(r.rental_id)!)) stopBy.set(r.rental_id, d);
  }
  for (const r of (rentalsRes.error ? [] : rentalsRes.data ?? []) as any[]) {
    if (String(r.status) !== "active" && !stopBy.has(r.id)) stopBy.set(r.id, String(r.end_date ?? todayStr).slice(0, 10));
  }

  for (const p of rows) {
    run.examined++;
    try {
      const owed = Number(p.balance_due ?? 0) || Number(p.amount ?? 0);
      if (owed <= 0) {
        run.skipped++;
        continue;
      }
      const rentalDeals = p.rental_id ? deals.get(p.rental_id) ?? [] : [];
      if (rentalDeals.some((w) => todayStr >= w.from && todayStr <= w.through)) {
        // In an approved deal right now: nothing accrues, nothing is written.
        run.skipped++;
        run.pausedDeal = (run.pausedDeal ?? 0) + 1;
        run.details!.push({ payment_id: p.id, rental_id: p.rental_id ?? null, due_date: p.due_date, addition: 0, reason: "approved payment deal open" });
        continue;
      }
      const stop = p.rental_id ? stopBy.get(p.rental_id) : undefined;
      const asOf = stop && stop < todayStr ? stop : todayStr;
      const excluded = excludedLateDays({ dueDate: p.due_date, today: asOf, waivers: p.rental_id ? waiversBy.get(p.rental_id) ?? [] : [], deals: rentalDeals });

      const result = computeLateFee({
        policy,
        dueDate: p.due_date as string,
        today: asOf,
        alreadyCharged: Number(p.late_fees ?? 0),
        appliedThrough: (p.late_fee_applied_through as string | null) ?? null,
        excludedDays: excluded.days,
        forgivenAmount: p.rental_id ? forgivenBy.get(`${p.rental_id}|${String(p.due_date).slice(0, 10)}`) ?? 0 : 0,
      });
      run.details!.push({ payment_id: p.id, rental_id: p.rental_id ?? null, due_date: p.due_date, addition: result.addition, reason: excluded.wholeWeekWaived ? "week waived" : asOf !== todayStr ? `${result.reason || "nothing due"} (car returned ${asOf})` : result.reason });
      if (opts.dryRun) {
        if (result.addition > 0) { run.charged++; run.totalAdded = round2(run.totalAdded + result.addition); } else run.skipped++;
        continue;
      }

      if (result.addition <= 0) {
        run.skipped++;
        // Still move the marker forward so a capped payment is not re-examined
        // in full every single day.
        if (result.appliedThrough !== p.late_fee_applied_through) {
          await supabaseAdmin
            .from("payments")
            .update({ late_fee_applied_through: result.appliedThrough })
            .eq("id", p.id);
        }
        continue;
      }

      const newFees = round2(Number(p.late_fees ?? 0) + result.addition);
      const newBalance = round2(Number(p.balance_due ?? p.amount ?? 0) + result.addition);

      const { data: updated, error } = await supabaseAdmin
        .from("payments")
        .update({
          late_fees: newFees,
          balance_due: newBalance,
          status: "overdue",
          late_fee_applied_through: result.appliedThrough,
        })
        .eq("id", p.id)
        .eq("status", p.status)
        .select("id");
      if (error) throw new Error(error.message);
      if (!updated?.length) {
        run.skipped++;
        continue;
      }

      run.charged++;
      run.totalAdded = round2(run.totalAdded + result.addition);
    } catch (e) {
      run.errors++;
      console.error("[late-fees] failed for payment", p.id, e);
    }
  }

  return run;
}
