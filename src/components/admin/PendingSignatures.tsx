import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getPendingSignatures } from "@/lib/agreement-pending-signatures.functions";
import { AGREEMENT_PENDING_SIGNATURE_ENABLED } from "@/lib/agreement-pending-signatures-flag";
import type { PendingSignatureList } from "@/lib/agreement-pending-signatures";

export function PendingSignatures() {
  if (AGREEMENT_PENDING_SIGNATURE_ENABLED !== true) return null;
  return <PendingSignaturesLive />;
}

function PendingSignaturesLive() {
  const load = useServerFn(getPendingSignatures);
  const [list, setList] = useState<PendingSignatureList | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((next) => {
        if (live) setList(next);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="text-[13px] text-[#D03020]">Could Not Load Pending Signatures</p>;
  if (!list) return <p className="text-[13px] text-[#55555E]">Loading Pending Signatures</p>;

  return (
    <section className="mt-6 space-y-3" data-testid="pending-signatures">
      <div>
        <h3 className="text-[15px] font-semibold text-[#111114]">Pending Signatures</h3>
        <p className="text-[13px] text-[#55555E]">Days Waiting Use Eastern Dates</p>
      </div>
      {list.truncated ? (
        <p className="text-[12px] text-[#55555E]">Some Pending Signatures Were Not Loaded.</p>
      ) : null}
      {list.namesFailed ? (
        <p className="text-[12px] text-[#55555E]">Some Driver Names Were Not Checked.</p>
      ) : null}
      {list.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Agreements Waiting For A Signature</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Agreement</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Days Waiting</th>
                <th className="px-3 py-2 font-medium">Last Sent</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.agreementId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    {row.driverSearch ? (
                      <Link to="/admin" search={row.driverSearch} className="font-medium text-[#111114] underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="text-[#55555E]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#111114]">{row.title}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.statusLabel}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.daysWaiting == null ? "Unknown" : row.daysWaiting}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.lastSentLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
