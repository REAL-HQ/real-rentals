/**
 * Read-only deposits and refunds ledger. Held, returned, applied to damages,
 * applied to tolls, and outstanding, per renter and vehicle.
 * A deposit is never revenue. This module does not call Stripe or the database.
 */

export type DepositPayment = {
  id: string;
  driverId: string | null;
  vehicleId: string | null;
  rentalId: string | null;
  type: string | null;
  status: string | null;
  amount: string | number | null;
  refundedAmount: string | number | null;
  paymentIntentId: string | null;
};
export type DepositRefund = {
  id: string;
  amount: string | number | null;
  status: string | null;
  paymentIds: string[];
  stripeRefundId: string | null;
  stripeChargeId: string | null;
  paymentIntentId: string | null;
};
export type DepositDeduction = {
  id: string;
  rentalId: string;
  amount: string | number | null;
  incidentId: string | null;
  tollChargeId: string | null;
};
export type DepositRental = {
  id: string;
  driverId: string;
  vehicleId: string;
  depositAmount: string | number | null;
  depositHeld: boolean | null;
};
export type DepositPerson = { id: string; fullName: string };
export type DepositVehicle = { id: string; year: number | null; make: string | null; model: string | null; licensePlate: string | null; unitNumber: string | null };
export type DepositStripeRefund = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  chargeId: string | null;
  paymentIntentId: string | null;
};

export type DepositGroup = {
  id: string;
  renter: string;
  vehicle: string;
  heldCents: number | null;
  returnedCents: number | null;
  damagesCents: number | null;
  tollsCents: number | null;
  outstandingCents: number | null;
};
export type StripeDifference = {
  id: string;
  kind: "Amount Differs" | "Not On Stripe" | "Not In The Ledger" | "Not USD";
  appCents: number | null;
  stripeCents: number | null;
};
export type DepositsRefundsReport = {
  groups: DepositGroup[];
  totals: Omit<DepositGroup, "id" | "renter" | "vehicle">;
  stripeCheck: "complete" | "unavailable";
  differences: StripeDifference[];
  notes: string[];
};

/** No revenue field: a deposit is a liability, never income. */
export type DepositsRefundsResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; report: null; reason: string }
  | { status: "ready"; report: DepositsRefundsReport };

const COLLECTED = new Set(["paid", "refunded"]);

export function buildDepositsRefundsLedger(input: {
  payments: DepositPayment[];
  refunds: DepositRefund[];
  deductions: DepositDeduction[];
  rentals: DepositRental[];
  people: DepositPerson[];
  vehicles: DepositVehicle[];
  stripe: { ok: true; refunds: DepositStripeRefund[] } | { ok: false };
}): DepositsRefundsReport {
  const rentals = new Map(input.rentals.map((row) => [row.id, row]));
  const people = new Map(input.people.map((row) => [row.id, row.fullName]));
  const vehicles = new Map(input.vehicles.map((row) => [row.id, vehicleLabel(row)]));
  const notes: string[] = [];
  const groups = new Map<string, MutableGroup>();

  const place = (driverId: string | null, vehicleId: string | null): MutableGroup => {
    const key = `${driverId ?? ""}|${vehicleId ?? ""}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created: MutableGroup = {
      id: key || "none",
      renter: (driverId && people.get(driverId)) || "Renter Not Listed",
      vehicle: (vehicleId && vehicles.get(vehicleId)) || "Vehicle Not Listed",
      held: 0,
      returned: 0,
      damages: 0,
      tolls: 0,
      heldOk: true,
      returnedOk: true,
      damagesOk: true,
      tollsOk: true,
    };
    groups.set(key, created);
    return created;
  };

  const depositPayments = input.payments.filter((payment) => (payment.type ?? "").trim().toLowerCase() === "deposit");
  const depositIds = new Set(depositPayments.map((payment) => payment.id));
  const rentalsWithDepositPayment = new Set(depositPayments.map((payment) => payment.rentalId).filter((id): id is string => !!id));

  for (const payment of depositPayments) {
    const rental = payment.rentalId ? rentals.get(payment.rentalId) : undefined;
    const group = place(payment.driverId ?? rental?.driverId ?? null, payment.vehicleId ?? rental?.vehicleId ?? null);
    const status = (payment.status ?? "").trim().toLowerCase();
    if (!COLLECTED.has(status)) continue;
    const cents = moneyCents(payment.amount);
    if (cents === "bad") { group.heldOk = false; continue; }
    if (cents === null) { group.heldOk = false; continue; }
    group.held += cents;
  }

  for (const rental of input.rentals) {
    if (rental.depositHeld !== true || rentalsWithDepositPayment.has(rental.id)) continue;
    const group = place(rental.driverId, rental.vehicleId);
    const cents = moneyCents(rental.depositAmount);
    if (cents === "bad" || cents === null) { group.heldOk = false; continue; }
    group.held += cents;
  }

  const refundsByPayment = new Map<string, DepositRefund[]>();
  for (const refund of input.refunds) {
    for (const id of refund.paymentIds) {
      const rows = refundsByPayment.get(id) ?? [];
      rows.push(refund);
      refundsByPayment.set(id, rows);
    }
  }

  for (const refund of input.refunds) {
    const status = (refund.status ?? "").trim().toLowerCase();
    if (status === "pending" || status === "failed" || status === "canceled" || status === "cancelled") continue;
    const linked = refund.paymentIds.map((id) => input.payments.find((payment) => payment.id === id) ?? null);
    if (!linked.length || linked.some((payment) => !payment)) { notes.push("A refund could not be tied to a payment."); continue; }
    const depositLinks = linked.filter((payment) => payment && depositIds.has(payment.id));
    if (!depositLinks.length) continue;
    if (depositLinks.length !== linked.length) { notes.push("A refund mixes a deposit with another payment."); continue; }
    if (status !== "succeeded") {
      for (const payment of depositLinks) if (payment) place(payment.driverId, payment.vehicleId).returnedOk = false;
      continue;
    }
    const cents = moneyCents(refund.amount);
    const share = linked.length === 1 ? cents : "bad";
    for (const payment of depositLinks) {
      if (!payment) continue;
      const rental = payment.rentalId ? rentals.get(payment.rentalId) : undefined;
      const group = place(payment.driverId ?? rental?.driverId ?? null, payment.vehicleId ?? rental?.vehicleId ?? null);
      if (share === "bad" || share === null) group.returnedOk = false;
      else group.returned += share;
    }
  }

  for (const payment of depositPayments) {
    if ((refundsByPayment.get(payment.id) ?? []).some((refund) => (refund.status ?? "").trim().toLowerCase() === "succeeded")) continue;
    const refunded = moneyCents(payment.refundedAmount);
    if (refunded === null || refunded === 0) continue;
    const rental = payment.rentalId ? rentals.get(payment.rentalId) : undefined;
    const group = place(payment.driverId ?? rental?.driverId ?? null, payment.vehicleId ?? rental?.vehicleId ?? null);
    if (refunded === "bad") group.returnedOk = false;
    else group.returned += refunded;
  }

  for (const deduction of input.deductions) {
    const rental = rentals.get(deduction.rentalId);
    const group = rental ? place(rental.driverId, rental.vehicleId) : place(null, null);
    if (!rental) { group.damagesOk = false; group.tollsOk = false; notes.push("A deposit application has no rental."); continue; }
    const damage = !!deduction.incidentId;
    const toll = !!deduction.tollChargeId;
    if (damage === toll) { group.damagesOk = false; group.tollsOk = false; notes.push("A deposit application is neither a damage nor a toll."); continue; }
    const cents = moneyCents(deduction.amount);
    if (cents === "bad" || cents === null) { if (damage) group.damagesOk = false; else group.tollsOk = false; continue; }
    if (damage) group.damages += cents;
    else group.tolls += cents;
  }

  const rows = [...groups.values()].map(finish).sort((a, b) => a.renter.localeCompare(b.renter) || a.vehicle.localeCompare(b.vehicle) || a.id.localeCompare(b.id));
  const stripe = input.stripe.ok ? reconcile(depositPayments, input.refunds, input.stripe.refunds) : { differences: [] as StripeDifference[] };
  if (!input.stripe.ok) notes.push("Stripe check unavailable");
  return {
    groups: rows,
    totals: {
      heldCents: sum(rows.map((row) => row.heldCents)),
      returnedCents: sum(rows.map((row) => row.returnedCents)),
      damagesCents: sum(rows.map((row) => row.damagesCents)),
      tollsCents: sum(rows.map((row) => row.tollsCents)),
      outstandingCents: sum(rows.map((row) => row.outstandingCents)),
    },
    stripeCheck: input.stripe.ok ? "complete" : "unavailable",
    differences: stripe.differences,
    notes: [...new Set(notes)],
  };
}

type MutableGroup = {
  id: string;
  renter: string;
  vehicle: string;
  held: number;
  returned: number;
  damages: number;
  tolls: number;
  heldOk: boolean;
  returnedOk: boolean;
  damagesOk: boolean;
  tollsOk: boolean;
};

function finish(group: MutableGroup): DepositGroup {
  const heldCents = group.heldOk && Number.isSafeInteger(group.held) ? group.held : null;
  const returnedCents = group.returnedOk && Number.isSafeInteger(group.returned) ? group.returned : null;
  const damagesCents = group.damagesOk && Number.isSafeInteger(group.damages) ? group.damages : null;
  const tollsCents = group.tollsOk && Number.isSafeInteger(group.tolls) ? group.tolls : null;
  const outstanding = heldCents !== null && returnedCents !== null && damagesCents !== null && tollsCents !== null
    ? heldCents - returnedCents - damagesCents - tollsCents
    : null;
  return {
    id: group.id,
    renter: group.renter,
    vehicle: group.vehicle,
    heldCents,
    returnedCents,
    damagesCents,
    tollsCents,
    outstandingCents: outstanding !== null && Number.isSafeInteger(outstanding) ? outstanding : null,
  };
}

function reconcile(payments: DepositPayment[], refunds: DepositRefund[], stripeRefunds: DepositStripeRefund[]): { differences: StripeDifference[] } {
  const depositIds = new Set(payments.map((payment) => payment.id));
  const depositRefunds = refunds.filter((refund) => refund.paymentIds.some((id) => depositIds.has(id)) && (refund.status ?? "").trim().toLowerCase() === "succeeded");
  const stripeById = new Map(stripeRefunds.map((refund) => [refund.id, refund]));
  const seen = new Set<string>();
  const differences: StripeDifference[] = [];
  for (const refund of depositRefunds) {
    const appCents = moneyCents(refund.amount);
    const stripe = refund.stripeRefundId ? stripeById.get(refund.stripeRefundId) : undefined;
    if (stripe) seen.add(stripe.id);
    if (!refund.stripeRefundId || !stripe) {
      differences.push({ id: refund.id, kind: "Not On Stripe", appCents: appCents === "bad" ? null : appCents, stripeCents: null });
      continue;
    }
    if (stripe.currency !== "usd") {
      differences.push({ id: refund.id, kind: "Not USD", appCents: appCents === "bad" ? null : appCents, stripeCents: null });
      continue;
    }
    if (stripe.status !== "succeeded" || appCents === "bad" || appCents === null || appCents !== stripe.amountCents) {
      differences.push({ id: refund.id, kind: "Amount Differs", appCents: appCents === "bad" ? null : appCents, stripeCents: stripe.amountCents });
    }
  }
  const intents = new Set(payments.map((payment) => payment.paymentIntentId).filter((id): id is string => !!id));
  for (const stripe of stripeRefunds) {
    if (seen.has(stripe.id) || stripe.status !== "succeeded") continue;
    const tied = (stripe.paymentIntentId && intents.has(stripe.paymentIntentId)) || depositRefunds.some((refund) => refund.stripeChargeId && refund.stripeChargeId === stripe.chargeId);
    if (!tied) continue;
    if (stripe.currency !== "usd") differences.push({ id: stripe.id, kind: "Not USD", appCents: null, stripeCents: null });
    else differences.push({ id: stripe.id, kind: "Not In The Ledger", appCents: null, stripeCents: stripe.amountCents });
  }
  return { differences };
}

function sum(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = (values as number[]).reduce((acc, value) => acc + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function moneyCents(value: string | number | null | undefined): number | null | "bad" {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "bad";
  const [dollars, fraction = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : "bad";
}

function vehicleLabel(vehicle: DepositVehicle): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter((part) => part !== null && String(part).trim() !== "").join(" ");
  return [vehicle.unitNumber?.trim() ? `Unit ${vehicle.unitNumber.trim()}` : "", name, vehicle.licensePlate?.trim() ?? ""].filter(Boolean).join(" · ") || "Vehicle Not Listed";
}
