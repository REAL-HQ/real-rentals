import { isReservationRow } from "@/lib/payment-category";
import { stripeFeeCostCents, type OwnerFeeRead, type OwnerFeeTxn } from "@/lib/owner-pnl-fees";
import { decimalSourceCents } from "@/lib/unified-finance-live-mapping";
import { validFinanceDate } from "@/lib/unified-finance";
import {
  OWNER_INCOME_SOURCES,
  buildOwnerPnlMonth,
  categoryLabel,
  currentEtMonth,
  decideCharge,
  etYmd,
  monthWindow,
  paymentSource,
  paymentVehicleId,
  previousMonth,
  shiftFinanceDate,
  spanWindow,
  type OwnerCharge,
  type OwnerIncomeSource,
  type OwnerPaymentLink,
  type OwnerPnlChange,
  type OwnerPnlDirectory,
  type OwnerPnlMonth,
  type OwnerPnlWindow,
  type OwnerRentalLink,
} from "@/lib/owner-pnl";

/**
 * Richer Owner P&L over an Eastern Time range.
 * Income, refunds, expenses, and fees use the same rules as the monthly
 * report. Filters narrow that report. All-time headlines stay the whole
 * company. Stripe fees stay off each car. This module does not call Stripe
 * and does not write.
 */

export const PNL_PRESETS = ["this_month", "last_month", "last_30", "ytd", "all_time", "custom"] as const;
export type PnlPreset = (typeof PNL_PRESETS)[number];

export type PnlFilter = {
  vehicleId?: string | null;
  driverId?: string | null;
  source?: OwnerIncomeSource | null;
  category?: string | null;
};

export type PnlCarRow = {
  id: string;
  label: string;
  revenueCents: number;
  expenseCents: number;
  feesCents: null;
  netCents: number;
  allTimeRevenueCents: number;
  allTimeNetCents: number;
  daysRented: number;
  daysIdle: number;
  utilizationPct: number | null;
  paybackPct: number | null;
};

export type PnlTrendPoint = {
  month: string;
  label: string;
  revenueCents: number | null;
  expenseCents: number | null;
  netCents: number | null;
};

export type PnlUnattributed = {
  date: string;
  amountCents: number;
  source: string;
  reference: string;
};

export type PnlRenterRow = { id: string; name: string; revenueCents: number };

export type PnlReceivables = {
  openCents: number;
  overdueCents: number;
  unpaidCents: number;
  openCount: number;
  overdueCount: number;
  depositsHeldCents: number;
  depositCount: number;
};

export type OwnerPnlView = {
  preset: PnlPreset;
  from: string;
  through: string;
  compareFrom: string | null;
  compareThrough: string | null;
  feesInNet: boolean;
  current: OwnerPnlMonth;
  previous: OwnerPnlMonth | null;
  change: OwnerPnlChange | null;
  allTime: {
    revenueCents: number | null;
    expenseCents: number | null;
    feesCents: number | null;
    netCents: number | null;
  };
  cars: PnlCarRow[];
  trend: PnlTrendPoint[];
  trendCapped: boolean;
  receivables: PnlReceivables;
  unattributed: PnlUnattributed[];
  renters: PnlRenterRow[];
  options: {
    cars: { id: string; label: string }[];
    renters: { id: string; name: string }[];
    sources: { source: OwnerIncomeSource; label: string }[];
    categories: { category: string; label: string }[];
  };
  companyFeesCents: number | null;
  priorCompanyFeesCents: number | null;
  notes: string[];
};

const ALL_TIME_FROM = "2019-01-01";
const TREND_CAP = 36;
const RENTED = new Set(["active", "rented", "ended", "completed", "closed", "returned", "finished"]);
const NOT_RENTED = new Set(["cancelled", "canceled", "void", "pending", "reserved", "pending_reservation", "draft"]);
const OWED = new Set(["pending", "current", "late", "overdue", "past_due", "failed", "unpaid"]);
const OVERDUE_STATUS = new Set(["late", "overdue", "past_due", "failed", "unpaid", "collections"]);
const DEPOSIT_RELEASED = new Set(["refunded", "returned", "released", "forfeited"]);

export function resolvePnlRange(input: {
  preset: PnlPreset;
  now: Date;
  from?: string | null;
  through?: string | null;
}): { current: OwnerPnlWindow; previous: OwnerPnlWindow | null; allTime: OwnerPnlWindow; trendFrom: string; trendThrough: string } | null {
  const today = etYmd(input.now);
  if (!today) return null;
  const allTime = spanWindow(ALL_TIME_FROM, today, "all-time");
  if (!allTime) return null;
  const month = currentEtMonth(input.now);
  if (!month) return null;

  let current: OwnerPnlWindow | null = null;
  let previous: OwnerPnlWindow | null = null;
  if (input.preset === "this_month") {
    current = monthWindow(month);
    const prior = previousMonth(month);
    previous = prior ? monthWindow(prior) : null;
  } else if (input.preset === "last_month") {
    const prior = previousMonth(month);
    const before = prior ? previousMonth(prior) : null;
    current = prior ? monthWindow(prior) : null;
    previous = before ? monthWindow(before) : null;
  } else if (input.preset === "last_30") {
    const from = shiftFinanceDate(today, -29);
    current = from ? spanWindow(from, today, "last-30") : null;
    if (current && from) {
      const priorThrough = shiftFinanceDate(from, -1);
      const priorFrom = priorThrough ? shiftFinanceDate(priorThrough, -29) : null;
      previous = priorFrom && priorThrough ? spanWindow(priorFrom, priorThrough, "prior-30") : null;
    }
  } else if (input.preset === "ytd") {
    const from = `${today.slice(0, 4)}-01-01`;
    current = spanWindow(from, today, "ytd");
    const priorFrom = sameDayLastYear(from);
    const priorThrough = sameDayLastYear(today);
    previous = priorFrom && priorThrough ? spanWindow(priorFrom, priorThrough, "prior-ytd") : null;
  } else if (input.preset === "all_time") {
    current = allTime;
    previous = null;
  } else {
    const from = input.from ?? "";
    const through = input.through ?? "";
    if (!validFinanceDate(from) || !validFinanceDate(through) || from > through || through > today) return null;
    current = spanWindow(from, through, "custom");
    if (current) {
      const length = dayCount(from, through);
      const priorThrough = shiftFinanceDate(from, -1);
      const priorFrom = priorThrough ? shiftFinanceDate(priorThrough, -(length - 1)) : null;
      previous = priorFrom && priorThrough ? spanWindow(priorFrom, priorThrough, "prior-custom") : null;
    }
  }
  if (!current) return null;
  const trend = trendSpan(input.preset, current, today);
  return { current, previous, allTime, trendFrom: trend.from, trendThrough: trend.through };
}

export function buildOwnerPnlView(input: {
  directory: OwnerPnlDirectory;
  charges: OwnerCharge[];
  feeTxns: OwnerFeeTxn[] | null;
  range: { preset: PnlPreset; current: OwnerPnlWindow; previous: OwnerPnlWindow | null; allTime: OwnerPnlWindow; trendFrom: string; trendThrough: string };
  filter: PnlFilter;
  today: string;
  revenueKnown: boolean;
  allTimeRevenueKnown: boolean;
  chargesCover?: { gte: number; lt: number } | null;
}): OwnerPnlView | null {
  const filter = {
    vehicleId: input.filter.vehicleId || null,
    driverId: input.filter.driverId || null,
    source: input.filter.source || null,
    category: input.filter.category || null,
  };
  const feesInNet = !filter.vehicleId && !filter.driverId && !filter.category && (!filter.source || filter.source === "stripe");
  const narrowed = narrowDirectory(input.directory, filter);
  const charges = chargesFor(input.charges, input.directory, filter);
  const sources = filter.source ? [filter.source] : null;
  const categories = filter.category ? [filter.category] : null;
  const feeFor = (window: OwnerPnlWindow, apply: boolean): OwnerFeeRead => {
    if (!apply) return { ok: true, feesCents: 0 };
    if (filter.source && filter.source !== "stripe") return { ok: true, feesCents: 0 };
    if (!input.feeTxns) return { ok: false };
    return stripeFeeCostCents(input.feeTxns, window);
  };
  const covered = (window: OwnerPnlWindow) => !input.chargesCover || (window.gte >= input.chargesCover.gte && window.gte < input.chargesCover.lt);
  const current = buildOwnerPnlMonth({
    ...narrowed,
    month: input.range.current.month,
    window: input.range.current,
    charges,
    fees: feeFor(input.range.current, feesInNet),
    sources,
    categories,
    revenueKnown: input.revenueKnown && covered(input.range.current),
  });
  if (!current) return null;
  const previous = input.range.previous
    ? buildOwnerPnlMonth({
      ...narrowed,
      month: input.range.previous.month,
      window: input.range.previous,
      charges,
      fees: feeFor(input.range.previous, feesInNet),
      sources,
      categories,
      revenueKnown: input.revenueKnown && covered(input.range.previous),
    })
    : null;
  const allTimeMonth = buildOwnerPnlMonth({
    ...input.directory,
    month: input.range.allTime.month,
    window: input.range.allTime,
    charges: input.charges,
    fees: input.feeTxns ? stripeFeeCostCents(input.feeTxns, input.range.allTime) : { ok: false },
    revenueKnown: input.allTimeRevenueKnown,
  });
  if (!allTimeMonth) return null;
  const companyFeeRead = (window: OwnerPnlWindow): OwnerFeeRead => filter.source && filter.source !== "stripe"
    ? { ok: true, feesCents: 0 }
    : (input.feeTxns ? stripeFeeCostCents(input.feeTxns, window) : { ok: false });
  const companyFees = companyFeeRead(input.range.current);
  const priorCompanyFees = input.range.previous ? companyFeeRead(input.range.previous) : null;

  const lifetime = new Map(allTimeMonth.vehicles.map((row) => [row.id, row]));
  const rangeRows = new Map(current.vehicles.map((row) => [row.id, row]));
  const ids = new Set<string>([...rangeRows.keys(), ...lifetime.keys()]);
  const purchases = new Map((input.directory.purchases ?? []).map((row) => [row.vehicleId, row.priceCents]));
  const spanDays = dayCount(input.range.current.from, input.range.current.through);
  const cars: PnlCarRow[] = [...ids].filter((id) => id && id !== "none").flatMap((id) => {
    if (filter.vehicleId && id !== filter.vehicleId) return [];
    const rangeRow = rangeRows.get(id);
    const life = lifetime.get(id);
    const rented = daysRented(input.directory.rentals, id, input.range.current.from, input.range.current.through);
    const revenue = rangeRow?.incomeCents ?? 0;
    const expense = rangeRow?.expenseCents ?? 0;
    const refund = rangeRow?.refundsCents ?? 0;
    const net = revenue - refund - expense;
    const allRevenue = life?.incomeCents ?? 0;
    const allNet = life?.netCents ?? 0;
    if (!rangeRow && !life && rented === 0) return [];
    const price = purchases.get(id) ?? null;
    return [{
      id,
      label: rangeRow?.label || life?.label || "Vehicle",
      revenueCents: revenue,
      expenseCents: expense,
      feesCents: null,
      netCents: net,
      allTimeRevenueCents: allRevenue,
      allTimeNetCents: allNet,
      daysRented: rented,
      daysIdle: Math.max(0, spanDays - rented),
      utilizationPct: spanDays > 0 ? Math.round((rented / spanDays) * 1000) / 10 : null,
      paybackPct: price && price > 0 ? Math.round((allNet / price) * 1000) / 10 : null,
    }];
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const trendMonths = monthsFrom(input.range.trendFrom, input.range.trendThrough).slice(-TREND_CAP);
  const trend = trendMonths.map((month) => {
    const window = monthWindow(month);
    const built = window
      ? buildOwnerPnlMonth({
        ...narrowed,
        month,
        window,
        charges,
        fees: feeFor(window, feesInNet),
        sources,
        categories,
        revenueKnown: input.revenueKnown && covered(window),
      })
      : null;
    return {
      month,
      label: monthLabel(month),
      revenueCents: built?.revenueCents ?? null,
      expenseCents: built?.expenseCents ?? null,
      netCents: built?.netCents ?? null,
    };
  });

  const names = new Map((input.directory.people ?? []).map((person) => [person.driverId, person.name.trim() || "Renter"]));
  const renters = renterRevenue(narrowed, charges, input.range.current, sources, names);
  const unattributed = unattributedRows(narrowed, charges, input.range.current, sources);
  const receivables = receivablesSnapshot(input.directory, filter, input.today);
  const notes = [
    ...(current.notes),
    ...(previous?.notes ?? []),
    "Stripe fees are a company cost. They are not split by car, so each car net is revenue minus refunds minus expenses.",
    "All-time totals are the whole company and ignore the filters.",
  ];
  if (!feesInNet) notes.push("A car, renter, or category filter is on, so this net does not subtract company Stripe fees.");
  if (filter.source && filter.source !== "stripe") notes.push("This source is not Stripe, so Stripe fees are left out of the range.");
  if (!input.allTimeRevenueKnown) notes.push("All-time Stripe charges did not finish loading, so all-time revenue is blank.");

  return {
    preset: input.range.preset,
    from: input.range.current.from,
    through: input.range.current.through,
    compareFrom: input.range.previous?.from ?? null,
    compareThrough: input.range.previous?.through ?? null,
    feesInNet,
    current,
    previous,
    change: previous
      ? {
        revenueCents: delta(current.revenueCents, previous.revenueCents),
        unattributedRevenueCents: delta(current.unattributedRevenueCents, previous.unattributedRevenueCents),
        depositsExcludedCents: delta(current.depositsExcludedCents, previous.depositsExcludedCents),
        depositRefundsExcludedCents: delta(current.depositRefundsExcludedCents, previous.depositRefundsExcludedCents),
        refundsCents: delta(current.refundsCents, previous.refundsCents),
        expenseCents: delta(current.expenseCents, previous.expenseCents),
        feesCents: delta(current.feesCents, previous.feesCents),
        netCents: delta(current.netCents, previous.netCents),
      }
      : null,
    allTime: {
      revenueCents: allTimeMonth.revenueCents,
      expenseCents: allTimeMonth.expenseCents,
      feesCents: allTimeMonth.feesCents,
      netCents: allTimeMonth.netCents,
    },
    cars,
    trend,
    trendCapped: monthsFrom(input.range.trendFrom, input.range.trendThrough).length > TREND_CAP,
    receivables,
    unattributed,
    renters,
    options: {
      cars: (input.directory.vehicles ?? []).map((vehicle) => ({ id: vehicle.id, label: carLabel(vehicle) })).sort((a, b) => a.label.localeCompare(b.label)),
      renters: [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      sources: OWNER_INCOME_SOURCES.map((row) => ({ source: row.source, label: row.label })),
      categories: categoryOptions(input.directory),
    },
    companyFeesCents: companyFees.ok ? companyFees.feesCents : null,
    priorCompanyFeesCents: priorCompanyFees ? (priorCompanyFees.ok ? priorCompanyFees.feesCents : null) : null,
    notes: [...new Set(notes)],
  };
}

export function ownerPnlViewCsv(view: OwnerPnlView): string {
  const lines: string[][] = [
    ["Range", view.from, view.through],
    ["Compared With", view.compareFrom ?? "", view.compareThrough ?? ""],
    ["All-Time Revenue", centsText(view.allTime.revenueCents)],
    ["All-Time Expenses", centsText(view.allTime.expenseCents)],
    ["All-Time Fees", centsText(view.allTime.feesCents)],
    ["All-Time Net", centsText(view.allTime.netCents)],
    [],
    ["Line", "This Range", "Prior Range", "Change"],
    ["Revenue", centsText(view.current.revenueCents), centsText(view.previous?.revenueCents ?? null), centsText(view.change?.revenueCents ?? null)],
    ["Refunds", centsText(view.current.refundsCents), centsText(view.previous?.refundsCents ?? null), centsText(view.change?.refundsCents ?? null)],
    ["Expenses", centsText(view.current.expenseCents), centsText(view.previous?.expenseCents ?? null), centsText(view.change?.expenseCents ?? null)],
    ["Fees", view.companyFeesCents === null ? "Unavailable" : centsText(view.companyFeesCents), view.priorCompanyFeesCents === null ? "" : centsText(view.priorCompanyFeesCents), view.companyFeesCents === null || view.priorCompanyFeesCents === null ? "" : centsText(view.companyFeesCents - view.priorCompanyFeesCents)],
    ["Net", netText(view.current), view.previous ? netText(view.previous) : "", centsText(view.change?.netCents ?? null)],
    [],
    ["Source", "This Range"],
    ...view.current.sources.map((row) => [row.label, centsText(row.cents)]),
    [],
    ["Category", "This Range"],
    ...view.current.expenses.map((row) => [row.label, centsText(row.cents)]),
    [],
    ["Car", "Revenue", "Expenses", "Fees", "Net", "All-Time Revenue", "All-Time Net", "Days Rented", "Days Idle", "Utilization", "Payback"],
    ...view.cars.map((row) => [
      row.label, centsText(row.revenueCents), centsText(row.expenseCents), "", centsText(row.netCents),
      centsText(row.allTimeRevenueCents), centsText(row.allTimeNetCents),
      String(row.daysRented), String(row.daysIdle),
      row.utilizationPct === null ? "" : String(row.utilizationPct),
      row.paybackPct === null ? "" : String(row.paybackPct),
    ]),
    [],
    ["Renter", "Revenue"],
    ...view.renters.map((row) => [row.name, centsText(row.revenueCents)]),
    [],
    ["Open", centsText(view.receivables.openCents)],
    ["Overdue", centsText(view.receivables.overdueCents)],
    ["Unpaid", centsText(view.receivables.unpaidCents)],
    ["Deposits Held", centsText(view.receivables.depositsHeldCents)],
    [],
    ["Unattributed Date", "Amount", "Source", "Reference"],
    ...view.unattributed.map((row) => [row.date, centsText(row.amountCents), row.source, row.reference]),
    [],
    ["Month", "Revenue", "Expenses", "Net"],
    ...view.trend.map((row) => [row.month, centsText(row.revenueCents), centsText(row.expenseCents), centsText(row.netCents)]),
  ];
  return lines.map((line) => line.map((cell) => csvField(String(cell ?? ""))).join(",")).join("\n");
}

function narrowDirectory(directory: OwnerPnlDirectory, filter: PnlFilter): OwnerPnlDirectory {
  if (!filter.vehicleId && !filter.driverId) return directory;
  const rentals = directory.rentals.filter((rental) => (
    (!filter.vehicleId || rental.vehicleId === filter.vehicleId)
    && (!filter.driverId || rental.driverId === filter.driverId)
  ));
  const vehicleIds = new Set(rentals.map((rental) => rental.vehicleId).filter((id): id is string => !!id));
  if (filter.vehicleId) vehicleIds.add(filter.vehicleId);
  const payments = directory.payments.filter((payment) => {
    const vehicle = paymentVehicleId(payment, directory.rentals);
    const driver = driverOf(payment, directory.rentals);
    if (filter.vehicleId && vehicle !== filter.vehicleId) return false;
    if (filter.driverId && driver !== filter.driverId) return false;
    return true;
  });
  const paymentIds = new Set(payments.map((payment) => payment.id));
  return {
    ...directory,
    rentals,
    payments,
    refunds: directory.refunds.filter((refund) => refund.paymentIds.every((id) => paymentIds.has(id))),
    expenses: directory.expenses.filter((expense) => !!expense.vehicleId && vehicleIds.has(expense.vehicleId)),
    maintenance: directory.maintenance.filter((record) => !!record.vehicleId && vehicleIds.has(record.vehicleId)),
    vehicles: (directory.vehicles ?? []).filter((vehicle) => !filter.vehicleId || vehicle.id === filter.vehicleId),
  };
}

function chargesFor(charges: OwnerCharge[], directory: OwnerPnlDirectory, filter: PnlFilter): OwnerCharge[] {
  if (!filter.vehicleId && !filter.driverId) return charges;
  return charges.filter((charge) => {
    const decision = decideCharge(charge, directory.payments, directory.rentals);
    if (decision.kind !== "vehicle") return false;
    if (filter.vehicleId && decision.vehicleId !== filter.vehicleId) return false;
    if (filter.driverId && driverOfCharge(charge, directory) !== filter.driverId) return false;
    return true;
  });
}

function driverOf(payment: OwnerPaymentLink, rentals: OwnerRentalLink[]): string | null {
  if (payment.driverId) return payment.driverId;
  if (!payment.rentalId) return null;
  return rentals.find((rental) => rental.id === payment.rentalId)?.driverId ?? null;
}

function driverOfCharge(charge: OwnerCharge, directory: OwnerPnlDirectory): string | null {
  const named = (charge.paymentIds ?? []).map((id) => directory.payments.find((payment) => payment.id === id)).filter((payment): payment is OwnerPaymentLink => !!payment);
  const hits = named.length
    ? named
    : directory.payments.filter((payment) => (
      (charge.paymentIntentId && payment.paymentIntentId === charge.paymentIntentId)
      || (charge.invoiceId && payment.invoiceId === charge.invoiceId)
      || (charge.subscriptionId && payment.subscriptionId === charge.subscriptionId)
    ));
  const drivers = new Set(hits.map((payment) => driverOf(payment, directory.rentals)).filter((id): id is string => !!id));
  if (drivers.size === 1) return [...drivers][0]!;
  if (charge.subscriptionId) {
    const rows = directory.rentals.filter((rental) => rental.subscriptionId === charge.subscriptionId && rental.driverId);
    const ids = new Set(rows.map((rental) => rental.driverId as string));
    if (ids.size === 1) return [...ids][0]!;
  }
  if (charge.customerId) {
    const rows = directory.rentals.filter((rental) => rental.customerId === charge.customerId && rental.driverId);
    const ids = new Set(rows.map((rental) => rental.driverId as string));
    if (ids.size === 1) return [...ids][0]!;
  }
  return null;
}

function renterRevenue(
  directory: OwnerPnlDirectory,
  charges: OwnerCharge[],
  window: OwnerPnlWindow,
  sources: OwnerIncomeSource[] | null,
  names: Map<string, string>,
): PnlRenterRow[] {
  const built = buildOwnerPnlMonth({ ...directory, month: window.month, window, charges, sources, fees: { ok: true, feesCents: 0 } });
  if (!built || built.revenueCents === null) return [];
  const totals = new Map<string, number>();
  const allow = sources ? new Set(sources) : null;
  const add = (driverId: string | null, cents: number) => {
    const key = driverId || "none";
    const next = (totals.get(key) ?? 0) + cents;
    if (Number.isSafeInteger(next)) totals.set(key, next);
  };
  for (const charge of charges) {
    if (!charge.succeeded || charge.currency !== "usd" || charge.created < window.gte || charge.created >= window.lt) continue;
    if (allow && !allow.has("stripe")) continue;
    const decision = decideCharge(charge, directory.payments, directory.rentals);
    if (decision.kind !== "vehicle") continue;
    add(driverOfCharge(charge, directory), charge.amountCents);
  }
  for (const payment of directory.payments) {
    const status = (payment.status ?? "").trim().toLowerCase();
    if (status !== "paid" && status !== "refunded") continue;
    const type = (payment.type ?? "").trim().toLowerCase();
    if (type === "deposit") continue;
    const source = paymentSource(payment);
    if (allow && !allow.has(source)) continue;
    if (source === "stripe") continue;
    const day = (payment.paidDate ?? "").slice(0, 10);
    if (!validFinanceDate(day) || day < window.from || day >= window.to) continue;
    const matched = charges.some((charge) => charge.succeeded && (
      (payment.paymentIntentId && (payment.paymentIntentId === charge.paymentIntentId || payment.paymentIntentId === charge.id))
      || (payment.invoiceId && (payment.invoiceId === charge.invoiceId || payment.invoiceId === charge.id))
      || (charge.paymentIds ?? []).includes(payment.id)
    ));
    if (matched) continue;
    const cents = decimalSourceCents(payment.amount ?? null);
    if (cents === null) continue;
    add(driverOf(payment, directory.rentals), cents);
  }
  return [...totals.entries()].map(([id, revenueCents]) => ({
    id,
    name: id === "none" ? "No Renter" : (names.get(id) || "Renter"),
    revenueCents,
  })).filter((row) => row.revenueCents !== 0).sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

function unattributedRows(
  directory: OwnerPnlDirectory,
  charges: OwnerCharge[],
  window: OwnerPnlWindow,
  sources: OwnerIncomeSource[] | null,
): PnlUnattributed[] {
  const allow = sources ? new Set(sources) : null;
  const rows: PnlUnattributed[] = [];
  const seen = new Set<string>();
  for (const charge of charges) {
    if (!charge.succeeded || charge.currency !== "usd" || charge.created < window.gte || charge.created >= window.lt) continue;
    if (allow && !allow.has("stripe")) continue;
    const decision = decideCharge(charge, directory.payments, directory.rentals);
    if (decision.kind !== "unattributed") continue;
    const date = etYmd(new Date(charge.created * 1000));
    if (!date) continue;
    const reference = charge.paymentIntentId || charge.invoiceId || charge.id;
    seen.add(reference);
    seen.add(charge.id);
    rows.push({ date, amountCents: charge.amountCents, source: "Stripe", reference });
  }
  for (const payment of directory.payments) {
    const status = (payment.status ?? "").trim().toLowerCase();
    if (status !== "paid" && status !== "refunded") continue;
    if ((payment.type ?? "").trim().toLowerCase() === "deposit") continue;
    const vehicle = paymentVehicleId(payment, directory.rentals);
    const driver = driverOf(payment, directory.rentals);
    if (vehicle || driver) continue;
    const source = paymentSource(payment);
    if (allow && !allow.has(source)) continue;
    const day = (payment.paidDate ?? "").slice(0, 10);
    if (!validFinanceDate(day) || day < window.from || day >= window.to) continue;
    const reference = payment.paymentIntentId || payment.invoiceId || payment.id;
    if ([reference, payment.paymentIntentId, payment.invoiceId].some((value) => value && seen.has(value))) continue;
    const cents = decimalSourceCents(payment.amount ?? null);
    if (cents === null) continue;
    const label = OWNER_INCOME_SOURCES.find((row) => row.source === source)?.label ?? "Other";
    rows.push({ date: day, amountCents: cents, source: label, reference });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.amountCents - a.amountCents || a.reference.localeCompare(b.reference));
}

function receivablesSnapshot(directory: OwnerPnlDirectory, filter: PnlFilter, today: string): PnlReceivables {
  let openCents = 0;
  let overdueCents = 0;
  let openCount = 0;
  let overdueCount = 0;
  for (const payment of directory.payments) {
    if (isReservationRow(payment)) continue;
    const type = (payment.type ?? "").trim().toLowerCase();
    if (type === "deposit") continue;
    const status = (payment.status ?? "").trim().toLowerCase();
    if (!OWED.has(status) && !OVERDUE_STATUS.has(status)) continue;
    const vehicle = paymentVehicleId(payment, directory.rentals);
    const driver = driverOf(payment, directory.rentals);
    if (filter.vehicleId && vehicle !== filter.vehicleId) continue;
    if (filter.driverId && driver !== filter.driverId) continue;
    const cents = owedCents(payment);
    if (cents === null || cents <= 0) continue;
    const due = (payment.dueDate ?? "").slice(0, 10);
    const overdue = OVERDUE_STATUS.has(status) || (validFinanceDate(due) && due < today);
    if (overdue) {
      overdueCents += cents;
      overdueCount += 1;
    } else {
      openCents += cents;
      openCount += 1;
    }
  }
  let depositsHeldCents = 0;
  let depositCount = 0;
  for (const rental of directory.rentals) {
    if (!rental.depositHeld) continue;
    if (filter.vehicleId && rental.vehicleId !== filter.vehicleId) continue;
    if (filter.driverId && rental.driverId !== filter.driverId) continue;
    const status = (rental.depositStatus ?? "").trim().toLowerCase();
    if (DEPOSIT_RELEASED.has(status)) continue;
    const amount = decimalSourceCents(rental.depositAmount ?? null) ?? 0;
    const refunded = decimalSourceCents(rental.depositRefundAmount ?? null) ?? 0;
    const held = amount - refunded;
    if (!Number.isSafeInteger(held) || held <= 0) continue;
    depositsHeldCents += held;
    depositCount += 1;
  }
  return {
    openCents, overdueCents, unpaidCents: openCents + overdueCents, openCount, overdueCount, depositsHeldCents, depositCount,
  };
}

function daysRented(rentals: OwnerRentalLink[], vehicleId: string, from: string, through: string): number {
  const days = new Set<string>();
  for (const rental of rentals) {
    if (rental.vehicleId !== vehicleId) continue;
    const status = (rental.status ?? "").trim().toLowerCase();
    if (NOT_RENTED.has(status) || (status && !RENTED.has(status))) continue;
    const start = (rental.startDate ?? "").slice(0, 10);
    if (!validFinanceDate(start)) continue;
    let end = (rental.endDate ?? "").slice(0, 10);
    if (!validFinanceDate(end)) {
      if (status === "active" || status === "rented") end = through;
      else continue;
    }
    const left = start > from ? start : from;
    const right = end < through ? end : through;
    if (left > right) continue;
    for (let day = left; day && day <= right;) {
      days.add(day);
      if (day === right) break;
      const next = shiftFinanceDate(day, 1);
      if (!next || next <= day) break;
      day = next;
    }
  }
  return days.size;
}

function owedCents(payment: OwnerPaymentLink): number | null {
  const balance = payment.balanceDue === null || payment.balanceDue === undefined || payment.balanceDue === ""
    ? null
    : decimalSourceCents(payment.balanceDue);
  if (balance !== null) return balance;
  return decimalSourceCents(payment.amount ?? null);
}

function categoryOptions(directory: OwnerPnlDirectory): { category: string; label: string }[] {
  const keys = new Set<string>();
  for (const expense of directory.expenses) keys.add(expense.category?.trim() || "other");
  for (const record of directory.maintenance) keys.add(record.category?.trim() || "other");
  return [...keys].map((category) => ({ category, label: categoryLabel(category) })).sort((a, b) => a.label.localeCompare(b.label));
}

function carLabel(vehicle: { year: number | null; make: string | null; model: string | null; licensePlate: string | null }): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  return [name, vehicle.licensePlate?.trim()].filter(Boolean).join(" · ") || "Vehicle";
}

function trendSpan(preset: PnlPreset, current: OwnerPnlWindow, today: string): { from: string; through: string } {
  if (preset === "all_time" || preset === "ytd" || preset === "custom") return { from: current.from, through: current.through };
  const end = current.through < today ? current.through : today;
  const startMonth = shiftMonths(end.slice(0, 7), -11);
  return { from: `${startMonth}-01`, through: end };
}

function monthsFrom(from: string, through: string): string[] {
  const months: string[] = [];
  let cursor = from.slice(0, 7);
  const end = through.slice(0, 7);
  while (cursor <= end && months.length < 240) {
    months.push(cursor);
    const next = shiftMonths(cursor, 1);
    if (next <= cursor) break;
    cursor = next;
  }
  return months;
}

function shiftMonths(month: string, deltaMonths: number): string {
  const [year, mon] = month.split("-").map(Number);
  const index = year! * 12 + (mon! - 1) + deltaMonths;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
}

function sameDayLastYear(ymd: string): string | null {
  const [year, month, day] = ymd.split("-").map(Number);
  const candidate = `${year! - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (validFinanceDate(candidate)) return candidate;
  return shiftFinanceDate(`${year! - 1}-${String(month).padStart(2, "0")}-01`, 27);
}

function dayCount(from: string, through: string): number {
  const [year, month, day] = from.split("-").map(Number);
  const [year2, month2, day2] = through.split("-").map(Number);
  return Math.round((Date.UTC(year2!, month2! - 1, day2!) - Date.UTC(year!, month! - 1, day!)) / 86400000) + 1;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon) return month;
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  const value = current - previous;
  return Number.isSafeInteger(value) ? value : null;
}

function centsText(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function netText(month: OwnerPnlMonth): string {
  if (!month.feesComplete && month.revenueComplete && month.expensesComplete && month.refundsComplete) return "Partial";
  return centsText(month.netCents);
}

function csvField(value: string): string {
  const numeric = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !numeric && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
