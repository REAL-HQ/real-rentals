import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { convertReservation, getReservationConversion } from "@/lib/reservations.functions";
import type { Reservation } from "@/lib/reservations";

/** Manager-only parent; server and database independently reauthorize every request. */
export function ReservationConversion({ reservation }: { reservation: Reservation }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(""),
    [deposit, setDeposit] = useState("0"),
    [miles, setMiles] = useState("");
  const [held, setHeld] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState(""),
    [rentalId, setRentalId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const read = useServerFn(getReservationConversion),
    convert = useServerFn(convertReservation);
  const query = useQuery({
    queryKey: ["reservation-conversion", reservation.id],
    queryFn: () => read({ data: { id: reservation.id } }),
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const evidence = query.data?.available ? query.data.value : null;
  const linked = rentalId ?? (evidence?.state === "converted" ? evidence.rentalId : null);
  const control = "rounded-md border border-border bg-white px-3 py-2 text-sm disabled:opacity-50";
  async function submit() {
    if (!evidence || busy || uncertain) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await convert({
        data: {
          id: reservation.id,
          version: evidence.version,
          weeklyRate: Number(rate),
          deposit: Number(deposit),
          depositHeld: held,
          pickupMileage: miles ? Number(miles) : null,
        },
      });
      if (result.available) {
        setRentalId(result.value);
        setMessage("Conversion successful.");
        window.location.assign(`/admin?tab=bookings&id=${encodeURIComponent(result.value)}`);
      } else {
        setMessage(result.message);
        setUncertain(true);
      }
    } catch {
      setMessage(
        "Conversion outcome could not be verified. Reload evidence before retrying; do not assume activation failed or succeeded.",
      );
      setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button className={control} onClick={() => setOpen(true)}>
        Convert to Rental
      </button>
    );
  return (
    <section aria-label="Convert reservation to rental" className="space-y-3 rounded-lg border p-4">
      <h4 className="font-semibold">Convert to Rental</h4>
      <p>
        {reservation.applicant_name} · {reservation.vehicle_label}
      </p>
      <p>
        Scheduled pickup:{" "}
        {new Intl.DateTimeFormat("en-US", {
          timeZone: reservation.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(reservation.pickup_at))}{" "}
        ({reservation.timezone})
      </p>
      <p>Status: {evidence?.state ?? reservation.state}</p>
      {query.isPending ? (
        <p>Checking eligibility and readiness…</p>
      ) : query.isError ? (
        <p role="alert">Temporary service unavailable. No conversion attempted.</p>
      ) : !evidence ? (
        <p role="alert">
          {query.data && !query.data.available ? query.data.message : "Readiness unavailable."}
        </p>
      ) : (
        <>
          <p>{evidence.agreement}</p>
          <p>{evidence.payment}</p>
          <p className="text-sm">
            Agreement and payment evidence are informational under existing activation rules. Review
            missing evidence with your Manager. No payment or signature is created here.
          </p>
          {evidence.blockers.length > 0 && !linked ? (
            <ul role="alert">
              {evidence.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            !linked && (
              <p>
                Eligibility and readiness checks passed at review time; conversion rechecks
                allocation and safety atomically.
              </p>
            )
          )}
          {!linked && evidence.state === "confirmed" && evidence.blockers.length === 0 && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label>
                Weekly rate
                <input
                  aria-label="Weekly rate"
                  className={`${control} block`}
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  required
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
              <label>
                Deposit amount
                <input
                  aria-label="Deposit amount"
                  className={`${control} block`}
                  type="number"
                  min="0"
                  max="100000"
                  step="0.01"
                  required
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </label>
              <label>
                Pickup mileage (optional)
                <input
                  aria-label="Pickup mileage"
                  className={`${control} block`}
                  type="number"
                  min="0"
                  max="2000000"
                  step="1"
                  value={miles}
                  onChange={(e) => setMiles(e.target.value)}
                />
              </label>
              <label>
                <input type="checkbox" checked={held} onChange={(e) => setHeld(e.target.checked)} />{" "}
                Staff attests deposit is held (not provider verification)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />{" "}
                I reviewed the terms and evidence above.
              </label>
              <button
                className={control}
                disabled={busy || uncertain || !acknowledged || !rate}
                type="submit"
              >
                {busy ? "Converting…" : "Confirm Conversion"}
              </button>
            </form>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {linked && (
        <a className="underline" href={`/admin?tab=bookings&id=${encodeURIComponent(linked)}`}>
          Open Rental
        </a>
      )}
      <button
        className={control}
        disabled={busy || query.isFetching}
        onClick={() => {
          setUncertain(true);
          void query.refetch().then((r) => {
            if (r.data?.available) setUncertain(false);
          });
        }}
      >
        Reload Evidence
      </button>
      <button className={control} disabled={busy} onClick={() => setOpen(false)}>
        Close Review
      </button>
    </section>
  );
}
