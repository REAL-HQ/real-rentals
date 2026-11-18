/**
 * The rich Payment Received page body (pure: props in, no data reads). The
 * data comes from payment-received.server.ts through PaymentReceivedLive.
 * Names no insurance broker or carrier, and never says "deposit".
 */
import { useState, type ReactNode } from "react";
import { CalendarCheck, CheckCircle2, MessageSquare, Phone } from "lucide-react";
import {
  cardBrandLabel,
  COMPANY_EMAIL,
  COMPANY_PHONE_DISPLAY,
  COMPANY_PHONE_E164,
  fmtDay,
  fmtPaidDate,
  fmtTime,
  money,
  slotsByDay,
  vehicleLabel,
  type BookedPickup,
  type BookPickupResult,
  type PaymentReceivedView,
  type PickupBookingState,
} from "@/lib/payment-received";
import type { PickupSlot } from "@/lib/pickup-schedule";

type OkView = Extract<PaymentReceivedView, { ok: true }>;

export const INSURANCE_PICKUP_NOTE = "Your pickup is confirmed once your insurance is approved. We'll text you if anything changes.";
export const PREFERRED_PICKUP_CONFIRM_NOTE = "We'll confirm this time once your insurance is finalized.";
export const REFUND_LINE = "Refundable If We Can't Get You On The Road.";

function pickupWhen(p: { date: string; time: string }): string {
  return `${fmtDay(p.date) ?? p.date} at ${fmtTime(p.time)} ET`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-[#E6E6EA] first-of-type:border-t-0">
      <span className="flex-1 text-[13px] text-[#55555E]">{label}</span>
      <span className="text-right text-[13px] font-semibold text-[#111114]">{children}</span>
    </div>
  );
}

function Box({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[10px] border border-[#EDEDF0] bg-[#F6F6F8] px-4 pt-4 pb-3.5 text-left">
      <h2 id={id} className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8A8A93]">{title}</h2>
      {children}
    </section>
  );
}

function CallUs({ title, body }: { title: string; body: string }) {
  return (
    <div data-testid="pickup-call-us" className="rounded-[10px] border border-[#EDEDF0] bg-white p-4 text-left">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-[#D03020]" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-[#111114]">{title}</h3>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#55555E]">
        {body} Questions?{" "}
        <a className="font-medium text-[#D03020]" href={`tel:${COMPANY_PHONE_E164}`}>{COMPANY_PHONE_DISPLAY}</a>
      </p>
    </div>
  );
}

function Booked({ pickup }: { pickup: BookedPickup }) {
  return (
    <div data-testid="pickup-booked" className="rounded-[10px] border border-[#BFE8C8] bg-[#F0FBF2] p-4 text-left">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-[#157A2A]" aria-hidden="true" />
        <h3 className="text-[15px] font-semibold text-[#157A2A]">Preferred Pickup Time</h3>
      </div>
      <p className="mt-1.5 text-[15px] font-semibold text-[#111114]">{pickupWhen(pickup)}</p>
      {pickup.location ? <p className="mt-0.5 text-[13px] text-[#55555E]">{pickup.location}</p> : null}
      <p className="mt-2 text-[13px] leading-relaxed text-[#28282E]">{PREFERRED_PICKUP_CONFIRM_NOTE}</p>
    </div>
  );
}

export function SlotPicker({
  slots,
  location,
  busy,
  error,
  onBook,
}: {
  slots: PickupSlot[];
  location: string | null;
  busy: boolean;
  error: string | null;
  onBook: (slot: PickupSlot) => void;
}) {
  const days = slotsByDay(slots);
  const [dayIdx, setDayIdx] = useState(0);
  const [picked, setPicked] = useState<PickupSlot | null>(null);
  const day = days[Math.min(dayIdx, days.length - 1)];
  return (
    <div data-testid="pickup-picker" className="text-left">
      {error ? (
        <p role="alert" data-testid="pickup-error" className="mb-3 rounded-md border border-[#F1D38A] bg-[#FFF8E1] px-3 py-2 text-[13px] text-[#6B5200]">{error}</p>
      ) : null}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Pickup Day">
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            role="tab"
            aria-selected={i === dayIdx}
            onClick={() => { setDayIdx(i); setPicked(null); }}
            className={`shrink-0 rounded-lg border px-3 py-2 text-[13px] font-semibold ${i === dayIdx ? "border-[#D03020] bg-[#FFF6F5] text-[#D03020]" : "border-[#E2E2E7] bg-white text-[#28282E]"}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      {day ? (
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Pickup Times On ${day.label}`}>
          {day.slots.map((s) => {
            const on = picked?.start_at === s.start_at;
            return (
              <button
                key={s.start_at}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(s)}
                className={`rounded-lg border py-2.5 text-[14px] font-semibold ${on ? "border-[#D03020] bg-[#D03020] text-white" : "border-[#E2E2E7] bg-white text-[#111114]"}`}
              >
                {fmtTime(s.time)}
              </button>
            );
          })}
        </div>
      ) : null}
      {location ? <p className="mt-3 text-[12px] text-[#55555E]">Pickup At {location}</p> : null}
      <button
        type="button"
        data-testid="pickup-book"
        disabled={!picked || busy}
        onClick={() => picked && onBook(picked)}
        className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-[#D03020] bg-[#D03020] px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Booking…" : picked ? `Book ${pickupWhen(picked)}` : "Pick A Time Above"}
      </button>
      <p className="mt-2.5 text-[13px] leading-relaxed text-[#28282E]">{INSURANCE_PICKUP_NOTE}</p>
    </div>
  );
}

/** Pickup section: booked, picker, or a friendly "we'll call you". */
export function PickupSection({ booking, onBook }: { booking: PickupBookingState; onBook?: (startAt: string) => Promise<BookPickupResult> }) {
  const [state, setState] = useState<PickupBookingState>(booking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const book = async (slot: PickupSlot) => {
    if (!onBook) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onBook(slot.start_at);
      if (r.ok) {
        setState({ state: "reserved", pickup: r.pickup });
      } else if (r.code === "slot_taken" || r.code === "bad_slot") {
        setError(r.message);
        if (r.slots && r.slots.length && state.state === "pick") setState({ state: "pick", slots: r.slots, location: state.location });
      } else if (r.code === "no_slots") {
        setState({ state: "no_slots" });
      } else if (r.code === "no_vehicle") {
        setState({ state: "no_vehicle" });
      } else {
        setError(r.message);
        if (r.code === "unavailable" || r.code === "invalid_session") setState({ state: "unavailable" });
      }
    } catch {
      setError("Something went wrong. Please try again, or text or call us.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="pickup-heading" className="mt-5 text-left">
      <h2 id="pickup-heading" className="mb-3 text-[15px] font-semibold text-[#111114]">{state.state === "pick" ? "Pick Your Pickup Time" : state.state === "reserved" ? "Preferred Pickup Time" : "Your Pickup Time"}</h2>
      {state.state === "reserved" ? (
        <Booked pickup={state.pickup} />
      ) : state.state === "pick" ? (
        <SlotPicker key={state.slots.map((s) => s.start_at).join(",")} slots={state.slots} location={state.location} busy={busy} error={error} onBook={book} />
      ) : state.state === "no_vehicle" ? (
        <CallUs title="We'll Call You To Schedule" body="Your car is still being assigned. We'll call you within 1 business day to set your pickup time." />
      ) : state.state === "no_slots" ? (
        <CallUs title="We'll Call You To Schedule" body="No pickup times are open online right now. We'll call you within 1 business day to set your pickup time." />
      ) : (
        <CallUs title="We'll Call You To Schedule" body="We'll call you within 1 business day to set your pickup time." />
      )}
    </section>
  );
}

export function PaymentReceivedDetails({ view, onBook }: { view: OkView; onBook?: (startAt: string) => Promise<BookPickupResult> }) {
  const { receipt, rental, booking } = view;
  const car = vehicleLabel(rental.vehicle);
  const paidOn = fmtPaidDate(receipt.paidAt);
  const start = fmtDay(rental.startDate);
  const steps: { title: string; body: string }[] = [
    { title: "We Confirm Your Insurance", body: "We'll text you once it's approved. That confirms your pickup time." },
    { title: "Reminder Text Before Pickup", body: "We text you a reminder before your pickup with the time and address." },
    { title: "Pickup Day", body: "Bring your driver's license. Your first week's balance, minus the $50, is charged to your card on file." },
  ];
  return (
    <div data-testid="reservation-fee-return-paid-rich" className="rounded-xl border border-[#EDEDF0] bg-white px-6 pt-8 pb-7 md:px-9 md:pt-10 md:pb-8">
      <div className="mb-6 text-center">
        <CheckCircle2 className="mx-auto h-11 w-11 text-[#4CD964]" aria-hidden="true" />
        <h1 className="mt-3 text-2xl md:text-[28px] font-semibold tracking-tight text-[#111114]">You're Reserved!</h1>
        <p className="mt-2 text-[15px] leading-snug text-[#55555E]">
          Payment received.
          <br />
          {car ? "Your car is being held for you." : "Your spot is reserved."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <Box title="Your Receipt" id="receipt-heading">
          <Row label="Reservation Fee">{money(receipt.amount)}</Row>
          {paidOn ? <Row label="Date">{paidOn}</Row> : null}
          {receipt.cardLast4 ? <Row label="Card">{`${cardBrandLabel(receipt.cardBrand)} •••• ${receipt.cardLast4}`}</Row> : null}
          {receipt.receiptUrl ? (
            <Row label="Receipt">
              <a data-testid="stripe-receipt-link" className="text-[#D03020]" href={receipt.receiptUrl} target="_blank" rel="noopener noreferrer">View Receipt</a>
            </Row>
          ) : null}
          <p className="mt-2.5 rounded-md bg-[#F0FBF2] px-2.5 py-2 text-xs leading-snug text-[#157A2A]">Applied in full to your first week's rent.</p>
        </Box>
        <Box title="Your Rental" id="rental-heading">
          {car ? <p className="mb-2 text-base font-semibold text-[#111114]">{car}</p> : <p className="mb-2 text-sm text-[#55555E]">Your car is being assigned.</p>}
          {rental.weeklyRate ? <Row label="Weekly Rate">{`$${Number.isInteger(rental.weeklyRate) ? rental.weeklyRate : rental.weeklyRate.toFixed(2)}/wk`}</Row> : null}
          {start ? <Row label="Start Date">{start}</Row> : null}
          {rental.market ? <Row label="Market">{rental.market}</Row> : null}
        </Box>
      </div>

      <PickupSection booking={booking} onBook={onBook} />

      <section aria-labelledby="next-heading" className="mt-6 text-left">
        <h2 id="next-heading" className="mb-3 text-[15px] font-semibold text-[#111114]">What Happens Next</h2>
        {steps.map((s, i) => (
          <div key={s.title} className={`flex gap-3 py-2.5 ${i ? "border-t border-[#EDEDF0]" : ""}`}>
            <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#D03020] text-[13px] font-bold text-white">{i + 1}</div>
            <div>
              <h3 className="text-sm font-semibold leading-tight text-[#111114]">{s.title}</h3>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[#55555E]">{s.body}</p>
            </div>
          </div>
        ))}
      </section>

      <p data-testid="refund-line" className="mt-4 rounded-[10px] border border-[#F4C7C2] bg-[#FFF6F5] px-3.5 py-3 text-left text-[13px] leading-relaxed text-[#28282E]">{REFUND_LINE}</p>

      <a
        data-testid="text-us"
        href={`sms:${COMPANY_PHONE_E164}`}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#D03020] bg-white px-5 py-3 text-[15px] font-semibold text-[#D03020] no-underline"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" /> Text Us
      </a>

      <p className="mt-5 text-center text-[13px] leading-normal text-[#55555E]">
        Questions?{" "}
        <a className="font-medium text-[#D03020]" href={`tel:${COMPANY_PHONE_E164}`}>{COMPANY_PHONE_DISPLAY}</a>
        {" · "}
        <a className="font-medium text-[#D03020]" href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a>
      </p>
    </div>
  );
}
