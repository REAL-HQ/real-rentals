import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Scale } from "lucide-react";
import { getJvStatement } from "@/lib/jv-statement.functions";
import {
  JV_PERIODS,
  type JvPeriod,
  type JvStatement,
  type JvVehicleOption,
} from "@/lib/jv-statement";
import { EmptyState } from "./ui";

/**
 * Owner partner statement for one vehicle and one period.
 * Mounted only while FINANCE_JV_STATEMENT_ENABLED is true.
 * The screen never writes and never sends a statement to a partner.
 */

const COVERAGE_LABEL = {
  complete: "Complete",
  partial: "Partial",
  unavailable: "Unavailable",
} as const;

function money(cents: number | null): string {
  if (cents === null || !Number.isSafeInteger(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function JvStatementPanel() {
  const load = useServerFn(getJvStatement);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [period, setPeriod] = useState<JvPeriod>("this_month");
  const [vehicleId, setVehicleId] = useState("");
  const [vehicles, setVehicles] = useState<JvVehicleOption[]>([]);
  const [statement, setStatement] = useState<JvStatement | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    setBusy(true);
    loadRef
      .current({ data: { period, vehicleId: vehicleId || undefined } })
      .then((result) => {
        if (!active) return;
        if (result.status === "disabled") {
          setVehicles([]);
          setStatement(null);
          setReason("Partner Statement Is Off");
          return;
        }
        setVehicles(result.vehicles);
        if (result.status === "unavailable") {
          setStatement(null);
          setReason(result.reason);
          return;
        }
        setStatement(result.statement);
        setReason(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatement(null);
        setReason(error instanceof Error ? error.message : "Partner Statement could not be loaded");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [period, vehicleId]);

  return (
    <div>
      <div className="admin-sticky-bar flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-2">Partner Statement</h1>
        <div className="flex flex-wrap gap-2 text-xs">
          {JV_PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriod(item.id)}
              className={`px-3 py-1.5 rounded-md ${period === item.id ? "bg-black text-white" : "bg-white border border-border"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="ml-auto text-sm">
          <span className="sr-only">Vehicle</span>
          <select
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="h-8 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">Choose A Vehicle</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.partnerName ? `${vehicle.label} · ${vehicle.partnerName}` : vehicle.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {busy && <p className="text-sm text-muted-foreground">Loading Partner Statement</p>}
      {!busy && reason && (
        <EmptyState icon={<Scale className="h-5 w-5" />} title="Partner Statement" hint={reason} />
      )}
      {!busy && !reason && !statement && (
        <EmptyState
          icon={<Scale className="h-5 w-5" />}
          title="Choose A Vehicle"
          hint="Income, expenses, and the partner split are shown for one car and one period."
        />
      )}
      {!busy && statement && <StatementBody statement={statement} />}
    </div>
  );
}

function StatementBody({ statement }: { statement: JvStatement }) {
  const rows: { label: string; cents: number | null }[] = [
    { label: "Income", cents: statement.incomeCents },
    { label: "Refunds", cents: statement.refundsCents },
    { label: "Net Income", cents: statement.netIncomeCents },
    { label: "Company Income", cents: statement.companyIncomeCents },
    { label: "Partner Income", cents: statement.partnerIncomeCents },
    { label: "Company Expenses", cents: statement.companyExpenseCents },
    { label: "Partner Expenses", cents: statement.partnerExpenseCents },
    { label: "Expenses", cents: statement.expenseCents },
    { label: "Company Net", cents: statement.companyNetCents },
    { label: "Partner Net", cents: statement.partnerNetCents },
    { label: "Deposits Excluded", cents: statement.depositsExcludedCents },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-soft p-4">
        <div className="font-medium">{statement.vehicleLabel}</div>
        <div className="text-sm text-muted-foreground">
          {statement.partnerName ?? "No Partner"} · {statement.splitLabel} · {statement.from} to{" "}
          {statement.through} · Coverage {COVERAGE_LABEL[statement.coverage]}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Stripe processing fees stay off this split. They remain a company cost on Monthly Owner
          P&amp;L.
        </p>
      </div>
      {statement.sources.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {statement.sources.map((source) => (
            <div key={source.source} className="rounded-xl bg-white border border-border p-3">
              <div className="text-[10px] tracking-wider text-muted-foreground">{source.label}</div>
              <div className="text-sm font-medium">{money(source.cents)}</div>
            </div>
          ))}
        </div>
      )}
      <dl className="rounded-xl bg-white border border-border divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2 text-sm">
            <dt>{row.label}</dt>
            <dd className="font-medium">{money(row.cents)}</dd>
          </div>
        ))}
      </dl>
      {statement.unattributedStripeCents ? (
        <p className="text-sm text-muted-foreground">
          Unattributed Stripe {money(statement.unattributedStripeCents)} is not in this split.
        </p>
      ) : null}
      {statement.notes.length > 0 && (
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          {statement.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
