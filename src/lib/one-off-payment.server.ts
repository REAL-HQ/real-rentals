// Records a paid one-off Stripe payment (Payment Link, Dashboard Checkout,
// manual charge) against exactly one rental, or flags it for staff. Called
// from checkout.session.completed, charge.succeeded and payment_intent.succeeded;
// every call reads the same Stripe objects, so the three events agree and the
// first one to arrive writes the row (unique payment-intent index). Read-only
// against Stripe.
import { easternDateOf } from "@/lib/rent-reminders";
import { stripeId } from "@/lib/stripe-unmatched";
import {
  allocateRentPayment,
  appOwnsPayment,
  exactILike,
  nextDueAfter,
  oneOffIdentity,
  oneOffRowType,
  pickRental,
  rentWeekFor,
  unmatchedBody,
  UNMATCHED_TITLE,
  type OneOffIdentity,
  type OpenRentRow,
  type RentAllocation,
  type RentalCandidate,
} from "@/lib/one-off-payment";

type Admin = any;
type StripeLike = any;

export type OneOffOutcome =
  | { status: "skipped"; why: "app_owned" | "already_recorded" | "not_paid" | "no_intent" }
  | { status: "recorded"; rentalId: string; by: MatchBy; inserted: boolean }
  | { status: "unmatched"; why: "no_match" | "ambiguous"; identity: OneOffIdentity };

const RENTAL_COLS = "id, application_id, vehicle_id, status, stripe_customer_id, weekly_rate, next_payment_due, payment_status";
// Rows in Collections ('collections') are left to the Collections tab: payments_apply_to_collections
// settles their lines, so a one-off link never voids or re-dates them here.
const OPEN_RENT = ["failed", "overdue", "past_due", "late", "unpaid", "current"];

type MatchBy = "metadata" | "lead" | "customer" | "email" | "plate";

function must<T extends { error: any }>(res: T): T {
  if (res?.error && res.error.code !== "23505") throw new Error(res.error.message);
  return res;
}

async function rows<T = any>(q: any): Promise<T[]> {
  const res = must(await q);
  return Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
}

/** Stripe objects for one intent. Errors throw so Stripe retries the event. */
async function loadStripeObjects(stripe: StripeLike, piId: string, given: { session?: any; charge?: any; paymentIntent?: any }) {
  const paymentIntent = given.paymentIntent?.id === piId && given.paymentIntent?.status
    ? given.paymentIntent
    : await stripe.paymentIntents.retrieve(piId);
  let session = given.session ?? null;
  if (!session) {
    const list = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
    session = list?.data?.[0] ?? null;
  }
  let charge = given.charge ?? null;
  const latest = stripeId(paymentIntent?.latest_charge);
  if (!charge && latest) charge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : await stripe.charges.retrieve(latest);
  let invoiceLinked = false;
  if (!session && stripe.invoicePayments?.list) {
    const ip = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: piId }, limit: 1 });
    invoiceLinked = (ip?.data?.length ?? 0) > 0;
  }
  // The Payment Link itself: its metadata (renter, plate, date, lead_id,
  // rental_id) never reaches the charge, and staff may add to it after the
  // session was created. A failed read only loses this extra source.
  let paymentLink: any = null;
  const plinkId = stripeId(session?.payment_link);
  if (plinkId && stripe.paymentLinks?.retrieve) {
    try {
      paymentLink = await stripe.paymentLinks.retrieve(plinkId);
    } catch {
      paymentLink = null;
    }
  }
  return { paymentIntent, session, charge, invoiceLinked, paymentLink };
}

async function matchRental(admin: Admin, id: OneOffIdentity): Promise<{ rental: RentalCandidate | null; by: MatchBy | null; ambiguous: boolean }> {
  if (id.rentalId) {
    const found = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).eq("id", id.rentalId));
    const pick = pickRental(found, { explicit: true });
    if (pick.rental) return { rental: pick.rental, by: "metadata", ambiguous: false };
  }
  // Lead / application id on the link (lead_id): that renter's one active rental.
  if (id.applicationIds.length) {
    const candidates = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("application_id", id.applicationIds));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "lead", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  if (id.customerIds.length) {
    const candidates: RentalCandidate[] = [];
    candidates.push(...await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("stripe_customer_id", id.customerIds)));
    const apps = await rows<{ id: string }>(admin.from("applications").select("id").in("stripe_customer_id", id.customerIds));
    if (apps.length) candidates.push(...await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("application_id", apps.map((a) => a.id))));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "customer", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  for (const email of id.emails) {
    const apps = await rows<{ id: string }>(admin.from("applications").select("id").ilike("email", exactILike(email)));
    if (!apps.length) continue;
    const candidates = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("application_id", apps.map((a) => a.id)));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "email", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  // Last: the plate on the link (FLEET's daily links carry plate). Only the one
  // active rental on that car counts.
  for (const plate of id.plates) {
    const cars = await rows<{ id: string }>(admin.from("vehicles").select("id").ilike("license_plate", exactILike(plate)));
    if (!cars.length) continue;
    const candidates = await rows<RentalCandidate>(admin.from("rentals").select(RENTAL_COLS).in("vehicle_id", cars.map((c) => c.id)));
    const pick = pickRental(candidates, { explicit: false });
    if (pick.rental) return { rental: pick.rental, by: "plate", ambiguous: false };
    if (pick.ambiguous) return { rental: null, by: null, ambiguous: true };
  }
  return { rental: null, by: null, ambiguous: false };
}

/** One staff notice per intent, however many of the three events arrive. */
async function flagUnmatched(admin: Admin, id: OneOffIdentity, why: "no_match" | "ambiguous", warn?: (pi: any) => Promise<void>) {
  try {
    if (warn) await warn({ id: id.paymentIntentId, customer: id.customerIds[0] ?? null, amount: id.amountCents });
  } catch { /* a log line never fails the event */ }
  try {
    const prior = await admin.from("notifications").select("id").eq("title", UNMATCHED_TITLE).ilike("body", `%${exactILike(id.paymentIntentId)}%`).limit(1);
    if (prior?.data?.length) return;
    await admin.from("notifications").insert({ driver_id: null, title: UNMATCHED_TITLE, body: unmatchedBody(id, why), kind: "payment", read: false });
  } catch (err) {
    console.error("[one-off-payment] staff notice failed", err);
  }
}

export async function recordOneOffPayment(
  admin: Admin,
  stripe: StripeLike,
  input: { paymentIntentId: string | null; session?: any; charge?: any; paymentIntent?: any },
  opts: { warn?: (pi: any) => Promise<void> } = {},
): Promise<OneOffOutcome> {
  const piId = input.paymentIntentId;
  if (!piId) return { status: "skipped", why: "no_intent" };
  // Cheap checks before any Stripe read.
  if (appOwnsPayment({ session: input.session, paymentIntent: input.paymentIntent, charge: input.charge })) return { status: "skipped", why: "app_owned" };
  if (input.session && input.session.payment_status !== "paid") return { status: "skipped", why: "not_paid" };
  const existing = await rows(admin.from("payments").select("id").eq("stripe_payment_intent_id", piId).limit(1));
  if (existing.length) return { status: "skipped", why: "already_recorded" };

  const objs = await loadStripeObjects(stripe, piId, input);
  if (objs.paymentIntent?.status !== "succeeded") return { status: "skipped", why: "not_paid" };
  if (appOwnsPayment(objs)) return { status: "skipped", why: "app_owned" };
  // metadata.rentalId on the intent is the existing intent path's job. A
  // snake_case rental_id (what FLEET puts on Payment Links) is recorded here:
  // the intent path never read it, so it used to be dropped.
  const piRental = objs.paymentIntent?.metadata?.rentalId;
  if (piRental) return { status: "skipped", why: "app_owned" };

  const id = oneOffIdentity(objs);
  if (!id || id.amountCents <= 0) return { status: "skipped", why: "not_paid" };
  const match = await matchRental(admin, id);
  if (!match.rental || !match.by) {
    const why = match.ambiguous ? "ambiguous" : "no_match";
    await flagUnmatched(admin, id, why, opts.warn);
    return { status: "unmatched", why, identity: id };
  }
  const r = match.rental;
  const amount = id.amountCents / 100;
  const day = id.paidAt ? easternDateOf(id.paidAt) : easternDateOf(Math.floor(Date.now() / 1000));
  const rowType = oneOffRowType(id.reason, { activeRental: r.status === "active" });
  // Rent lands on the week it pays for, so Due/Overdue/Late all read it as paid.
  let dueOn = day;
  let openRows: OpenRentRow[] = [];
  let onDailyPlan = false;
  let allocations: RentAllocation[] = [];
  if (rowType === "rent") {
    const { loadDailyRentPlans } = await import("@/lib/daily-rent-plans.server");
    const { activeDailyPlan } = await import("@/lib/rent-standing");
    onDailyPlan = !!activeDailyPlan((await loadDailyRentPlans(admin)).get(r.id) ?? null, day);
    try {
      openRows = await rows(admin.from("payments").select("id, due_date, amount, balance_due, late_fees, stripe_invoice_id, status").eq("rental_id", r.id).eq("type", "rent")
        .in("status", OPEN_RENT));
    } catch {
      openRows = [];
    }
    dueOn = rentWeekFor(day, openRows.map((o) => String(o.due_date ?? "").slice(0, 10)).filter(Boolean), { dailyPlan: onDailyPlan, forDate: id.forDate });
    if (!onDailyPlan) {
      allocations = allocateRentPayment({
        amount, paidOn: day, weeklyRate: Number((r as any).weekly_rate ?? 0), openRows,
        weeks: id.weeks, nextPaymentDue: (r as any).next_payment_due ?? null,
      });
      if (allocations.length) dueOn = allocations[0].dueDate;
    }
  }
  const purpose = id.purpose ?? (rowType === "rent" && id.forDate ? `Rent for ${id.forDate}` : null);
  const via = [id.paymentLinkId && `payment link ${id.paymentLinkId}`, id.sessionId && `checkout ${id.sessionId}`].filter(Boolean).join(", ");
  const ins = must(await admin.from("payments").insert({
    rental_id: r.id,
    driver_id: r.application_id ?? null,
    vehicle_id: r.vehicle_id ?? null,
    type: rowType,
    reason: (purpose ?? id.reason ?? "Stripe payment").slice(0, 200),
    amount,
    balance_due: 0,
    status: "paid",
    due_date: dueOn,
    paid_date: day,
    payment_method: id.cardPayment ? "card" : null,
    stripe_payment_intent_id: id.paymentIntentId,
    stripe_charge_id: id.chargeId,
    stripe_customer_id: id.customerIds[0] ?? r.stripe_customer_id ?? null,
    stripe_paid_at: id.paidAt ? new Date(id.paidAt * 1000).toISOString() : null,
    stripe_receipt_url: id.receiptUrl,
    // Stripe already emailed its own receipt; the app sends none for these.
    notified_status: "paid",
    notes: `Recorded from Stripe${via ? ` (${via})` : ""}; matched by ${match.by}.`,
  }).select("id"));
  const inserted = (ins.data?.length ?? 0) > 0; // 0 when another event won the unique index
  if (inserted) {
    await admin.from("notifications").insert({
      driver_id: null, title: "Payment Received", kind: "payment", read: false,
      body: `$${amount.toFixed(2)} — ${(purpose ?? "Stripe payment").slice(0, 120)}${id.renterName ? ` (${id.renterName.slice(0, 60)})` : ""}`,
    }).then(() => {}, () => {});
  }
  if (inserted && rowType === "rent" && !onDailyPlan && allocations.length) {
    const rowId = ins.data?.[0]?.id ?? null;
    await settleAllocatedRent(admin, { rental: r, allocations, paymentRowId: rowId, piId: id.paymentIntentId, via, day, amount });
  }
  return { status: "recorded", rentalId: r.id, by: match.by, inserted };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * After a rent payment is recorded once (on the charge's own row), settle the
 * weeks it paid. Open rent rows it paid in full close as void (the money is on
 * the charge row, so collected and revenue count it once) unless late fees
 * remain: then the row stays open owing only those fees (balance_due = fees),
 * where Manage Late Fees can still forgive them. A week paid in part keeps
 * its row with the rest owed. next_payment_due moves past the last week paid
 * in full and payment_status reads current once nothing older is owed. Every
 * write is guarded on the status read, so a sweep or staff edit in between is
 * never overwritten. Sends nothing to the renter and never writes Stripe.
 */
export async function settleAllocatedRent(
  admin: Admin,
  input: { rental: any; allocations: RentAllocation[]; paymentRowId: string | null; piId: string; via: string; day: string; amount: number },
): Promise<{ closed: string[]; feesLeft: string[]; partial: string[]; nextDue: string | null }> {
  const { rental, allocations, paymentRowId, piId, via, day } = input;
  const out = { closed: [] as string[], feesLeft: [] as string[], partial: [] as string[], nextDue: null as string | null };
  const paidBy = `${paymentRowId ? `row ${paymentRowId}, ` : ""}${piId}${via ? `, ${via}` : ""}`;
  const weeksPaid = allocations.filter((a) => a.paidInFull).map((a) => a.dueDate);
  // A whole-week staff waiver (waived through: null) means the week carries no late fee.
  let wholeWeekWaived = new Set<string>();
  try {
    const w = await admin.from("rent_late_fee_waivers").select("due_date, waived_through").eq("rental_id", rental.id);
    if (!w?.error) wholeWeekWaived = new Set(((w?.data ?? []) as any[]).filter((x) => x.waived_through == null).map((x) => String(x.due_date).slice(0, 10)));
  } catch { /* no waivers read: fees stay as recorded */ }
  for (const a of allocations) {
    const row = a.row;
    if (!row) continue;
    const fees = wholeWeekWaived.has(a.dueDate) ? 0 : a.lateFees;
    const note = (what: string) => `${String((row as any).notes ?? "").trim()} ${what}`.trim().slice(0, 1000);
    try {
      if (a.paidInFull && fees <= 0) {
        const u = await admin.from("payments").update({
          status: "void", balance_due: 0, late_fees: 0,
          notes: note(`Rent paid ${day} by ${money(input.amount)} Stripe payment (${paidBy}) for weeks ${weeksPaid.join(", ")}; closed as void so the payment is counted once.`),
        }).eq("id", row.id).eq("status", row.status).select("id");
        if (!u?.error && u?.data?.length) out.closed.push(row.id);
      } else if (a.paidInFull) {
        const u = await admin.from("payments").update({
          balance_due: fees,
          notes: note(`Rent paid ${day} by Stripe payment (${paidBy}); ${money(fees)} late fees still owed.`),
        }).eq("id", row.id).eq("status", row.status).select("id");
        if (!u?.error && u?.data?.length) out.feesLeft.push(row.id);
      } else {
        const left = Math.round((a.rentOwed - a.applied + fees) * 100) / 100;
        const u = await admin.from("payments").update({
          balance_due: left,
          notes: note(`${money(a.applied)} rent paid ${day} by Stripe payment (${paidBy}); ${money(left)} still owed.`),
        }).eq("id", row.id).eq("status", row.status).select("id");
        if (!u?.error && u?.data?.length) out.partial.push(row.id);
      }
    } catch (err) {
      console.error("[one-off-payment] settle week failed", a.dueDate, err);
    }
    // The paid week may still have an open Stripe invoice that Stripe will retry.
    if (a.paidInFull && row.stripe_invoice_id) {
      await admin.from("notifications").insert({
        driver_id: null, title: "Open Stripe Invoice After Rent Paid", kind: "payment", read: false,
        body: `${money(a.applied)} rent for the week of ${a.dueDate} was paid by ${via || "Stripe"}, but invoice ${row.stripe_invoice_id} may still be open and Stripe may retry it. Mark it paid out of band in Stripe (do not void it).`,
      }).then(() => {}, () => {});
    }
  }
  try {
    const next = nextDueAfter(rental.next_payment_due ?? null, allocations);
    const patch: Record<string, unknown> = {};
    if (next && next !== (rental.next_payment_due ?? null)) patch.next_payment_due = next;
    const still = await admin.from("payments").select("id, due_date, balance_due, amount, late_fees, status, type").eq("rental_id", rental.id).in("status", OPEN_RENT);
    const owing = ((still?.data ?? []) as any[]).some((p) => p.type !== "deposit" && String(p.due_date ?? "") < day
      && (p.balance_due == null ? Number(p.amount ?? 0) + Number(p.late_fees ?? 0) : Number(p.balance_due)) > 0.004);
    if (!still?.error && !owing && ["past_due", "overdue", "failed", "late"].includes(String(rental.payment_status ?? ""))) patch.payment_status = "current";
    if (Object.keys(patch).length) {
      let q = admin.from("rentals").update(patch).eq("id", rental.id);
      q = rental.next_payment_due == null ? q.is("next_payment_due", null) : q.eq("next_payment_due", rental.next_payment_due);
      const u = await q.select("id");
      if (!u?.error && u?.data?.length && patch.next_payment_due) out.nextDue = String(patch.next_payment_due);
    }
  } catch (err) {
    console.error("[one-off-payment] rental update failed", err);
  }
  return out;
}
