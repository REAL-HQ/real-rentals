import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listReservations,
  getReservationOptions,
  getReservationHistory,
  changeReservation,
} from "@/lib/reservations.functions";
import {
  reservationActions,
  reservationInstant,
  reservationLocal,
  type Reservation,
} from "@/lib/reservations";
const control = "rounded-md border border-border bg-white px-3 py-2 text-sm disabled:opacity-50";
const stateLabel = (state: string) => state.charAt(0).toUpperCase() + state.slice(1);
const stamp = (value: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
function offsetAt(value: string, tz: string) {
  const s =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date(value))
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}` : "+00:00";
}
export function ReservationsPanel() {
  const list = useServerFn(listReservations),
    options = useServerFn(getReservationOptions),
    history = useServerFn(getReservationHistory),
    change = useServerFn(changeReservation);
  const [view, setView] = useState<"upcoming" | "drafts" | "history">("upcoming");
  const [cursor, setCursor] = useState<{ after: string; afterId: string } | undefined>();
  const [selected, setSelected] = useState<Reservation | null>(null),
    [form, setForm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [q, setQ] = useState(""),
    [applicationId, setApplication] = useState(""),
    [vehicleId, setVehicle] = useState(""),
    [pickup, setPickup] = useState(""),
    [end, setEnd] = useState(""),
    [offset, setOffset] = useState(""),
    [endOffset, setEndOffset] = useState(""),
    [reason, setReason] = useState("");
  const listing = useQuery({
    queryKey: ["reservations", view, cursor],
    queryFn: () => list({ data: { view, ...cursor } }),
    retry: false,
  });
  const result = listing.data;
  const canManage = result?.available === true && result.canManage;
  const rows = result?.available ? result.value : [];
  const [schedule, setSchedule] = useState<{ pickupAt: string | null; endAt: string | null }>({
    pickupAt: null,
    endAt: null,
  });
  const choices = useQuery({
    queryKey: ["reservation-options", q, vehicleQuery, schedule, selected?.id],
    queryFn: () =>
      options({ data: { q, vehicleQuery, ...schedule, excludeId: selected?.id ?? null } }),
    enabled: canManage && form,
    retry: false,
  });
  const choice = choices.data?.available ? choices.data.value : null;
  const vehicle = choice?.vehicles.find((v) => v.id === vehicleId),
    applicant = choice?.applicants.find((a) => a.id === applicationId);
  const timezone =
    vehicle?.timezone ?? (vehicleId ? null : (applicant?.timezone ?? selected?.timezone));
  useEffect(() => {
    try {
      if (!timezone) throw Error();
      setSchedule({
        pickupAt: reservationInstant(pickup, offset, timezone),
        endAt: end ? reservationInstant(end, endOffset, timezone) : null,
      });
    } catch {
      setSchedule({ pickupAt: null, endAt: null });
    }
  }, [pickup, end, offset, endOffset, timezone]);
  const trail = useQuery({
    queryKey: ["reservation-history", selected?.id],
    queryFn: () => history({ data: { id: selected!.id } }),
    enabled: !!selected && result?.available === true,
    retry: false,
  });
  function reset() {
    setSelected(null);
    setForm(false);
    setMessage("");
    setReason("");
  }
  function open(r: Reservation) {
    setSelected(r);
    setForm(false);
    setReason("");
    setMessage("");
  }
  function edit(r: Reservation | null) {
    setSelected(r);
    setApplication(r?.application_id ?? "");
    setVehicle(r?.vehicle_id ?? "");
    setPickup(r ? reservationLocal(r.pickup_at, r.timezone) : "");
    setOffset(r ? offsetAt(r.pickup_at, r.timezone) : "");
    setEnd(r?.agreed_end_at ? reservationLocal(r.agreed_end_at, r.timezone) : "");
    setEndOffset(r?.agreed_end_at ? offsetAt(r.agreed_end_at, r.timezone) : "");
    setForm(true);
    setMessage("");
  }
  async function act(action: "create" | "edit" | "reserve" | "confirm" | "cancel" | "expire") {
    setMessage("");
    setBusy(true);
    try {
      let times: Partial<{ pickupAt: string; endAt: string | null }> = {};
      if (action === "create" || action === "edit") {
        if (!timezone)
          throw Error("Select an applicant/vehicle with a configured market timezone.");
        times = {
          pickupAt: reservationInstant(pickup, offset, timezone),
          endAt: end ? reservationInstant(end, endOffset, timezone) : null,
        };
      }
      const r = await change({
        data: {
          action,
          id: selected?.id,
          version: selected?.version,
          ...(action === "create" ? { applicationId } : {}),
          vehicleId: vehicleId || null,
          reason,
          ...times,
        },
      });
      if (!r.available) {
        setMessage(r.message);
        return;
      }
      setSelected(null);
      setForm(false);
      setReason("");
      setMessage(
        action === "create"
          ? "Reservation draft created. Open Drafts to review and reserve."
          : "Reservation updated. No rental was activated and no payment was collected.",
      );
      if (action === "create") {
        setView("drafts");
        setCursor(undefined);
      }
      await listing.refetch();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Request could not be verified. Reload before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Advance Reservations">
      <div>
        <h2 className="text-xl font-semibold">Advance Reservations</h2>
        <p className="text-sm text-muted-foreground">
          Future plans and temporary holds — separate from active rentals.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["upcoming", "drafts", "history"] as const).map((v) => (
          <button
            className={control}
            aria-pressed={view === v}
            key={v}
            onClick={() => {
              setView(v);
              setCursor(undefined);
              reset();
            }}
          >
            {v === "upcoming" ? "Upcoming" : v === "drafts" ? "Drafts" : "Reservation History"}
          </button>
        ))}
        <button
          className={control}
          onClick={() => {
            reset();
            void listing.refetch();
          }}
        >
          Reload
        </button>
        {canManage && (
          <button className={control} onClick={() => edit(null)}>
            Create Reservation
          </button>
        )}
      </div>
      {listing.isPending && <p role="status">Loading reservations…</p>}
      {listing.isError && (
        <p role="alert">Reservations could not be loaded. Rental bookings remain available.</p>
      )}
      {result && !result.available && (
        <p role="status" className="rounded-lg border p-4">
          {result.message}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border p-3">
          {message}
        </p>
      )}
      {result?.available && (
        <>
          {!canManage && (
            <p className="text-sm text-muted-foreground">
              Operational view only. Reservation changes require an Owner or Manager.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Open-ended weekly rentals have no assumed return. Elapsed holds still block inventory
            until a Manager expires them. Confirmation is not payment, signing or activation.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((r) => (
              <button
                key={r.id}
                className="rounded-lg border p-4 text-left hover:bg-muted/30"
                onClick={() => open(r)}
              >
                <strong>{r.applicant_name ?? "Applicant unavailable"}</strong>
                <span className="ml-2 rounded border px-2 text-xs">{stateLabel(r.state)}</span>
                <p>{r.vehicle_label ?? "Vehicle unassigned"}</p>
                {r.warnings.length > 0 && (
                  <p className="text-sm text-amber-800">Needs attention: {r.warnings.join("; ")}</p>
                )}
                <p className="text-sm">
                  Pickup: {stamp(r.pickup_at, r.timezone)} · {r.timezone}
                </p>
                {r.hold_expires_at && (
                  <p className="text-sm">
                    {Date.parse(r.hold_expires_at) <= Date.now()
                      ? "Hold elapsed — manual expiration required"
                      : "Hold expires"}
                    : {stamp(r.hold_expires_at, r.timezone)}
                  </p>
                )}
              </button>
            ))}
          </div>
          {!rows.length && !listing.isFetching && <p>No reservations in this view.</p>}
          <div className="flex gap-2">
            {cursor && (
              <button className={control} onClick={() => setCursor(undefined)}>
                First Page
              </button>
            )}
            {rows.length === 50 && (
              <button
                className={control}
                onClick={() => {
                  const r = rows.at(-1)!;
                  setCursor({ after: r.pickup_at, afterId: r.id });
                  reset();
                }}
              >
                Next Page
              </button>
            )}
          </div>
        </>
      )}
      {selected && (
        <article className="space-y-3 rounded-lg border p-4" aria-label="Reservation details">
          <h3 className="font-semibold">
            {selected.applicant_name ?? "Applicant"} — {stateLabel(selected.state)}
          </h3>
          <a
            className="underline"
            href={`/admin?tab=drivers&id=${encodeURIComponent(selected.application_id)}`}
          >
            View Applicant
          </a>
          <p>
            {selected.vehicle_label ?? "Unassigned"} ·{" "}
            {stamp(selected.pickup_at, selected.timezone)} ({selected.timezone})
          </p>
          <p>
            {selected.agreed_end_at
              ? `Agreed end: ${stamp(selected.agreed_end_at, selected.timezone)}`
              : "Open-ended occupancy — no agreed end date."}
          </p>
          <ul className="text-sm text-amber-800">
            {selected.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="text-sm">
            Readiness and conflicts are rechecked on each allocation action. Existing rentals use
            whole-day dates; same-day turnover is not promised.
          </p>
          {canManage && reservationActions(selected, true).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reservationActions(selected, true).includes("edit") && (
                <button className={control} disabled={busy} onClick={() => edit(selected)}>
                  Reschedule / Reassign
                </button>
              )}
              {(["reserve", "confirm", "expire"] as const)
                .filter((a) => reservationActions(selected, true).includes(a))
                .map((a) => (
                  <button className={control} key={a} disabled={busy} onClick={() => void act(a)}>
                    {a === "reserve"
                      ? "Reserve (24 Hours)"
                      : a === "confirm"
                        ? "Confirm Reservation"
                        : "Expire Hold"}
                  </button>
                ))}
              <label className="text-sm">
                Cancellation reason
                <input
                  className={`${control} block`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className={control}
                disabled={busy || !reason.trim()}
                onClick={() => void act("cancel")}
              >
                Cancel Reservation
              </button>
            </div>
          )}
          <h4 className="font-medium">Transition History</h4>
          {trail.isPending ? (
            <p>Loading history…</p>
          ) : trail.isError ? (
            <p role="alert">History unavailable.</p>
          ) : trail.data?.available ? (
            <ul className="text-sm">
              {trail.data.value.map((h, i) => (
                <li key={i}>
                  {stamp(h.occurred_at, selected.timezone)}: {h.from_state ?? "New"} → {h.to_state}{" "}
                  ({h.action})
                </li>
              ))}
            </ul>
          ) : (
            <p>{trail.data?.message}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Most recent 50 transitions. Original audit history is retained.
          </p>
        </article>
      )}
      {form && canManage && (
        <form
          className="space-y-4 rounded-lg border p-4"
          aria-label="Reservation editor"
          onSubmit={(e) => {
            e.preventDefault();
            void act(selected ? "edit" : "create");
          }}
        >
          <h3 className="font-semibold">
            {selected ? "Reschedule / Reassign" : "Create Reservation Draft"}
          </h3>
          {!selected && (
            <>
              <label className="block text-sm">
                Find approved applicant
                <input
                  className={`${control} block w-full`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Applicant
                <select
                  aria-label="Applicant"
                  className={`${control} block w-full`}
                  required
                  value={applicationId}
                  onChange={(e) => setApplication(e.target.value)}
                >
                  <option value="">Select an existing applicant</option>
                  {choice?.applicants.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs">
                First 25 matching approved applicants. Refine the search if needed.
              </p>
            </>
          )}
          {choices.isPending && <p>Loading eligibility…</p>}
          {choices.isError && <p role="alert">Availability could not be verified.</p>}
          {choices.data && !choices.data.available && <p role="alert">{choices.data.message}</p>}
          <label className="block text-sm">
            Find vehicle
            <input
              className={`${control} block w-full`}
              value={vehicleQuery}
              onChange={(e) => setVehicleQuery(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Vehicle
            <select
              aria-label="Vehicle"
              className={`${control} block w-full`}
              value={vehicleId}
              onChange={(e) => {
                setVehicle(e.target.value);
                setOffset("");
                setEndOffset("");
              }}
            >
              <option value="">Unassigned draft</option>
              {selected?.vehicle_id &&
                !choice?.vehicles.some((v) => v.id === selected.vehicle_id) && (
                  <option value={selected.vehicle_id}>
                    {selected.vehicle_label ?? "Current vehicle — availability unverified"}
                  </option>
                )}
              {choice?.vehicles.map((v) => (
                <option value={v.id} key={v.id} disabled={v.reasons.length > 0}>
                  {v.label}
                  {v.reasons.length ? " — Held / Unverified" : ""}
                </option>
              ))}
            </select>
          </label>
          {choice?.vehicles.some((v) => v.reasons.length > 0) && (
            <details className="text-sm rounded border p-3">
              <summary>Held or unverified vehicles</summary>
              <ul>
                {choice.vehicles
                  .filter((v) => v.reasons.length > 0)
                  .map((v) => (
                    <li key={v.id}>
                      <strong>{v.label}</strong>: {v.reasons.join("; ")}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <p className="text-sm">
            Market timezone: <strong>{timezone ?? "Not configured / unknown"}</strong>. First 50
            matching vehicles shown; refine the search if needed.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Pickup date/time
              <input
                required
                type="datetime-local"
                step="900"
                className={`${control} block w-full`}
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Pickup UTC offset
              <input
                required
                placeholder="-04:00"
                className={`${control} block w-full`}
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Agreed end (optional)
              <input
                type="datetime-local"
                step="900"
                className={`${control} block w-full`}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            {end && (
              <label className="text-sm">
                End UTC offset
                <input
                  required
                  className={`${control} block w-full`}
                  value={endOffset}
                  onChange={(e) => setEndOffset(e.target.value)}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Use the market’s offset for the selected date, including daylight saving time. Leave end
            blank for an open-ended weekly rental. Finite ends must be on a later local date.
          </p>
          <div role="status" className="rounded border p-3 text-sm">
            <strong>Availability review</strong>
            {vehicle ? (
              <>
                <ul>
                  {vehicle.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p>
                  {!schedule.pickupAt || choices.isFetching
                    ? "Unknown — enter a valid schedule and wait for verification."
                    : vehicle.conflict === null
                      ? "Conflict status unknown."
                      : vehicle.conflict
                        ? "Reservation conflict — allocation will be refused."
                        : "No reservation overlap found in this snapshot; final allocation is checked transactionally."}
                </p>
              </>
            ) : (
              <p>
                Select a vehicle to check readiness and conflicts. Unassigned drafts do not hold
                inventory.
              </p>
            )}
          </div>
          <p className="text-sm">
            Changes to a confirmed reservation require reconfirmation. No rental, charge or signing
            request will be created.
          </p>
          <button
            className={control}
            disabled={busy || !choice || choices.isFetching}
            type="submit"
          >
            {busy ? "Saving…" : selected ? "Save Schedule" : "Create Draft"}
          </button>
          <button
            type="button"
            className={`${control} ml-2`}
            disabled={busy}
            onClick={() => setForm(false)}
          >
            Close Editor
          </button>
        </form>
      )}
    </section>
  );
}
