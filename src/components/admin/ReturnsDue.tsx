import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RETURNS_DUE_ENABLED } from "@/lib/returns-due-flag";
import { listReturnsDue } from "@/lib/returns-due.functions";
import { formatDueBack, type ReturnsDueBoard, type ReturnsDueRow } from "@/lib/returns-due";

export function ReturnsDue() {
  if (!RETURNS_DUE_ENABLED) return null;
  return <ReturnsDueList />;
}

function ReturnsDueList() {
  const load = useServerFn(listReturnsDue);
  const [board, setBoard] = useState<ReturnsDueBoard | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (!cancelled) setBoard(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (failed) return <p className="text-[13px] text-[#55555E]">Returns Due could not be loaded.</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Returns Due</p>;

  const overdue = board.rows.filter((row) => row.state === "overdue");
  const due = board.rows.filter((row) => row.state === "due");

  return (
    <div className="space-y-4" data-testid="returns-due">
      <div>
        <h1 className="text-[20px] font-semibold text-[#111114]">Returns Due</h1>
        <p className="text-[13px] text-[#55555E]">
          Active rentals due back through {formatDueBack(board.through)}, including overdue. Eastern Time. This list is read only.
        </p>
      </div>
      {board.truncated ? (
        <p className="text-[13px] text-[#55555E]">Showing the first {board.rows.length}. More active rentals are due back.</p>
      ) : null}
      <ReturnsTable title="Overdue" empty="No Overdue Returns" rows={overdue} />
      <ReturnsTable title="Due Back" empty="No Returns Due In This Window" rows={due} />
    </div>
  );
}

function ReturnsTable({ title, empty, rows }: { title: string; empty: string; rows: ReturnsDueRow[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[15px] font-semibold text-[#111114]">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Due Back</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rentalId} className="border-b border-[#EDEDF0] last:border-b-0">
                  <td className="px-3 py-2 text-[#111114]">{row.driverName}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-2 text-[#55555E]">{formatDueBack(row.dueBack)}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
