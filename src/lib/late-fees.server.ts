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
};

export const DEFAULT_LATE_FEE_POLICY: LateFeePolicy = {
  enabled: false,
  grace_days: 3,
  flat_fee: 25,
  daily_fee: 0,
  max_fee: 100,
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

  const chargeableDays = daysLate - policy.grace_days;

  // Compute what the total *should* be today and charge the difference,
  // rather than incrementing. Two things fall out of that: a missed run
  // catches up instead of silently losing a day, and a repeat run in the
  // same day adds nothing because the target has not moved.
  //
  // The base must be the policy, never the amount already charged — that
  // amount already contains the daily component, so using it as the base
  // would compound the daily fee every run.
  let target = policy.flat_fee + policy.daily_fee * chargeableDays;

  if (policy.max_fee > 0) target = Math.min(target, policy.max_fee);

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
};

export async function applyLateFees(today?: string): Promise<LateFeeRun> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const todayStr = today ?? new Date().toISOString().slice(0, 10);

  const { data: setting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "late_fee_policy")
    .maybeSingle();
  const policy = normalizePolicy(setting?.value);

  const run: LateFeeRun = {
    examined: 0,
    charged: 0,
    totalAdded: 0,
    skipped: 0,
    errors: 0,
    policyEnabled: policy.enabled,
  };
  if (!policy.enabled) return run;

  const { data: overdue } = await supabaseAdmin
    .from("payments")
    .select("id,driver_id,amount,balance_due,late_fees,due_date,status,late_fee_applied_through")
    .lt("due_date", todayStr)
    .in("status", ["pending", "overdue", "past_due", "unpaid"])
    .limit(500);

  for (const p of overdue ?? []) {
    run.examined++;
    try {
      const owed = Number(p.balance_due ?? 0) || Number(p.amount ?? 0);
      if (owed <= 0) {
        run.skipped++;
        continue;
      }

      const result = computeLateFee({
        policy,
        dueDate: p.due_date as string,
        today: todayStr,
        alreadyCharged: Number(p.late_fees ?? 0),
        appliedThrough: (p.late_fee_applied_through as string | null) ?? null,
      });

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

      const { error } = await supabaseAdmin
        .from("payments")
        .update({
          late_fees: newFees,
          balance_due: newBalance,
          status: "overdue",
          late_fee_applied_through: result.appliedThrough,
        })
        .eq("id", p.id);
      if (error) throw new Error(error.message);

      run.charged++;
      run.totalAdded = round2(run.totalAdded + result.addition);
    } catch (e) {
      run.errors++;
      console.error("[late-fees] failed for payment", p.id, e);
    }
  }

  return run;
}
