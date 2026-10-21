import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listBookingFollowups } from "@/lib/booking-followup.functions";
import { BOOKING_FOLLOWUP_ENABLED, LAST_CONTACT_NOT_CHECKED, type BookingFollowupRow } from "@/lib/booking-followup";
import { displayPersonName } from "@/lib/display-normalize";
import { fmtDateTime } from "@/lib/date-format";

export function BookingFollowupPanel() {
  const load = useServerFn(listBookingFollowups);
  const [rows, setRows] = useState<BookingFollowupRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyErrorId, setCopyErrorId] = useState<string | null>(null);

  useEffect(() => {
    if (BOOKING_FOLLOWUP_ENABLED !== true) return;
    let current = true;
    load()
      .then((result) => {
        if (!current) return;
        if (!result || !Array.isArray(result.rows)) throw new Error("unavailable");
        setRows(result.rows);
        setTruncated(result.truncated === true);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [load]);

  if (BOOKING_FOLLOWUP_ENABLED !== true) return null;

  async function copyReminder(row: BookingFollowupRow) {
    setCopyErrorId(null);
    try {
      await navigator.clipboard.writeText(row.reminder);
      setCopiedId(row.applicationId);
    } catch {
      setCopiedId(null);
      setCopyErrorId(row.applicationId);
    }
  }

  return (
    <section
      aria-labelledby="booking-followup-title"
      className="rounded-2xl border border-[#EDEDF0] bg-white p-4 sm:p-5"
    >
      <h2 id="booking-followup-title" className="text-lg font-semibold text-[#111114]">
        Booking Follow-Up
      </h2>
      <p className="mt-1 text-sm text-[#55555E]">
        Approved or verified applications with no booking. Copy a reminder. Nothing sends from here.
      </p>
      {truncated ? (
        <p className="mt-2 text-sm text-[#55555E]">
          Some Last Contact Times Were Not Checked.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="py-6 text-sm text-[#9B1C1C]">
          Booking Follow-Up Could Not Be Loaded.
        </p>
      ) : rows === null ? (
        <p role="status" className="py-6 text-sm text-[#55555E]">
          Loading Booking Follow-Up
        </p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-[#55555E]">
          No Approved Or Verified Applications Are Waiting On A Booking.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map((row) => {
            const name = row.name ? displayPersonName(row.name) : "Name Not Recorded";
            return (
              <li key={row.applicationId} className="rounded-xl border border-[#EDEDF0] p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      to="/admin"
                      search={{ tab: "drivers", id: row.applicationId }}
                      className="text-[15px] font-semibold text-[#111114]"
                    >
                      {name}
                    </Link>
                    <p className="mt-1 text-[13px] text-[#55555E]">{row.reasonLabel}</p>
                  </div>
                  <p className="text-[13px] text-[#111114]">
                    <span className="text-[#55555E]">Days Waiting </span>
                    {row.daysWaiting === null ? "Not Recorded" : row.daysWaiting}
                  </p>
                </div>
                <dl className="mt-3 grid gap-2 text-[13px] text-[#111114] sm:grid-cols-2">
                  <div>
                    <dt className="text-[#55555E]">Last Contact</dt>
                    <dd>
                      {row.lastContactLabel === LAST_CONTACT_NOT_CHECKED
                        ? LAST_CONTACT_NOT_CHECKED
                        : row.lastContactAt
                          ? `${fmtDateTime(row.lastContactAt)}${row.lastContactLabel ? ` · ${row.lastContactLabel}` : ""}`
                          : "No Contact Recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#55555E]">Email</dt>
                    <dd>{row.email ?? "Not On File"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#55555E]">Phone</dt>
                    <dd>{row.phone ?? "Not On File"}</dd>
                  </div>
                </dl>
                <label className="mt-3 block text-[13px] text-[#55555E]" htmlFor={`reminder-${row.applicationId}`}>
                  Reminder
                </label>
                <textarea
                  id={`reminder-${row.applicationId}`}
                  readOnly
                  value={row.reminder}
                  rows={6}
                  className="mt-1 w-full rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-2 text-[13px] text-[#111114]"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    className="rounded-lg bg-[#111114] px-3 py-1.5 text-[13px] font-medium text-white"
                    aria-label={`Copy Reminder For ${name}`}
                    onClick={() => void copyReminder(row)}
                  >
                    Copy Reminder
                  </button>
                  {copiedId === row.applicationId ? (
                    <span className="text-[13px] text-[#55555E]">Copied</span>
                  ) : null}
                  {copyErrorId === row.applicationId ? (
                    <span className="text-[13px] text-[#9B1C1C]">Select The Reminder And Copy It</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
