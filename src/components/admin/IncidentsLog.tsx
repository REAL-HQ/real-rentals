import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { listIncidentsLog } from "@/lib/incidents-log.functions";
import { INCIDENTS_LOG_ENABLED } from "@/lib/incidents-log-flag";
import type { IncidentLogRecord, PartyTotal, RecoveredTotal } from "@/lib/incidents-log";
import { fmtDate } from "@/lib/date-format";
import { SectionCard } from "./ui";

function dollars(value: number | null): string {
  if (value == null) return "Not Recorded";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function recoveredText(total: RecoveredTotal): string {
  if (total.amount == null) return "Not Recorded";
  if (total.unknown === 0) return dollars(total.amount);
  return `${dollars(total.amount)} · ${total.unknown} Not Recorded`;
}

function when(value: string): string {
  return fmtDate(value);
}

export function IncidentsLog() {
  if (!INCIDENTS_LOG_ENABLED) return null;
  return <IncidentsLogLive />;
}

function IncidentsLogLive() {
  const load = useServerFn(listIncidentsLog);
  const result = useQuery({
    queryKey: ["incidents-log"],
    queryFn: () => load({ data: {} }),
  });

  return (
    <div className="mb-6" data-testid="incidents-log">
      <SectionCard title="Incidents Log" icon={<ShieldAlert className="h-4 w-4" strokeWidth={1.75} />}>
        <p className="text-[13px] text-[#55555E]">
          Read only. A recovered amount is a recorded number. This log does not create a charge or deduct a deposit.
        </p>
        {result.isError ? (
          <p className="mt-3 text-sm text-[#D03020]">Could not load the incidents log.</p>
        ) : result.isLoading || !result.data ? (
          <p className="mt-3 text-sm text-[#55555E]">Loading the incidents log.</p>
        ) : (
          <IncidentsLogBody
            incidents={result.data.incidents}
            vehicleTotals={result.data.vehicleTotals}
            driverTotals={result.data.driverTotals}
            photoLinksInstalled={result.data.photoLinksInstalled}
            recoveryInstalled={result.data.recoveryInstalled}
          />
        )}
      </SectionCard>
    </div>
  );
}

function IncidentsLogBody({
  incidents,
  vehicleTotals,
  driverTotals,
  photoLinksInstalled,
  recoveryInstalled,
}: {
  incidents: IncidentLogRecord[];
  vehicleTotals: PartyTotal[];
  driverTotals: PartyTotal[];
  photoLinksInstalled: boolean;
  recoveryInstalled: boolean;
}) {
  return (
    <div className="mt-4 space-y-6">
      {incidents.length === 0 ? (
        <p className="text-sm text-[#55555E]">No Incidents</p>
      ) : (
        <ul className="space-y-3">
          {incidents.map((row) => (
            <li key={row.id} data-testid="incidents-log-row" className="rounded-xl border border-[#EDEDF0] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold text-[#111114]">{row.typeLabel}</p>
                <p className="text-[13px] text-[#55555E]">{when(row.occurredAt)}</p>
              </div>
              <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
                <Fact label="Vehicle" value={row.vehicleLabel} />
                <Fact label="Driver" value={row.driverLabel} />
                <Fact label="Rental" value={row.rentalId ?? "No Rental"} />
                <Fact label="Claim Status" value={row.claimStatusLabel} />
                <Fact label="Claim Number" value={row.claimNumber ?? "No Claim Number"} />
                <Fact label="Estimated Cost" value={dollars(row.estimatedCost)} />
                <Fact label="Actual Cost" value={dollars(row.actualCost)} />
                <Fact label="Amount Recovered" value={recoveryInstalled ? dollars(row.amountRecovered) : "Not Recorded"} />
              </dl>
              {row.description ? <p className="mt-3 text-[13px] text-[#111114]">{row.description}</p> : null}
              <PhotoLinks row={row} installed={photoLinksInstalled} />
            </li>
          ))}
        </ul>
      )}
      <Totals title="Vehicle Totals" rows={vehicleTotals} testId="incidents-log-vehicle-totals" />
      <Totals title="Driver Totals" rows={driverTotals} testId="incidents-log-driver-totals" />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#55555E]">{label}</dt>
      <dd className="text-[#111114]">{value}</dd>
    </div>
  );
}

function PhotoLinks({ row, installed }: { row: IncidentLogRecord; installed: boolean }) {
  if (!installed || row.photos == null) {
    return <p className="mt-3 text-[13px] text-[#55555E]">Photo Links Not Installed</p>;
  }
  if (row.photos.length === 0) {
    return <p className="mt-3 text-[13px] text-[#55555E]">No Photo Links</p>;
  }
  return (
    <ul className="mt-3 space-y-1 text-[13px] text-[#111114]">
      {row.photos.map((photo) => (
        <li key={photo.id}>
          {photo.kind === "document" ? "Document" : "Inspection"}: {photo.label}
        </li>
      ))}
    </ul>
  );
}

function Totals({ title, rows, testId }: { title: string; rows: PartyTotal[]; testId: string }) {
  return (
    <section data-testid={testId}>
      <h3 className="text-[13px] font-semibold text-[#111114]">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-[#55555E]">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="text-[13px] text-[#111114]">
              {row.label} · {row.incidents} {row.incidents === 1 ? "Incident" : "Incidents"} · Estimated {dollars(row.estimated)} · Actual {dollars(row.actual)} · Recovered {recoveredText(row.recovered)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
