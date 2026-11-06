import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTollsTicketsLedger } from "@/lib/tolls-tickets.functions";
import { TOLLS_TICKETS_LEDGER_ENABLED } from "@/lib/tolls-tickets-flag";
import type { TollsTicketsLedger } from "@/lib/tolls-tickets";
import { SectionCard } from "./ui";

export function TollsTickets() {
  if (!TOLLS_TICKETS_LEDGER_ENABLED) return null;
  return <TollsTicketsLive />;
}

function TollsTicketsLive() {
  const load = useServerFn(getTollsTicketsLedger);
  const [ledger, setLedger] = useState<TollsTicketsLedger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((next) => {
        if (!live) return;
        setLedger(next);
      })
      .catch(() => {
        if (live) setError("Could Not Load Tolls And Tickets");
      });
    return () => {
      live = false;
    };
  }, [load]);

  return (
    <div className="space-y-4" data-testid="tolls-tickets">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-semibold text-[#111114]">Tolls And Tickets</h1>
        {ledger && (
          <button
            type="button"
            className="rounded-md border border-[#EDEDF0] bg-white px-3 py-1.5 text-[13px] font-medium text-[#111114]"
            onClick={() => downloadCsv(ledger.csv)}
          >
            Download CSV
          </button>
        )}
      </div>
      {error && <p className="text-[13px] text-[#D03020]">{error}</p>}
      {!ledger && !error && <p className="text-[13px] text-[#55555E]">Loading Tolls And Tickets</p>}
      {ledger && <TollsTicketsBody ledger={ledger} />}
    </div>
  );
}

function TollsTicketsBody({ ledger }: { ledger: TollsTicketsLedger }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Ledger" padded={false}>
        {ledger.withheld ? (
          <p className="px-5 py-4 text-[13px] text-[#55555E]">{withheldCopy(ledger.withheld)}</p>
        ) : ledger.lines.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-[#9A9AA3]">No Tolls, Tickets, Or Violations</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#111114]">
              <thead className="border-b border-[#EDEDF0] text-[#55555E]">
                <tr>
                  {["Date", "Renter", "Rental", "Vehicle", "Kind", "Amount", "Billed To Renter", "Paid", "Link", "Notes"].map((heading) => (
                    <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.lines.map((line) => (
                  <tr key={`${line.source}-${line.id}`} className="border-b border-[#EDEDF0]">
                    <td className="px-3 py-2">{line.dateEt ?? "Not Recorded"}</td>
                    <td className="px-3 py-2">{line.renter}</td>
                    <td className="px-3 py-2">{line.rental}</td>
                    <td className="px-3 py-2">{line.vehicle}</td>
                    <td className="px-3 py-2">{line.kind}</td>
                    <td className="px-3 py-2">{money(line.amount)}</td>
                    <td className="px-3 py-2">{yesNo(line.billedToRenter)}</td>
                    <td className="px-3 py-2">{yesNo(line.paid)}</td>
                    <td className="px-3 py-2">
                      <a className="text-[#111114] underline" href={line.link}>Open Record</a>
                    </td>
                    <td className="px-3 py-2">{line.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      {!ledger.withheld && (
        <SectionCard title="Totals By Renter">
          {ledger.totals.length === 0 ? (
            <p className="text-[13px] text-[#9A9AA3]">No Totals</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {ledger.totals.map((total) => (
                <li key={total.renterId ?? "unassigned"}>
                  {total.renter} · {money(total.amount)} · {total.lineCount} {total.lineCount === 1 ? "Line" : "Lines"}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
      <SectionCard title="Data Gaps">
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#55555E]">
          {ledger.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function withheldCopy(reason: "page_cap" | "failed_read"): string {
  if (reason === "page_cap") return "This Ledger Is Withheld Because A Source Has More Than 100 Rows";
  return "This Ledger Is Withheld Because A Read Failed";
}

function yesNo(value: boolean | null): string {
  if (value == null) return "Not Recorded";
  return value ? "Yes" : "No";
}

function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tolls-tickets.csv";
  link.click();
  URL.revokeObjectURL(url);
}
