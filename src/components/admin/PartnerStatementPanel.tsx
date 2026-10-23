import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Handshake } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState } from "./ui";
import { getPartnerStatement } from "@/lib/partner-statement.functions";
import {
  PARTNER_STATEMENT_PERIODS,
  partnerStatementCsv,
  periodLabel,
  type PartnerStatement,
  type PartnerStatementPeriod,
  type PartnerStatementResponse,
} from "@/lib/partner-statement";

/**
 * Owner screen for one partner's period. Mounted only while
 * PARTNER_STATEMENT_ENABLED is true. CSV is built in the browser.
 */

function money(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  });
}

function downloadCsv(statement: PartnerStatement) {
  const blob = new Blob([partnerStatementCsv(statement)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `partner-statement-${statement.partnerId}-${statement.period}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function PartnerStatementPanel() {
  const read = useServerFn(getPartnerStatement);
  const [period, setPeriod] = useState<PartnerStatementPeriod>("this_month");
  const [partnerId, setPartnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<PartnerStatementResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    read({ data: { period, ...(partnerId ? { partnerId } : {}) } })
      .then((result) => {
        if (!cancelled) setResponse(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Partner statement unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [read, period, partnerId]);

  const partners = response && response.status !== "disabled" ? response.partners : [];
  const statement = response?.status === "ready" ? response.statement : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Partner Statement</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Attributed revenue, vehicle expenses, and this partner&apos;s share. Unattributed charges stay separate and are not in the share.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={partnerId}
            onChange={(event) => setPartnerId(event.target.value)}
            aria-label="Partner"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            <option value="">Choose a Partner</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>{partner.name}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {PARTNER_STATEMENT_PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPeriod(item.id)}
                className={`px-3 py-2 text-sm ${period === item.id ? "bg-[rgba(208,48,32,0.08)] text-[#D03020] font-medium" : "bg-white text-muted-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!statement}
            onClick={() => statement && downloadCsv(statement)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Download CSV
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Partner Statement Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}

      {response?.status === "ready" && !statement && (
        <EmptyState
          icon={<Handshake className="w-6 h-6" strokeWidth={1.75} />}
          title={partners.length ? "Choose a Partner" : "No Partners Yet"}
          hint={partners.length ? "The statement lists that partner's vehicles for the period." : "Add a partner, then open their statement here."}
        />
      )}

      {statement && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {statement.partnerName} · {periodLabel(statement.period)} · {formatYmd(statement.from)} – {formatYmd(statement.through)} · {statement.splitLabel}
          </p>
          {!statement.revenueComplete && (
            <p className="text-sm text-[#D03020]">Revenue Is Incomplete. Amounts that depend on it are left blank.</p>
          )}
          {statement.conflictingCharges > 0 && (
            <p className="text-sm text-[#D03020]">{statement.conflictingCharges} Charges Could Not Be Attributed</p>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            {([
              ["Revenue", statement.revenueCents],
              ["Expenses", statement.expenseCents],
              ["Net", statement.netCents],
              ["Partner Share", statement.partnerShareCents],
            ] as const).map(([label, cents]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {label === "Partner Share" && statement.split === "not_configured" ? statement.splitLabel : money(cents) || "—"}
                </p>
              </div>
            ))}
          </div>
          {statement.vehicles.length === 0 ? (
            <EmptyState
              icon={<Handshake className="w-6 h-6" strokeWidth={1.75} />}
              title="No Vehicles For This Partner"
              hint="Vehicles show here when vehicles.partner_id names this partner."
            />
          ) : (
            <AdminTableScroll className="rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAFB] text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Vehicle</th>
                    <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
                    <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
                    <th className="px-4 py-2.5 font-medium text-right">Net</th>
                    <th className="px-4 py-2.5 font-medium text-right">Partner Share</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.vehicles.map((vehicle) => (
                    <tr key={vehicle.vehicleId} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{vehicle.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(vehicle.revenueCents) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(vehicle.expenseCents) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(vehicle.netCents) || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{statement.split === "not_configured" ? statement.splitLabel : money(vehicle.partnerShareCents) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableScroll>
          )}
          <p className="text-sm text-muted-foreground">
            Unattributed Revenue {money(statement.unattributedStripeRevenueCents) || "—"} · Deposits Excluded {money(statement.depositsExcludedCents) || "—"}
          </p>
        </div>
      )}
    </div>
  );
}
