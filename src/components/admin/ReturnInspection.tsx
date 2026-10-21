import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getReturnInspection, listReturnInspectionRentals } from "@/lib/return-inspection.functions";
import { RETURN_INSPECTION_VIEW_ENABLED } from "@/lib/return-inspection-flag";
import {
  RETURN_INSPECTION_NOT_IN_SCHEMA,
  type ReturnInspectionRentalOption,
  type ReturnInspectionView,
} from "@/lib/return-inspection";
import { fmtDate } from "@/lib/date-format";

export function ReturnInspection({ rentalId }: { rentalId: string | null }) {
  if (!RETURN_INSPECTION_VIEW_ENABLED) return null;
  return <ReturnInspectionLive rentalId={rentalId} />;
}

function ReturnInspectionLive({ rentalId }: { rentalId: string | null }) {
  const navigate = useNavigate();
  const loadList = useServerFn(listReturnInspectionRentals);
  const loadOne = useServerFn(getReturnInspection);
  const [options, setOptions] = useState<ReturnInspectionRentalOption[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [view, setView] = useState<ReturnInspectionView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let live = true;
    loadList()
      .then((next) => {
        if (!live) return;
        setOptions(next.rentals);
        setTruncated(next.truncated);
      })
      .catch((reason) => {
        if (live) setListError(reason instanceof Error ? reason.message : "Could Not Load Rentals");
      });
    return () => {
      live = false;
    };
  }, [loadList]);

  useEffect(() => {
    if (!rentalId) {
      setView(null);
      setDetailError(null);
      setLoadingDetail(false);
      return;
    }
    let live = true;
    setLoadingDetail(true);
    setDetailError(null);
    loadOne({ data: { rentalId } })
      .then((next) => {
        if (!live) return;
        setView(next);
        setLoadingDetail(false);
      })
      .catch((reason) => {
        if (!live) return;
        setView(null);
        setLoadingDetail(false);
        setDetailError(reason instanceof Error ? reason.message : "Could Not Load Return Inspection");
      });
    return () => {
      live = false;
    };
  }, [loadOne, rentalId]);

  function choose(id: string) {
    void navigate({
      to: "/admin",
      search: (id ? { tab: "return_inspection", id } : { tab: "return_inspection" }) as never,
    });
  }

  return (
    <div className="space-y-4" data-testid="return-inspection">
      <label className="block max-w-xl text-[13px] text-[#55555E]">
        Select A Rental
        <select
          className="mt-1 block w-full rounded-md border border-[#EDEDF0] bg-white px-3 py-2 text-[13px] text-[#111114]"
          value={rentalId ?? ""}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">Select A Rental</option>
          {rentalId && !options.some((row) => row.id === rentalId) && <option value={rentalId}>Selected Rental</option>}
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      </label>
      {truncated && <p className="text-[12px] text-[#55555E]">Showing The Latest 100 Rentals</p>}
      {listError && <p className="text-[13px] text-[#D03020]">{listError}</p>}
      {!rentalId && <p className="text-[13px] text-[#9A9AA3]">Select A Rental To See Return And Closeout Data</p>}
      {loadingDetail && <p className="text-[13px] text-[#55555E]">Loading Return Inspection</p>}
      {detailError && <p className="text-[13px] text-[#D03020]">{detailError}</p>}
      {view && <ReturnInspectionBody view={view} />}
      {!view && <SchemaGaps lines={RETURN_INSPECTION_NOT_IN_SCHEMA} />}
    </div>
  );
}

function ReturnInspectionBody({ view }: { view: ReturnInspectionView }) {
  const end = view.rental.endDate ? fmtDate(view.rental.endDate) : "No End Date";
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#111114]">
        {view.rental.vehicleLabel} · {view.rental.driverName} · {view.rental.statusLabel} · {fmtDate(view.rental.startDate)} – {end}
      </p>
      {view.missing.length > 0 && (
        <Section title="Missing">
          <ul className="list-disc pl-5">
            {view.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {view.missing.includes("Return Mileage") && view.pickupMileage.length > 0 && (
            <p className="text-[#55555E]">Pickup Mileage Is On File</p>
          )}
        </Section>
      )}
      <Section title="Return Mileage">
        <Mileage rows={view.mileage} />
      </Section>
      <Section title="Return Fuel">
        {view.fuel.length === 0 ? (
          <Empty />
        ) : (
          view.fuel.map((row) => (
            <p key={row.inspectionId}>
              {row.label === "Recorded" ? `${row.raw} · Recorded` : row.label}
              {row.recordedAt ? ` · ${fmtDate(row.recordedAt)}` : ""}
            </p>
          ))
        )}
      </Section>
      <Section title="Return Photos">
        {view.photos.length === 0 ? (
          <Empty />
        ) : (
          view.photos.map((row) => (
            <p key={row.id}>
              {row.fileName} · {row.phaseLabel}
              {row.caption ? ` · ${row.caption}` : ""} · {fmtDate(row.createdAt)}
            </p>
          ))
        )}
      </Section>
      <Section title="Damage Notes">
        {view.damageNotes.length === 0 ? (
          <Empty />
        ) : (
          view.damageNotes.map((row) => (
            <p key={row.id}>
              <span className="font-medium">{row.source}</span>
              {row.label ? ` · ${row.label}` : ""}
              {` · ${row.text}`}
            </p>
          ))
        )}
      </Section>
      <Section title="Damage And Fee Charges">
        {view.fees.length === 0 ? (
          <Empty />
        ) : (
          view.fees.map((row) => (
            <p key={row.id}>
              {row.kind} · {money(row.amount)}
              {row.status ? ` · ${row.status}` : ""}
              {row.netCollected != null ? ` · Net Collected ${money(row.netCollected)}` : ""}
              {row.balanceDue != null ? ` · Balance Due ${money(row.balanceDue)}` : ""}
              {row.notes ? ` · ${row.notes}` : ""}
            </p>
          ))
        )}
      </Section>
      <Section title="Repair Amounts">
        <p className="text-[#55555E]">These Are Repair Amounts, Not A Payments Row</p>
        {view.repairAmounts.length === 0 ? (
          <Empty />
        ) : (
          view.repairAmounts.map((row) => (
            <p key={row.id}>
              {row.kind} · {row.incidentType} · {money(row.amount)}
            </p>
          ))
        )}
      </Section>
      <Section title="Deposit Closeout">
        {view.missing.includes("Deposit Closeout") ? (
          <Empty />
        ) : (
          <div className="space-y-1">
            <p>Status · {view.closeout.statusLabel}</p>
            <p>Deposit Amount · {view.closeout.amount == null ? "Not Recorded" : money(view.closeout.amount)}</p>
            <p>Held · {view.closeout.held == null ? "Not Recorded" : view.closeout.held ? "Yes" : "No"}</p>
            <p>Refund Amount · {view.closeout.refundAmount == null ? "Not Recorded" : money(view.closeout.refundAmount)}</p>
            <p>Settled · {view.closeout.settledAt ? fmtDate(view.closeout.settledAt) : "Not Recorded"}</p>
            <p>Notes · {view.closeout.notes ?? "Not Recorded"}</p>
            {view.closeout.deductions.map((row) => (
              <p key={row.id}>
                Deduction · {row.reason} · {money(row.amount)}
                {row.notes ? ` · ${row.notes}` : ""}
              </p>
            ))}
          </div>
        )}
      </Section>
      <SchemaGaps lines={view.notInSchema} />
    </div>
  );
}

function Mileage({ rows }: { rows: ReturnInspectionView["mileage"] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <>
      {rows.map((row) => (
        <p key={row.id}>
          {row.sourceLabel} · {row.mileage.toLocaleString("en-US")}
          {row.observedOn ? ` · ${fmtDate(row.observedOn)}` : ""}
          {row.note ? ` · ${row.note}` : ""}
        </p>
      ))}
    </>
  );
}

function SchemaGaps({ lines }: { lines: readonly string[] }) {
  return (
    <Section title="Not In The Schema">
      <ul className="list-disc pl-5 text-[#55555E]">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#EDEDF0] bg-white p-4">
      <h2 className="text-[15px] font-semibold text-[#111114]">{title}</h2>
      <div className="mt-2 space-y-1 text-[13px] text-[#111114]">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="text-[#9A9AA3]">Not Recorded</p>;
}

function money(amount: number): string {
  return Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
