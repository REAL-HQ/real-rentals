import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getRenewalsDue } from "@/lib/renewals-due.functions";
import { RENEWALS_DUE_ENABLED } from "@/lib/renewals-due-flag";
import { RENEWAL_CANDIDATES_ENABLED } from "@/lib/renewal-candidates-flag";
import { formatRenewalDate, type RenewalsDueBoard } from "@/lib/renewals-due";

export function RenewalsDue() {
  if (!RENEWALS_DUE_ENABLED) return null;
  if (RENEWAL_CANDIDATES_ENABLED === true) return <RenewalsDueHistory />;
  return <RenewalsDueLive />;
}

function RenewalsDueLive() {
  const load = useServerFn(getRenewalsDue);
  const [board, setBoard] = useState<RenewalsDueBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    load()
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch((reason) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could Not Load Renewal Due");
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Renewal Due</p>;

  return (
    <div className="space-y-4" data-testid="renewals-due">
      <div>
        <h1 className="text-[20px] font-semibold text-[#111114]">Renewal Due</h1>
        <p className="text-[13px] text-[#55555E]">
          {board.heading} Through {formatRenewalDate(board.through)} · Eastern Time
        </p>
      </div>
      <Truncation board={board} />
      <OverdueReturn rows={board.overdue} />
      {board.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Rentals Due For Renewal</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Weekly Rate</th>
                <th className="px-3 py-2 font-medium">Next Billing</th>
                <th className="px-3 py-2 font-medium">End Date</th>
                <th className="px-3 py-2 font-medium">Last Payment</th>
                <th className="px-3 py-2 font-medium">Payments</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.rentalId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    {row.driverSearch ? (
                      <Link to="/admin" search={row.driverSearch} className="font-medium text-[#111114] underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="text-[#55555E]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-2 text-[#111114]">{formatWeeklyRate(row.weeklyRate)}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.nextPaymentDue ? formatRenewalDate(row.nextPaymentDue) : "None"}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.endDate ? formatRenewalDate(row.endDate) : "None"}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.lastPaymentStatus}</td>
                  <td className="px-3 py-2">
                    <Link to="/admin" search={row.paymentsSearch} className="text-[#111114] underline">
                      Payments
                    </Link>
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

function RenewalsDueHistory() {
  const load = useServerFn(getRenewalsDue);
  const [windowDays, setWindowDays] = useState<7 | 14>(7);
  const [goodHistoryOnly, setGoodHistoryOnly] = useState(false);
  const [board, setBoard] = useState<RenewalsDueBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setBoard(null);
    load({ data: { windowDays, goodHistoryOnly } })
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch(() => {
        if (live) setError("Could Not Load Renewal Due");
      });
    return () => {
      live = false;
    };
  }, [load, windowDays, goodHistoryOnly]);

  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!board) return <p className="text-[13px] text-[#55555E]">Loading Renewal Due</p>;

  return (
    <div className="space-y-4" data-testid="renewals-due">
      <div>
        <h1 className="text-[20px] font-semibold text-[#111114]">Renewal Due</h1>
        <p className="text-[13px] text-[#55555E]">
          {board.heading} Through {formatRenewalDate(board.through)} · Eastern Time
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={windowDays === 7}
          onClick={() => setWindowDays(7)}
          className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-[13px] text-[#111114]"
        >
          7 Days
        </button>
        <button
          type="button"
          aria-pressed={windowDays === 14}
          onClick={() => setWindowDays(14)}
          className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-[13px] text-[#111114]"
        >
          14 Days
        </button>
        <label className="flex items-center gap-2 text-[13px] text-[#111114]">
          <input
            type="checkbox"
            checked={goodHistoryOnly}
            onChange={(event) => setGoodHistoryOnly(event.target.checked)}
          />
          Good Payment History
        </label>
        <p className="text-[12px] text-[#55555E]">
          7 Days, 14 Days, And Good Payment History Apply To Renewal Due Only
        </p>
      </div>
      <Truncation board={board} />
      <OverdueReturn rows={board.overdue} />
      {board.historyUnavailable ? (
        <p className="text-[13px] text-[#D03020]">Could Not Load Renewal Due</p>
      ) : board.rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Rentals Due For Renewal</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Weekly Rate</th>
                <th className="px-3 py-2 font-medium">Next Billing</th>
                <th className="px-3 py-2 font-medium">End Date</th>
                <th className="px-3 py-2 font-medium">Last Payment</th>
                <th className="px-3 py-2 font-medium">Paid Charges</th>
                <th className="px-3 py-2 font-medium">Payments</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.rentalId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    {row.driverSearch ? (
                      <Link to="/admin" search={row.driverSearch} className="font-medium text-[#111114] underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="text-[#55555E]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-2 text-[#111114]">{formatWeeklyRate(row.weeklyRate)}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.nextPaymentDue ? formatRenewalDate(row.nextPaymentDue) : "None"}</td>
                  <td className="px-3 py-2 text-[#55555E]">{row.endDate ? formatRenewalDate(row.endDate) : "None"}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.lastPaymentStatus}</td>
                  <td className="px-3 py-2 text-[#111114]">{row.paidCharges == null ? "Not Checked" : row.paidCharges}</td>
                  <td className="px-3 py-2">
                    <Link to="/admin" search={row.paymentsSearch} className="text-[#111114] underline">
                      Payments
                    </Link>
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

function OverdueReturn({ rows }: { rows: RenewalsDueBoard["overdue"] }) {
  return (
    <section className="space-y-2" data-testid="overdue-return">
      <h2 className="text-[15px] font-semibold text-[#111114]">Overdue Return</h2>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[#9A9AA3]">No Overdue Returns</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-[#EDEDF0] text-[12px] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">End Date</th>
                <th className="px-3 py-2 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rentalId} className="border-b border-[#EDEDF0] last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    {row.driverSearch ? (
                      <Link to="/admin" search={row.driverSearch} className="font-medium text-[#111114] underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="text-[#55555E]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-2 text-[#55555E]">{formatRenewalDate(row.endDate)}</td>
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

function formatWeeklyRate(rate: number | null): string {
  if (rate == null || Number.isNaN(rate)) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(rate);
}

function Truncation({ board }: { board: RenewalsDueBoard }) {
  const notes: string[] = [];
  if (board.billingTruncated) notes.push("Next Billing Dates Are Capped At 1000");
  if (board.endTruncated) notes.push("End Dates Are Capped At 1000");
  if (board.overdueTruncated) notes.push("Overdue Returns Are Capped At 1000");
  if (board.applicationsTruncated) notes.push("Drivers Are Capped At 1000");
  if (board.vehiclesTruncated) notes.push("Vehicles Are Capped At 1000");
  if (board.paymentsTruncated) notes.push("Payments Are Capped At 1000, Newest First");
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-[12px] text-[#55555E]">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}
