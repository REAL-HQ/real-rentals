import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { INCIDENT_CHARGE_PREP_ENABLED } from "@/lib/incident-charge-prep-flag";
import { listIncidentChargePrep } from "@/lib/incident-charge-prep.functions";
import type { IncidentChargePrepRow } from "@/lib/incident-charge-prep";
import { fmtDateTime } from "@/lib/date-format";

const STATUS: Record<IncidentChargePrepRow["status"], string> = {
  open: "Open",
  in_claim: "In Claim",
  repairing: "Repairing",
};

function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function IncidentChargePrep() {
  if (!INCIDENT_CHARGE_PREP_ENABLED) return null;
  return <IncidentChargePrepList />;
}

function IncidentChargePrepList() {
  const load = useServerFn(listIncidentChargePrep);
  const [rows, setRows] = useState<IncidentChargePrepRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void load({ data: {} })
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <section data-testid="incident-charge-prep" className="rounded-lg border border-[#EDEDF0] bg-white p-4">
      <h2 className="text-[15px] font-semibold text-[#111114]">Incident Charge Prep</h2>
      <p className="mt-1 text-[12px] text-[#55555E]">This Does Not Create a Charge.</p>
      {failed ? (
        <p className="mt-3 text-[13px] text-[#55555E]">Incident Charge Prep could not be loaded.</p>
      ) : rows == null ? (
        <p className="mt-3 text-[13px] text-[#55555E]">Loading</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#55555E]">No Open Incidents To Prepare.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.incidentId} className="rounded-md border border-[#EDEDF0] p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#111114]">{row.vehicleLabel}</span>
                <span className="text-[#55555E]">{STATUS[row.status]}</span>
              </div>
              <div className="mt-1 text-[12px] text-[#55555E]">
                {row.incidentType} · {fmtDateTime(row.occurredAt)} ·{" "}
                {row.proposedAmount == null ? "No Driver Amount" : money(row.proposedAmount)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
