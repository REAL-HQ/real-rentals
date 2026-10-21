import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listFleetAvailability } from "@/lib/fleet-availability.functions";
import {
  APPROVED_NOT_RENTING_FILTER,
  FLEET_AVAILABILITY_ENABLED,
  FLEET_GROUPS,
  FLEET_GROUP_LABEL,
  type FleetAvailabilityRow,
  type FleetGroup,
} from "@/lib/fleet-availability";

/**
 * One-glance fleet board. Mounted only while FLEET_AVAILABILITY_ENABLED is
 * on. The server refuses the read when the flag is off. Nothing here writes.
 */
export function FleetAvailability({ canOpenWaitingList }: { canOpenWaitingList: boolean }) {
  const load = useServerFn(listFleetAvailability);
  const query = useQuery({
    queryKey: ["fleet-availability"],
    queryFn: () => load(),
    enabled: FLEET_AVAILABILITY_ENABLED,
  });

  if (!FLEET_AVAILABILITY_ENABLED) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-[#111114]">Fleet Availability</h1>
        <p className="mt-1 text-[13px] text-[#55555E]">
          Every car that is not archived, grouped from the live rental, the stored status, open incidents, and the registration and insurance dates.
        </p>
      </div>

      {query.isPending && <p className="text-[13px] text-[#55555E]">Loading Fleet Availability</p>}
      {query.isError && (
        <p className="text-[13px] text-[#D03020]">
          {query.error instanceof Error ? query.error.message : "Fleet Availability Could Not Be Loaded"}
        </p>
      )}

      {query.data && (
        <>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {FLEET_GROUPS.map((id) => (
              <li key={id} className="rounded-2xl border border-[#EDEDF0] bg-white px-4 py-3">
                <div className="text-[12px] text-[#55555E]">{FLEET_GROUP_LABEL[id]}</div>
                <div className="mt-1 text-[28px] font-semibold leading-none text-[#111114]">{query.data.counts[id]}</div>
              </li>
            ))}
          </ul>

          <WaitingHint count={query.data.waitingCount} canOpen={canOpenWaitingList} />

          {query.data.total === 0 && (
            <p className="rounded-2xl border border-[#EDEDF0] bg-white px-5 py-8 text-center text-[13px] text-[#55555E]">
              No Cars On The Board
            </p>
          )}

          {query.data.groups.map((group) =>
            group.rows.length === 0 ? null : (
              <GroupTable key={group.id} id={group.id} label={group.label} rows={group.rows} />
            ),
          )}
        </>
      )}
    </div>
  );
}

function WaitingHint({ count, canOpen }: { count: number; canOpen: boolean }) {
  const body = (
    <>
      <div>
        <div className="text-[13px] font-semibold text-[#111114]">Next Approved Driver Waiting</div>
        <div className="mt-0.5 text-[12px] text-[#55555E]">Approved, Not Yet Renting</div>
      </div>
      <div className="text-[22px] font-semibold text-[#111114]">{count}</div>
    </>
  );
  const className = "flex items-center justify-between gap-4 rounded-2xl border border-[#EDEDF0] bg-white px-5 py-3";
  if (!canOpen) return <div className={className}>{body}</div>;
  return (
    <Link
      to="/admin"
      search={{ tab: "drivers", filter: APPROVED_NOT_RENTING_FILTER }}
      className={`${className} hover:border-[#111114]`}
    >
      {body}
    </Link>
  );
}

function GroupTable({ id, label, rows }: { id: FleetGroup; label: string; rows: FleetAvailabilityRow[] }) {
  const rented = id === "rented";
  return (
    <section className="overflow-hidden rounded-2xl border border-[#EDEDF0] bg-white">
      <header className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-3">
        <h2 className="text-[13px] font-semibold text-[#111114]">{label}</h2>
        <span className="text-[12px] text-[#55555E]">{rows.length}</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#FAFAFB] text-xs text-[#55555E]">
            <tr>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">Plate</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {rented && <th className="px-3 py-2 font-medium">Driver</th>}
              {rented && <th className="px-3 py-2 font-medium">Next Payment Due</th>}
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#EDEDF0]">
                <td className="px-3 py-2 font-mono whitespace-nowrap">{row.unit}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.vehicle}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{row.plate}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.statusLabel}</td>
                {rented && <td className="px-3 py-2 whitespace-nowrap">{row.driver}</td>}
                {rented && <td className="px-3 py-2 whitespace-nowrap">{row.nextPaymentDue}</td>}
                <td className="px-3 py-2 text-[#55555E]">{row.facts.length ? row.facts.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
