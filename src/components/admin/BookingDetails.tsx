import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  X,
  Loader2,
  CalendarCheck,
  User,
  Car,
  ClipboardCheck,
  FileText,
  CreditCard,
  History,
  ArrowUpRight,
  AlertTriangle,
  Wrench,
  Lock,
} from "lucide-react";
import { getBooking, type BookingDetail } from "@/lib/bookings.functions";
import { BookingActions } from "@/components/admin/BookingActions";
import { listConditionMedia } from "@/lib/inspections.functions";
import { getAgreementPdf } from "@/lib/agreements.functions";
import { listAuditLog, type AuditRow } from "@/lib/team.functions";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { SectionCard, MicroLabel, StatusPill, EmptyState } from "./ui";
import { Row, TwoCol } from "./VehicleProfileFields";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { BOOKING_PHASE_LABEL, bookingDates } from "@/lib/bookings-list";
import { persistedNumber } from "@/lib/record-numbers";
import { RecordNumber } from "@/components/admin/RecordNumber";
import { BookingVehicleHistory } from "@/components/admin/BookingVehicleHistory";
import { CloseoutSummary } from "@/components/admin/CloseoutSummary";
import { CLOSEOUT_SUMMARY_ENABLED, closeoutApplies } from "@/lib/closeout-summary";

// A booking, read.
//
// Everything on this screen already existed and already pointed at the rental;
// what was missing was somewhere to see it together. So this composes the
// existing readers — getBooking, listConditionMedia, getAgreementPdf,
// listAuditLog — and writes nothing. Ending a rental still belongs to the
// driver record, where the deposit disposition it triggers also lives.
//
// Money (rent, deposits, balances, charges) is Manager-and-above and is ABSENT
// from the server's answer for a Coordinator, not hidden here: `canSeeMoney`
// reports which answer arrived, and the tab is not offered without it. The
// activity trail is Manager-only for the same reason it is in Settings — it
// names applicants and amounts.

type TabDef = {
  key: "overview" | "inspections" | "agreements" | "money" | "activity";
  label: string;
  icon: typeof CalendarCheck;
  money?: boolean;
};
/** `money: true` = Manager-and-above, because the server sends it to nobody else. */
const TABS: readonly TabDef[] = [
  { key: "overview", label: "Overview", icon: CalendarCheck },
  { key: "inspections", label: "Inspections", icon: ClipboardCheck },
  { key: "agreements", label: "Agreements", icon: FileText },
  { key: "money", label: "Payments", icon: CreditCard, money: true },
  { key: "activity", label: "Activity", icon: History, money: true },
];
type Tab = TabDef["key"];

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n: number | null | undefined) =>
  n == null ? null : `${Number(n).toLocaleString()} mi`;
const titleCase = (v: string | null | undefined) =>
  !v
    ? null
    : String(v)
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());

export function BookingDetails({
  rentalId,
  onClose,
  onOpenDriver,
  onOpenVehicle,
  onOpenMessages,
  onOpenTab,
}: {
  rentalId: string;
  onClose: () => void;
  /** Open the applicant's record. Takes applications.id — never rentals.driver_id. */
  onOpenDriver: (applicationId: string) => void;
  onOpenVehicle: (vehicleId: string) => void;
  /** Open the existing message thread for this applicant. */
  onOpenMessages: (applicationId: string) => void;
  /** Hand off to an existing admin tab rather than rebuilding its workflow. */
  onOpenTab: (tab: "charges" | "incidents" | "maintenance", vehicleId: string | null) => void;
}) {
  const load = useServerFn(getBooking);
  const [d, setD] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await load({ data: { rentalId } });
      setD(r);
      setFailed(!r);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [load, rentalId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const b = d?.booking;
  const money = !!d?.canSeeMoney;
  const tabs = TABS.filter((t) => !t.money || money);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-0 sm:p-4 overflow-y-auto"
      // Only a click on the backdrop itself closes the record — the same rule
      // the vehicle record follows, so a click inside never loses the page.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="min-w-0 w-full max-w-5xl overflow-hidden rounded-none bg-[#FAFAFB] shadow-2xl sm:my-2 sm:min-h-0 sm:rounded-2xl min-h-full lg:min-w-[auto]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bg-white border-b border-[#EDEDF0] px-5 sm:px-6 pt-4 pb-0">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 max-w-full truncate text-[17px] font-semibold text-[#111114] lg:min-w-[auto] lg:max-w-none">
                  {b?.driverName ?? (loading ? "…" : "Driver Record Not Linked")}
                </h2>
                {b && (
                  <StatusPill
                    status={b.phase}
                    tone={
                      b.phase === "active" ? "green" : b.phase === "cancelled" ? "red" : "neutral"
                    }
                  >
                    {BOOKING_PHASE_LABEL[b.phase]}
                  </StatusPill>
                )}
                {b && <RecordNumber label="Booking" value={persistedNumber(b, "bookingNumber")} />}
              </div>
              <p className="mt-1 break-words text-[13px] text-[#55555E] lg:break-normal">
                {b ? (
                  <>
                    {[b.unitNumber, b.vehicleLabel].filter(Boolean).join(" · ") ||
                      "Vehicle not linked"}
                    <span className="mx-1.5 text-[#C4C4CB]">|</span>
                    {bookingDates(b.startDate, b.endDate, b.phase)}
                  </>
                ) : (
                  " "
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-md p-1.5 text-[#9A9AA3] hover:text-[#111114] hover:bg-[#F4F4F6]"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          <nav className="flex gap-1 mt-4 -mb-px overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-booking-tab={t.key}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors ${
                  tab === t.key
                    ? "border-[#D03020] text-[#111114] font-medium"
                    : "border-transparent text-[#9A9AA3] hover:text-[#55555E]"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="p-5 sm:p-6">
          {loading && !d ? (
            <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[#9A9AA3]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading the booking…
            </div>
          ) : failed || !d ? (
            <EmptyState
              icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
              title="This booking could not be loaded"
              hint="The rental may have been removed, or your account may not have access."
            />
          ) : (
            <>
              {tab === "overview" && (
                <Overview
                  d={d}
                  onOpenDriver={onOpenDriver}
                  onOpenVehicle={onOpenVehicle}
                  onOpenMessages={onOpenMessages}
                  onOpenTab={onOpenTab}
                  onRefresh={refresh}
                />
              )}
              {tab === "inspections" && <Inspections d={d} />}
              {tab === "agreements" && <Agreements d={d} />}
              {tab === "money" && money && <Money d={d} />}
              {tab === "activity" && money && <Activity rentalId={rentalId} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Overview({
  d,
  onOpenDriver,
  onOpenVehicle,
  onOpenMessages,
  onOpenTab,
  onRefresh,
}: {
  d: BookingDetail;
  onOpenDriver: (id: string) => void;
  onOpenVehicle: (id: string) => void;
  onOpenMessages: (applicationId: string) => void;
  onOpenTab: (tab: "charges" | "incidents" | "maintenance", vehicleId: string | null) => void;
  onRefresh: () => void;
}) {
  const b = d.booking;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        {CLOSEOUT_SUMMARY_ENABLED && d.canSeeMoney && closeoutApplies(b.status) && (
          <CloseoutSummary rentalId={b.id} />
        )}
        <SectionCard
          title="Actions"
          icon={<ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />}
        >
          <BookingActions
            d={d}
            onRefresh={onRefresh}
            onOpenMessages={onOpenMessages}
            onOpenTab={onOpenTab}
          />
        </SectionCard>
        <SectionCard title="Rental" icon={<CalendarCheck className="w-4 h-4" strokeWidth={1.75} />}>
          <TwoCol>
            <div>
              <Row
                label="Status"
                value={
                  <StatusPill status={b.status ?? undefined}>
                    {titleCase(b.status) ?? "—"}
                  </StatusPill>
                }
              />
              <Row label="Start Date" value={b.startDate ? fmtDate(b.startDate) : "Not Recorded"} />
              <Row
                label="End Date"
                value={b.endDate ? fmtDate(b.endDate) : b.openEnded ? "Open-ended" : "Not Recorded"}
              />
            </div>
            <div>
              <Row label="Pickup Mileage" value={miles(d.mileage.pickup) ?? "Not Recorded"} />
              <Row
                label="Return Mileage"
                value={
                  miles(d.mileage.return) ??
                  (b.phase === "active" ? "Pending Return" : "Not Recorded")
                }
              />
              {d.canSeeMoney && (
                <Row
                  label="Weekly Rate"
                  value={b.weeklyRate == null ? "Not Set" : usd(b.weeklyRate)}
                />
              )}
            </div>
          </TwoCol>
          {d.unavailable.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#F4F4F6]" data-testid="booking-unavailable">
              <MicroLabel className="mb-1.5">Not Available From This Record</MicroLabel>
              <ul className="text-[12px] text-[#55555E] space-y-0.5">
                {d.unavailable.map((u) => (
                  <li key={u} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-[#C68A12] mt-0.5 shrink-0" /> {u}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Driver"
          icon={<User className="w-4 h-4" strokeWidth={1.75} />}
          right={
            d.driver.applicationId ? (
              <button
                onClick={() => onOpenDriver(d.driver.applicationId as string)}
                data-testid="open-driver"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[#55555E] hover:text-[#D03020] hover:bg-[#FAFAFB]"
              >
                Open Record <ArrowUpRight className="w-3 h-3" />
              </button>
            ) : null
          }
        >
          {d.driver.applicationId ? (
            <TwoCol>
              <div>
                <Row label="Name" value={d.driver.name} />
                <Row label="Email" value={d.driver.email} />
              </div>
              <div>
                <Row label="Phone" value={d.driver.phone} />
                <Row label="Application" value={titleCase(d.driver.applicationStatus)} />
              </div>
            </TwoCol>
          ) : (
            <p className="text-[13px] text-[#55555E]">
              This rental has no application linked, so the driver cannot be named from it. The
              portal login behind it is recorded in the activity trail.
            </p>
          )}
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard
          title="Vehicle"
          icon={<Car className="w-4 h-4" strokeWidth={1.75} />}
          right={
            d.vehicle?.id ? (
              <button
                onClick={() => onOpenVehicle(d.vehicle!.id as string)}
                data-testid="open-vehicle"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[#55555E] hover:text-[#D03020] hover:bg-[#FAFAFB]"
              >
                Open Record <ArrowUpRight className="w-3 h-3" />
              </button>
            ) : null
          }
        >
          {d.vehicle ? (
            <>
              <Row label="Unit Number" value={d.vehicle.unitNumber} />
              <Row label="Vehicle" value={d.vehicle.label} />
              <Row label="Plate" value={d.vehicle.plate} mono />
              <Row label="VIN" value={d.vehicle.vin} mono />
              <Row
                label="Status"
                value={d.vehicle.status ? <StatusPill status={d.vehicle.status} /> : null}
              />
            </>
          ) : (
            <p className="text-[13px] text-[#55555E]">No vehicle is linked to this rental.</p>
          )}
        </SectionCard>

        <SectionCard title="Vehicles" icon={<Car className="w-4 h-4" strokeWidth={1.75} />}>
          <BookingVehicleHistory rentalId={b.id} showSwap={b.phase === "active"} />
        </SectionCard>

        <SectionCard
          title="On This Booking"
          icon={<FileText className="w-4 h-4" strokeWidth={1.75} />}
        >
          <Row label="Inspections" value={String(d.counts.inspections)} />
          <Row label="Condition Photos" value={String(d.counts.conditionPhotos)} />
          <Row label="Agreements" value={String(d.counts.agreements)} />
          <Row label="Incidents" value={String(d.counts.incidents)} />
          <Row label="Service Records" value={String(d.counts.maintenance)} />
          {d.canSeeMoney && <Row label="Payments" value={String(d.counts.payments)} />}
          {d.canSeeMoney && <Row label="Tolls & Citations" value={String(d.counts.charges)} />}
        </SectionCard>

        {d.incidents.length > 0 && (
          <SectionCard
            title="Incidents"
            icon={<AlertTriangle className="w-4 h-4" strokeWidth={1.75} />}
            right={
              <button
                onClick={() => onOpenTab("incidents", d.vehicle?.id ?? null)}
                data-testid="open-incidents"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[#55555E] hover:bg-[#FAFAFB] hover:text-[#D03020]"
              >
                Open Incidents <ArrowUpRight className="w-3 h-3" />
              </button>
            }
          >
            <ul className="space-y-2" data-testid="booking-incidents">
              {d.incidents.map((i) => (
                <li
                  key={i.id}
                  data-incident={i.id}
                  className="rounded-xl border border-[#EDEDF0] bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-[#111114]">
                      {titleCase(i.type) ?? "Incident"}
                    </span>
                    <StatusPill status={i.status ?? undefined}>
                      {titleCase(i.status) ?? "—"}
                    </StatusPill>
                    {i.drivable === false && (
                      <span className="rounded-full bg-[rgba(208,48,32,0.08)] px-2 py-0.5 text-[10px] text-[#D03020]">
                        Not Drivable
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[12px] text-[#55555E]">
                    <span>Occurred: {i.occurredAt ? fmtDate(i.occurredAt) : "Not Recorded"}</span>
                    <span>Severity: {titleCase(i.severity) ?? "—"}</span>
                    <span>At Fault: {titleCase(i.atFault) ?? "—"}</span>
                    <span>Claim: {i.claimNumber ?? "None"}</span>
                  </div>
                  {i.description && (
                    <p className="mt-1.5 text-[12px] text-[#55555E]">{i.description}</p>
                  )}
                  {/* Absent for a Coordinator, not blanked — the server did not send it. */}
                  {"driverResponsible" in i && (
                    <div className="mt-1.5 text-[12px] text-[#55555E]">
                      Estimate {usd(i.estimatedCost)} · Actual {usd(i.actualCost)} ·{" "}
                      <span className="text-[#111114]">Driver {usd(i.driverResponsible)}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {d.maintenance.length > 0 && (
          <SectionCard
            title="Service On This Rental"
            icon={<Wrench className="w-4 h-4" strokeWidth={1.75} />}
            right={
              <button
                onClick={() => onOpenTab("maintenance", d.vehicle?.id ?? null)}
                data-testid="open-maintenance"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[#55555E] hover:bg-[#FAFAFB] hover:text-[#D03020]"
              >
                Open Maintenance <ArrowUpRight className="w-3 h-3" />
              </button>
            }
          >
            <ul className="space-y-2" data-testid="booking-maintenance">
              {d.maintenance.map((m) => (
                <li
                  key={m.id}
                  data-service={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#55555E]"
                >
                  <span className="text-[13px] font-medium text-[#111114]">
                    {m.item ?? "Service"}
                  </span>
                  <StatusPill status={m.status ?? undefined}>
                    {titleCase(m.status) ?? "—"}
                  </StatusPill>
                  <span>
                    {m.performedOn
                      ? fmtDate(m.performedOn)
                      : m.dueDate
                        ? `Due ${fmtDate(m.dueDate)}`
                        : "Not Scheduled"}
                  </span>
                  {m.odometer != null && <span>{miles(m.odometer)}</span>}
                  {m.vendorName && <span>{m.vendorName}</span>}
                  {"totalCost" in m && (
                    <span className="font-medium text-[#111114]">{usd(m.totalCost)}</span>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function Inspections({ d }: { d: BookingDetail }) {
  const loadMedia = useServerFn(listConditionMedia);
  const [media, setMedia] = useState<Array<Record<string, unknown>> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const vehicleId = d.vehicle?.id ?? null;
  const rentalId = d.booking.id;

  useEffect(() => {
    let live = true;
    if (!vehicleId) {
      setMedia([]);
      return;
    }
    void loadMedia({ data: { vehicleId, rentalId } })
      .then((r) => {
        if (live) setMedia((r ?? []) as Array<Record<string, unknown>>);
      })
      .catch(() => {
        if (live) setMedia([]);
      });
    return () => {
      live = false;
    };
  }, [loadMedia, vehicleId, rentalId]);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Inspections"
        icon={<ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />}
      >
        {d.inspections.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">No inspection is on file for this booking.</p>
        ) : (
          <div className="space-y-3">
            {d.inspections.map((i) => (
              <div
                key={i.id}
                className="rounded-xl border border-[#EDEDF0] bg-white p-3"
                data-inspection={i.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-[#111114]">
                    {titleCase(i.type) ?? "Inspection"}
                  </span>
                  <StatusPill status={i.status ?? undefined}>
                    {titleCase(i.status) ?? "—"}
                  </StatusPill>
                  {i.driverSignedAt && (
                    <span className="rounded-full bg-[rgba(32,160,96,0.10)] px-2 py-0.5 text-[10px] text-[#13613B]">
                      Driver Signed
                    </span>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[12px] text-[#55555E]">
                  <span>Started: {i.startedAt ? fmtDateTime(i.startedAt) : "—"}</span>
                  <span>
                    Completed: {i.completedAt ? fmtDateTime(i.completedAt) : "Not Completed"}
                  </span>
                  <span>Odometer: {miles(i.odometer) ?? "Not Recorded"}</span>
                  <span>Photos: {i.photoCount}</span>
                </div>
                {i.inspector && (
                  <div className="mt-1 text-[12px] text-[#9A9AA3]">Inspector: {i.inspector}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Condition Photos"
        icon={<ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />}
      >
        {media === null ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-[#9A9AA3]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading photos…
          </div>
        ) : media.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            No condition photos were taken on this booking.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="condition-photos">
            {media.map((m) => {
              const url = (m.url as string | null) ?? null;
              return (
                <button
                  key={String(m.id)}
                  onClick={() => url && setViewing(url)}
                  className="rounded-lg overflow-hidden border border-[#EDEDF0] bg-white text-left"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={String(m.caption ?? m.angle ?? "Condition photo")}
                      className="h-24 w-full object-cover"
                    />
                  ) : (
                    <div className="h-24 w-full grid place-items-center text-[11px] text-[#9A9AA3]">
                      Unavailable
                    </div>
                  )}
                  <div className="px-2 py-1 text-[11px] text-[#55555E] truncate">
                    {titleCase(String(m.phase ?? "")) || "Photo"}
                    {m.angle ? ` · ${titleCase(String(m.angle))}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {viewing && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewing(null)}
        >
          <img
            src={viewing}
            alt="Condition photo"
            className="max-h-[90vh] max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Agreement status for everyone who may open a booking; the signed PDF only
 * for a Manager.
 *
 * The signed contract carries the applicant's address, licence details, date of
 * birth, card digits and the rate — far more than a Coordinator needs to know
 * which rentals are papered. The server decides this: getAgreementPdf refuses a
 * staff caller who is not a Manager (see the note on the button). So the button
 * is offered on the same basis, and a Coordinator is told why rather than
 * hunting for a control that is not there.
 *
 * The metadata above it — title, status, sent, signed, voided, whether the PDF
 * archived — stays visible to a Coordinator, because that is the operational
 * question: is this booking papered or not.
 */
function Agreements({ d }: { d: BookingDetail }) {
  const pdf = useServerFn(getAgreementPdf);
  const [base64, setBase64] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function open(id: string) {
    setBusy(id);
    try {
      const r = await pdf({ data: { agreementId: id } });
      setBase64((r as { base64: string }).base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that agreement.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Agreements" icon={<FileText className="w-4 h-4" strokeWidth={1.75} />}>
        {d.agreements.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            No agreement is linked to this booking. Agreements are prepared and sent from the driver
            record.
          </p>
        ) : (
          <div className="space-y-3">
            {d.agreements.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-[#EDEDF0] bg-white p-3"
                data-agreement={a.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-[#111114]">
                    {a.title ?? "Rental Agreement"}
                  </span>
                  <StatusPill status={a.status ?? undefined}>
                    {titleCase(a.status) ?? "—"}
                  </StatusPill>
                  {a.archiveStatus && a.archiveStatus !== "archived" && (
                    <span className="rounded-full bg-[rgba(240,192,64,0.14)] px-2 py-0.5 text-[10px] text-[#8A6410]">
                      PDF {titleCase(a.archiveStatus)}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[12px] text-[#55555E]">
                  <span>Sent: {a.sentAt ? fmtDateTime(a.sentAt) : "Not Sent"}</span>
                  <span>Signed: {a.signedAt ? fmtDateTime(a.signedAt) : "Not Signed"}</span>
                  <span>{a.voidedAt ? `Voided: ${fmtDateTime(a.voidedAt)}` : ""}</span>
                </div>
                {a.status === "signed" &&
                  a.archiveStatus === "archived" &&
                  (d.canManage ? (
                    <button
                      onClick={() => void open(a.id)}
                      disabled={busy === a.id}
                      data-testid="open-agreement-pdf"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
                    >
                      {busy === a.id && <Loader2 className="w-3 h-3 animate-spin" />} Open Signed
                      PDF
                    </button>
                  ) : (
                    <p
                      className="mt-2 flex items-start gap-1.5 text-[12px] text-[#9A9AA3]"
                      data-testid="agreement-pdf-withheld"
                    >
                      <Lock className="w-3 h-3 mt-0.5 shrink-0" />
                      Signed and on file. The PDF itself is Manager-and-above — it carries the
                      renter&apos;s identity and payment details.
                    </p>
                  ))}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {base64 && (
        <div
          className="fixed inset-0 z-[90] overflow-y-auto bg-black/80 p-4"
          onClick={() => setBase64(null)}
        >
          <div
            className="mx-auto max-w-3xl rounded-xl bg-white p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end">
              <button
                onClick={() => setBase64(null)}
                aria-label="Close"
                className="rounded-md p-1 text-[#9A9AA3] hover:text-[#111114]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <AgreementPdfViewer base64={base64} />
          </div>
        </div>
      )}
    </div>
  );
}

function Money({ d }: { d: BookingDetail }) {
  const m = d.money;
  if (!m) return null;
  return (
    <div className="space-y-5">
      <SectionCard title="Deposit" icon={<CreditCard className="w-4 h-4" strokeWidth={1.75} />}>
        <TwoCol>
          <div>
            <Row label="Amount" value={usd(m.deposit.amount)} />
            <Row
              label="Held"
              value={m.deposit.held == null ? "—" : m.deposit.held ? "Yes" : "No"}
            />
          </div>
          <div>
            <Row label="Status" value={titleCase(m.deposit.status)} />
            <Row
              label="Refunded"
              value={m.deposit.refunded == null ? "—" : usd(m.deposit.refunded)}
            />
          </div>
        </TwoCol>
      </SectionCard>

      <SectionCard title="Payments" icon={<CreditCard className="w-4 h-4" strokeWidth={1.75} />}>
        {m.payments.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">No payment rows exist for this booking.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0 lg:overflow-visible">
          <table className="w-full min-w-[36rem] text-[12px] lg:min-w-[auto]" data-testid="booking-payments">
            <thead className="text-left text-[#9A9AA3]">
              <tr>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 font-medium">Due</th>
                <th className="py-1 font-medium">Paid</th>
                <th className="py-1 font-medium text-right">Amount</th>
                <th className="py-1 font-medium text-right">Outstanding</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {m.payments.map((p) => (
                <tr key={p.id} className="border-t border-[#F2F2F4]">
                  <td className="py-1.5">{titleCase(p.type) ?? "—"}</td>
                  <td className="py-1.5">{p.dueDate ? fmtDate(p.dueDate) : "—"}</td>
                  <td className="py-1.5">{p.paidDate ? fmtDate(p.paidDate) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(p.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.status === "paid" ? "—" : usd(p.balanceDue ?? p.amount)}
                  </td>
                  <td className="py-1.5">
                    <StatusPill status={p.status ?? undefined}>
                      {titleCase(p.status) ?? "—"}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Tolls & Citations"
        icon={<CreditCard className="w-4 h-4" strokeWidth={1.75} />}
      >
        {m.charges.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            No tolls or citations are matched to this booking.
          </p>
        ) : (
          <div className="space-y-2">
            {m.charges.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="font-medium text-[#111114]">
                  {titleCase(c.chargeType) ?? "Charge"}
                </span>
                <span className="text-[#55555E]">{c.agency ?? "—"}</span>
                <span className="text-[#55555E]">{c.occurredAt ? fmtDate(c.occurredAt) : "—"}</span>
                <span className="tabular-nums">{usd(c.amount)}</span>
                {c.adminFee ? (
                  <span className="text-[#9A9AA3]">+ {usd(c.adminFee)} fee</span>
                ) : null}
                <StatusPill status={c.status ?? undefined}>{titleCase(c.status) ?? "—"}</StatusPill>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Activity({ rentalId }: { rentalId: string }) {
  const load = useServerFn(listAuditLog);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void load({ data: { entityId: rentalId, limit: 100 } })
      .then((r) => {
        if (live) setRows(r ?? []);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [load, rentalId]);

  return (
    <SectionCard title="Activity" icon={<History className="w-4 h-4" strokeWidth={1.75} />}>
      {rows === null ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-[#9A9AA3]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[#55555E]">
          No activity is recorded against this rental. Activation and ending are audited; earlier
          records may predate the trail.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="booking-activity">
          {rows.map((r) => (
            <li key={r.id} className="text-[12px] text-[#55555E]">
              <span className="text-[#111114] font-medium">{r.summary}</span>
              <span className="mx-1.5 text-[#C4C4CB]">·</span>
              {fmtDateTime(r.created_at)}
              <span className="mx-1.5 text-[#C4C4CB]">·</span>
              {r.action}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
