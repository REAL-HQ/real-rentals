import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getFleetCalendar } from "@/lib/fleet-calendar.functions";
import { FLEET_CALENDAR_ENABLED } from "@/lib/fleet-calendar-flag";
import { addCalendarDays, blockOnDay, formatDayHeading, type FleetCalendarBoard } from "@/lib/fleet-calendar";

export function FleetCalendar() {
  if (!FLEET_CALENDAR_ENABLED) return null;
  return <FleetCalendarLive />;
}

function FleetCalendarLive() {
  const load = useServerFn(getFleetCalendar);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [board, setBoard] = useState<FleetCalendarBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load({ data: weekStart ? { weekStart } : {} })
      .then((next) => {
        if (!live) return;
        setBoard(next);
        setWeekStart((current) => current ?? next.weekStart);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could not load Fleet Calendar");
      });
    return () => {
      live = false;
    };
  }, [load, weekStart]);

  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Fleet Calendar</p>;

  return (
    <div className="space-y-4" data-testid="fleet-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[#55555E]">{board.heading} · Eastern Time</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[13px] text-[#111114]" onClick={() => setWeekStart(addCalendarDays(board.weekStart, -7))}>
            Previous Week
          </button>
          <button type="button" className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[13px] text-[#111114]" onClick={() => setWeekStart(addCalendarDays(board.weekStart, 7))}>
            Next Week
          </button>
        </div>
      </div>
      {board.vehiclesTruncated && <p className="text-[12px] text-[#55555E]">Showing The First 100 Vehicles</p>}
      {board.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">None</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[160px_repeat(7,minmax(0,1fr))] border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <div className="px-3 py-2 font-medium text-[#111114]">Vehicle</div>
              {board.days.map((day) => (
                <div key={day} className="px-2 py-2">{formatDayHeading(day)}</div>
              ))}
            </div>
            {board.rows.map((row) => (
              <div key={row.vehicleId} className="grid grid-cols-[160px_repeat(7,minmax(0,1fr))] border-b border-[#EDEDF0] last:border-b-0">
                <div className="px-3 py-2 text-[13px] font-medium text-[#111114]">{row.label}</div>
                {board.days.map((day) => (
                  <div key={day} className="space-y-1 px-1 py-1">
                    {blockOnDay(row.blocks, day).map((block) => (
                      <Link
                        key={block.id}
                        to="/admin"
                        search={block.search}
                        className="block rounded bg-[#F4F4F6] px-1.5 py-1 text-[11px] leading-tight text-[#111114] hover:bg-[#EDEDF0]"
                      >
                        <span className="block font-medium">{block.label}</span>
                        <span className="block text-[#55555E]">{block.detail}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <section className="rounded-xl border border-[#EDEDF0] bg-white p-4">
        <h2 className="text-[15px] font-semibold text-[#111114]">Not Shown</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-[#55555E]">
          {board.omitted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
