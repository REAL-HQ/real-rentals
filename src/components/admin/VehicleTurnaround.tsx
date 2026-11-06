import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getVehicleTurnaround } from "@/lib/vehicle-turnaround.functions";
import { VEHICLE_TURNAROUND_ENABLED } from "@/lib/vehicle-turnaround-flag";
import {
  formatTurnaroundDate,
  type TurnaroundFlag,
  type VehicleTurnaroundBoard,
} from "@/lib/vehicle-turnaround";

export function VehicleTurnaround() {
  if (!VEHICLE_TURNAROUND_ENABLED) return null;
  return <VehicleTurnaroundLive />;
}

function VehicleTurnaroundLive() {
  const load = useServerFn(getVehicleTurnaround);
  const [board, setBoard] = useState<VehicleTurnaroundBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could Not Load Vehicle Turnaround");
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Vehicle Turnaround</p>;

  const idleLabel = board.totalIdleDays === 1 ? "1 Day" : `${board.totalIdleDays} Days`;

  return (
    <div className="space-y-4" data-testid="vehicle-turnaround">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111114]">Vehicle Turnaround</h1>
          <p className="text-[13px] text-[#55555E]">{board.heading} · Eastern Time</p>
        </div>
        <p className="text-[13px] text-[#111114]">
          <span className="font-semibold">Total Idle Days</span>
          <span className="ml-2">{idleLabel}</span>
        </p>
      </div>
      {board.unknownIdleCount > 0 && (
        <p className="text-[12px] text-[#55555E]">
          {board.unknownIdleCount === 1
            ? "1 Vehicle Has No Recorded End Date And Is Left Out Of The Total"
            : `${board.unknownIdleCount} Vehicles Have No Recorded End Date And Are Left Out Of The Total`}
        </p>
      )}
      <Truncation board={board} />
      {board.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Vehicles In Turnaround</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Why</th>
                <th className="px-3 py-2 font-medium">Idle Days</th>
                <th className="px-3 py-2 font-medium">Last Rental End</th>
                <th className="px-3 py-2 font-medium">Next Pickup</th>
                <th className="px-3 py-2 font-medium">Open Service</th>
                <th className="px-3 py-2 font-medium">Registration</th>
                <th className="px-3 py-2 font-medium">Insurance</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.vehicleId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <Link to="/admin" search={row.vehicleSearch} className="font-medium text-[#111114] underline">
                      {row.label}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[#55555E]">{row.reasons.join(" · ")}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.idleDays == null ? "Unknown" : row.idleDays}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.lastRentalEnd ? formatTurnaroundDate(row.lastRentalEnd) : "None"}</td>
                  <td className="px-3 py-2 text-[#55555E]">
                    {row.nextPickup
                      ? `${formatTurnaroundDate(row.nextPickup.date)}${row.nextPickup.name ? ` · ${row.nextPickup.name}` : ""}`
                      : "None"}
                  </td>
                  <td className="px-3 py-2">
                    <Link to="/admin" search={row.serviceSearch} className="text-[#111114] underline">
                      {row.openService.length === 0
                        ? "Service"
                        : row.openService
                            .map((item) => (item.due ? `${item.item} · ${formatTurnaroundDate(item.due)}` : item.item))
                            .join(", ")}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Flag flag={row.registration} />
                  </td>
                  <td className="px-3 py-2">
                    <Flag flag={row.insurance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function Flag({ flag }: { flag: TurnaroundFlag }) {
  const color =
    flag.status === "not_ready" ? "text-[#D03020]" : flag.status === "attention" ? "text-[#8A5A00]" : "text-[#111114]";
  return (
    <span className={color} title={flag.reason}>
      {flag.value}
    </span>
  );
}

function Truncation({ board }: { board: VehicleTurnaroundBoard }) {
  const notes: string[] = [];
  if (board.vehiclesTruncated) notes.push("Showing The First 1000 Vehicles");
  if (board.activeRentalsTruncated) notes.push("Active Rentals Are Capped At 1000");
  if (board.endedRentalsTruncated) notes.push("Ended Rentals Are Capped At 1000, Newest End Dates First");
  if (board.pickupsTruncated) notes.push("Pickups Are Capped At 1000");
  if (board.servicesTruncated) notes.push("Open Service Items Are Capped At 1000");
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-[12px] text-[#55555E]">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
