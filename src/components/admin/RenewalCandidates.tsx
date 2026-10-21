import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listRenewalCandidates } from "@/lib/renewal-candidates.functions";
import { RENEWAL_CANDIDATES_ENABLED } from "@/lib/renewal-candidates-flag";
import { formatCandidateDate, type RenewalCandidateList } from "@/lib/renewal-candidates";

export function RenewalCandidates() {
  if (RENEWAL_CANDIDATES_ENABLED !== true) return null;
  return <RenewalCandidatesLive />;
}

function RenewalCandidatesLive() {
  const load = useServerFn(listRenewalCandidates);
  const [board, setBoard] = useState<RenewalCandidateList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could Not Load Renewal Candidates");
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Renewal Candidates</p>;

  return (
    <div className="space-y-4" data-testid="renewal-candidates">
      <div>
        <h1 className="text-[20px] font-semibold text-[#111114]">Renewal Candidates</h1>
        <p className="text-[13px] text-[#55555E]">
          Active rentals ending by {formatCandidateDate(board.through)} with a good payment history. Eastern Time.
        </p>
      </div>
      {board.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Renewal Candidates</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">End Date</th>
                <th className="px-3 py-2 font-medium">Days Left</th>
                <th className="px-3 py-2 font-medium">Paid Charges</th>
                <th className="px-3 py-2 font-medium">Payment History</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.rentalId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    {row.applicationId ? (
                      <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="font-medium text-[#111114] underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="text-[#55555E]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-2 text-[#55555E]">{formatCandidateDate(row.endDate)}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.daysLeft}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.paidCharges}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.historyLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
