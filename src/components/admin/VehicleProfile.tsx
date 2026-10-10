import { useUnsavedGuard, confirmLeaveIfUnsaved } from "@/lib/unsaved-changes";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { VehicleSuggestions } from "@/components/admin/VehicleSuggestions";
import { toast } from "sonner";
import {
  X,
  Loader2,
  Pencil,
  Share2,
  Car,
  ArrowLeft,
  FileText,
  Images,
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
  ScrollText,
  Satellite,
  KeyRound,
  AlertTriangle,
  Wrench,
  Lock,
  ExternalLink,
  History,
} from "lucide-react";
import {
  getVehicleProfile,
  updateVehicleSection,
  VEHICLE_STATUSES,
  BODY_TYPES,
  OWNERSHIP_TYPES,
  type VehicleProfile as Profile,
  type VehicleSection,
} from "@/lib/vehicles.functions";
import { getVehicleFinance, saveVehicleFinance } from "@/lib/vehicle-finance.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { readStoredExperience } from "@/lib/experience";
import { SectionCard, MicroLabel, StatusPill, EmptyState } from "./ui";
import { Row, TwoCol, Text, Area, NumberField, DateInput, Choice } from "./VehicleProfileFields";
import { VehicleEditDrawer } from "./VehicleEditDrawer";
import { ShareVehicleDialog } from "./ShareVehicleDialog";
import { VehicleEditorDrawer } from "./VehicleEditorDrawer";
import { VehicleDocuments } from "./VehicleDocuments";
import { ApplyTemplateDialog } from "./ApplyTemplateDialog";
import { VehiclePhotos } from "./VehiclePhotos";
import { VehicleService } from "./VehicleService";
import { VehicleTimeline } from "./VehicleTimeline";
import { rentalReadyItems, listingReadyItems, profileItems, percent, vehicleReadinessChecks, listingPhotoCheck, overallReadiness, readinessByCategory, vehicleAvailability, type ReadinessCheck, type FixTarget } from "@/lib/vehicle-readiness";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { usStateOptions } from "@/lib/us-states";

// The vehicle as a record you read.
//
// Everything about one car already existed somewhere — documents, rentals,
// inspections, maintenance, expenses, audit — and the answer to "what is the
// story with RR-003" was to open six screens. This is the one screen. It reads
// from those systems rather than keeping its own copy of anything.
//
// The shape is deliberate: a page of labelled values, and editing behind a
// drawer per domain. A form with sixty inputs is a page nobody can scan and
// everybody is slightly afraid of. You should be able to open this to check a
// plate expiry without feeling like you are inside a database.

type Tab = "overview" | "service" | "timeline" | "photos" | "documents" | "insurance" | "dmv" | "gps" | "keys";

const TABS: Array<{ key: Tab; label: string; icon: any }> = [
  { key: "overview", label: "Overview", icon: Car },
  { key: "service", label: "Service", icon: Wrench },
  { key: "timeline", label: "Timeline", icon: History },
  { key: "photos", label: "Photos", icon: Images },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "insurance", label: "Insurance", icon: ShieldCheck },
  { key: "dmv", label: "DMV", icon: ScrollText },
  { key: "gps", label: "GPS", icon: Satellite },
  { key: "keys", label: "Keys", icon: KeyRound },
];

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? null
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const date = (v: unknown) =>
  !v
    ? null
    : fmtDate(String(v).slice(0, 10) + "T00:00:00");

const when = (v: unknown) =>
  !v
    ? null
    : fmtDateTime(String(v));

const miles = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : `${Number(v).toLocaleString()} mi`;

const titleCase = (v: unknown) =>
  !v
    ? null
    : String(v)
        .replace(/_/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase());

export function VehicleProfile({
  vehicleId,
  onClose,
  onChanged,
}: {
  vehicleId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const load = useServerFn(getVehicleProfile);
  const [tab, setTab] = useState<Tab>("overview");
  // How many extracted details are waiting, and a nudge to open the review.
  // The header already renders VehicleSuggestions, so the Readiness card
  // borrows its count rather than fetching the same list again.
  const [pendingDetails, setPendingDetails] = useState(0);
  const [openSuggest, setOpenSuggest] = useState(0);
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<VehicleSection | "finance" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await load({ data: { id: vehicleId } });
      setP(res);
      setFailed(res === null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [load, vehicleId]);

  useEffect(() => {
    void refresh();
    const h = () => { void refresh(); onChanged?.(); };
    window.addEventListener("vehicle-profile-refresh", h);
    return () => window.removeEventListener("vehicle-profile-refresh", h);
  }, [refresh, onChanged]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !editing && !sharing && !editorOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing, sharing, editorOpen]);

  async function afterSave() {
    setEditing(null);
    await refresh();
    onChanged?.();
  }

  const v = p?.vehicle ?? {};
  const photo = resolvePhotoUrl((v.photos as string[] | null)?.[0]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-0 sm:p-4 overflow-y-auto"
      // Only a click on the backdrop itself closes the record. The edit drawer
      // and the share sheet render inside this element, so a plain onClick here
      // would count every click inside them as a click outside — type half a
      // policy number, click the next field, lose the page behind you.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-[#FAFAFB] w-full max-w-5xl rounded-none sm:rounded-2xl min-h-full sm:min-h-0 sm:my-2 overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- header ---------------------------------------------------- */}
        <header className="bg-white border-b border-[#EDEDF0] px-5 sm:px-6 pt-4 pb-0">
          <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[13px] min-w-0">
            <button onClick={onClose} className="inline-flex items-center gap-1.5 text-[#55555E] hover:text-[#111114] font-medium shrink-0">
              <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
              Vehicles
            </button>
            <span className="text-[#B0B0B8]">/</span>
            <span className="text-[#111114] font-semibold truncate">{p?.unitLabel ?? "…"}</span>
          </nav>
          <div className="flex flex-wrap sm:flex-nowrap items-start gap-x-4 gap-y-3">
            <div className="h-12 w-16 sm:h-16 sm:w-24 shrink-0 rounded-lg bg-[#F4F4F6] overflow-hidden grid place-items-center">
              {photo ? (
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <Car className="w-5 h-5 text-[#C4C4CB]" strokeWidth={1.75} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {loading && !p ? (
                <div className="h-6 w-56 rounded bg-[#F4F4F6] animate-pulse" />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[19px] font-semibold text-[#111114] truncate">
                      {p?.unitLabel ?? "Vehicle"}
                    </h2>
                    {v.status && <StatusPill status={String(v.status)} />}
                    {!p?.isActive && (
                      <span className="text-[11px] text-[#9A9AA3]">Out of fleet</span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#55555E] mt-1 truncate">
                    {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}
                    {v.color ? ` · ${v.color}` : ""}
                    {p?.vinLast4 ? ` · VIN …${p.vinLast4}` : ""}
                    {v.license_plate ? ` · ${v.license_plate}` : ""}
                  </div>
                  <VehicleSuggestions
                    vehicleId={vehicleId}
                    canEdit={!!p?.canEdit}
                    onApplied={refresh}
                    onCount={setPendingDetails}
                    openSignal={openSuggest}
                  />
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto order-last sm:order-none">
              {p?.canEdit && (
                <button
                  onClick={() => setEditorOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#D03020] px-3.5 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit Vehicle
                </button>
              )}
              <button
                onClick={() => setSharing(true)}
                disabled={!p}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111114] hover:bg-[#FAFAFB] transition-colors disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Share</span>
              </button>
              <button
                onClick={onClose}
                className="rounded-md p-1.5 text-[#9A9AA3] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
                aria-label="Close"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* ---- alerts ---------------------------------------------------- */}
          {!!p?.alerts.length && (
            <div className="flex flex-wrap gap-2 mt-4">
              {p.alerts.map((a) => (
                <span
                  key={a.what}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={
                    a.days < 0
                      ? { backgroundColor: "rgba(208,48,32,0.08)", color: "#D03020" }
                      : { backgroundColor: "rgba(240,192,64,0.08)", color: "#C68A12" }
                  }
                >
                  <AlertTriangle className="w-3 h-3" />
                  {a.what}{" "}
                  {a.days < 0 ? `expired ${Math.abs(a.days)}d ago` : `expires in ${a.days}d`}
                </span>
              ))}
            </div>
          )}

          {/* ---- tabs ------------------------------------------------------ */}
          <nav className="flex gap-1 mt-4 -mb-px overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors ${
                    active
                      ? "border-[#D03020] text-[#111114] font-medium"
                      : "border-transparent text-[#9A9AA3] hover:text-[#55555E]"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {t.label}
                  {t.key === "documents" && !!p?.counts.documents && (
                    <span className="ml-0.5 rounded-full bg-[#F4F4F6] px-1.5 text-[10px] text-[#55555E]">
                      {p.counts.documents}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        {/* ---- body -------------------------------------------------------- */}
        <div className="p-5 sm:p-6">
          {loading && !p ? (
            <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[#9A9AA3]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading the record…
            </div>
          ) : failed || !p ? (
            <EmptyState
              icon={<Car className="w-6 h-6" strokeWidth={1.75} />}
              title="This vehicle could not be loaded"
              hint="It may have been removed, or your account may not have access to the fleet."
            />
          ) : (
            <>
              {tab === "overview" && (
                <Overview
                  p={p}
                  onEdit={setEditing}
                  onOpenTab={setTab}
                  onRefresh={refresh}
                  pendingDetails={pendingDetails}
                  onReviewDetails={() => setOpenSuggest((n) => n + 1)}
                />
              )}
              {tab === "service" && <VehicleService vehicleId={vehicleId} />}
              {tab === "timeline" && <VehicleTimeline vehicleId={vehicleId} />}
              {tab === "photos" && <VehiclePhotos vehicleId={vehicleId} canEdit={p.canEdit} />}
              {tab === "documents" && (
                <SectionCard
                  title="Paperwork"
                  icon={<FileText className="w-4 h-4" strokeWidth={1.75} />}
                >
                  <VehicleDocuments
                    vehicleId={vehicleId}
                    bare
                    canEdit={!!p.canEdit}
                    vehicleLabel={[v.unit_number, [v.year, v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "This Vehicle"}
                    // Accepting details from the upload dialog writes vehicle
                    // fields, so the profile — and the Readiness checklist it
                    // feeds — has to be re-read. Same refresh the header's
                    // suggestion pill already uses.
                    onVehicleChanged={refresh}
                  />
                </SectionCard>
              )}
              {tab === "insurance" && <Insurance p={p} onEdit={() => setEditing("insurance")} />}
              {tab === "dmv" && <Dmv p={p} onEdit={() => setEditing("dmv")} />}
              {tab === "gps" && <Gps p={p} onEdit={() => setEditing("gps")} />}
              {tab === "keys" && <Keys p={p} onEdit={() => setEditing("keys")} />}
            </>
          )}
        </div>
      </div>

      {editing && editing !== "finance" && p && (
        <SectionDrawer
          // Remounted per section: a drawer handed over from another one
          // starts from the saved record, never from abandoned edits.
          key={editing}
          section={editing}
          vehicleId={vehicleId}
          vehicle={p.vehicle}
          canTitle={p.canSeeFinance}
          onClose={() => setEditing(null)}
          onSaved={afterSave}
          onOpenSection={(s) => setEditing(s)}
        />
      )}
      {editing === "finance" && p && (
        <FinanceDrawer vehicleId={vehicleId} onClose={() => setEditing(null)} onSaved={afterSave} />
      )}
      {sharing && <ShareVehicleDialog vehicleId={vehicleId} onClose={() => setSharing(false)} />}
      {editorOpen && p && (
        <VehicleEditorDrawer
          profile={{ ...p, id: vehicleId }}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            await refresh();
            onChanged?.();
          }}
          onOpenTab={(t) => {
            setEditorOpen(false);
            setTab(t);
          }}
        />
      )}
    </div>
  );
}

// ---- edit affordance ------------------------------------------------------

function EditButton({ onClick, show }: { onClick: () => void; show: boolean }) {
  if (!show) return null;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] text-[#55555E] hover:text-[#D03020] hover:bg-[#FAFAFB] transition-colors"
    >
      <Pencil className="w-3 h-3" /> Edit
    </button>
  );
}

/**
 * A count that leads somewhere.
 *
 * The destination list is not filtered to this vehicle — those panels have
 * their own search — so the number stays here, where it is specific, and the
 * link only saves the trip through the sidebar.
 */
function Elsewhere({ tab, count, label }: { tab: string; count: number; label: string }) {
  if (!count) return <span className="text-[#C4C4CB]">None</span>;
  return (
    <Link
      to="/admin"
      search={{ tab } as never}
      className="inline-flex items-center gap-1 hover:text-[#D03020] transition-colors"
      title={label}
    >
      {count} <ArrowUpRight className="w-3 h-3" />
    </Link>
  );
}

// ---- tabs -----------------------------------------------------------------

function Overview({
  p,
  onEdit,
  onOpenTab,
  onRefresh,
  pendingDetails,
  onReviewDetails,
}: {
  p: Profile;
  onEdit: (s: VehicleSection | "finance") => void;
  onOpenTab: (t: Tab) => void;
  /** Extracted details waiting for staff confirmation. */
  pendingDetails?: number;
  onReviewDetails?: () => void;
  onRefresh?: () => void;
}) {
  const v = p.vehicle;
  const [applyOpen, setApplyOpen] = useState(false);
  // Core identity rows always show ("—" when empty); optional rows only when filled.
  const optional: [string, React.ReactNode][] = ([
    ["Trim", v.trim],
    ["Color", v.color],
    ["Seats", v.seats],
    ["Doors", v.doors],
    ["Fuel", titleCase(v.fuel_type)],
    ["MPG", v.mpg],
    ["Range per Tank", miles(v.miles_per_tank)],
    ["Partner", p.partnerName],
    ["Platforms", Array.isArray(v.uber_eligibility) && v.uber_eligibility.length ? v.uber_eligibility.join(", ") : null],
  ] as [string, React.ReactNode][]).filter(([, val]) => val != null && val !== "");
  const plate = v.license_plate ? `${v.plate_state ? `${v.plate_state} ` : ""}${v.license_plate}` : null;
  const quiet = !p.currentRental && !p.nextService && !p.counts.openMaintenance;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <ReadinessChecklist p={p} onEdit={onEdit} onOpenTab={onOpenTab} pendingDetails={pendingDetails ?? 0} onReviewDetails={onReviewDetails} />
        <SectionCard
          title="Vehicle Details"
          icon={<Car className="w-4 h-4" strokeWidth={1.75} />}
          right={<EditButton show={p.canEdit} onClick={() => onEdit("identity")} />}
        >
          <TwoCol>
            <div>
              <Row label="Unit Number" value={v.unit_number} />
              <Row label="Year" value={v.year} />
              <Row label="Make" value={v.make} />
              <Row label="Model" value={v.model} />
              <Row label="Body Type" value={titleCase(v.body_type)} />
            </div>
            <div>
              <Row label="VIN" value={v.vin} mono />
              <Row label="Plate" value={plate} mono />
              <Row label="Mileage" value={miles(v.current_odometer)} />
              <Row label="Status" value={v.status ? <StatusPill status={String(v.status)} /> : null} />
            </div>
          </TwoCol>
          {optional.length > 0 && (
            <div className="mt-2">
              <TwoCol>
                <div>{optional.filter((_, i) => i % 2 === 0).map(([l, val]) => <Row key={l} label={l} value={val} />)}</div>
                <div>{optional.filter((_, i) => i % 2 === 1).map(([l, val]) => <Row key={l} label={l} value={val} />)}</div>
              </TwoCol>
            </div>
          )}
          {v.description && (
            <div className="mt-4 pt-4 border-t border-[#F4F4F6]">
              <MicroLabel className="mb-1.5">Listing Description</MicroLabel>
              <p className="text-[13px] text-[#55555E] leading-relaxed">{String(v.description)}</p>
            </div>
          )}
          {v.internal_notes && (
            <div className="mt-4 pt-4 border-t border-[#F4F4F6]">
              <MicroLabel className="mb-1.5">Internal Notes</MicroLabel>
              <p className="text-[13px] text-[#55555E] leading-relaxed whitespace-pre-wrap">{String(v.internal_notes)}</p>
              <div className="text-[11px] text-[#9A9AA3] mt-1.5">Never shown to renters or partners.</div>
            </div>
          )}
        </SectionCard>

        {p.canSeeFinance && readStoredExperience() !== "admin" && (p.finance !== null || p.canEdit) ? (
          <SectionCard
            title="Acquisition & Financing"
            subtitle="Owner Only"
            icon={<Lock className="w-4 h-4" strokeWidth={1.75} />}
            right={<EditButton show={p.canEdit} onClick={() => onEdit("finance")} />}
          >
            {p.finance ? (
              <TwoCol>
                <div>
                  <Row label="Ownership" value={titleCase(p.finance.ownership_type)} />
                  <Row label="Legal Owner" value={p.finance.legal_owner} />
                  <Row label="Seller / Dealer" value={p.finance.seller_dealer} />
                  <Row label="Lienholder" value={p.finance.lienholder} />
                  <Row label="Purchased" value={date(p.finance.purchase_date)} />
                </div>
                <div>
                  <Row label="Purchase Price" value={money(p.finance.purchase_price)} />
                  <Row label="Loan / Lease Ref" value={p.finance.loan_reference} mono />
                  <Row label="Payoff" value={money(p.finance.payoff_amount)} />
                  <Row label="Monthly Payment" value={money(p.finance.monthly_payment)} />
                  <Row label="Matures" value={date(p.finance.loan_maturity_date)} />
                </div>
              </TwoCol>
            ) : (
              <div className="text-[13px] text-[#9A9AA3] py-1">Nothing recorded yet.</div>
            )}
          </SectionCard>
        ) : null}
      </div>

      <div className="space-y-5">
        <SectionCard title="Rates" icon={<Car className="w-4 h-4" strokeWidth={1.75} />} right={<EditButton show={p.canEdit} onClick={() => onEdit("identity")} />}>
          <Row label="Weekly" value={money(v.weekly_rate) ?? "Not Set"} />
          <Row label="Monthly" value={money(v.monthly_rate) ?? "Not Set"} />
          <Row label="Deposit" value={v.deposit == null ? "Not Set" : Number(v.deposit) === 0 ? "$0" : money(v.deposit)} />
          {p.canEdit && (
            <>
              <button onClick={() => setApplyOpen(true)} className="mt-2 h-7 px-2.5 rounded-lg text-[12px] font-medium border border-border bg-background hover:bg-muted">Apply Template</button>
              <ApplyTemplateDialog vehicleId={v.id} open={applyOpen} onOpenChange={setApplyOpen} onApplied={() => onRefresh?.()} />
            </>
          )}
        </SectionCard>

        <SectionCard title="Right Now" icon={<Wrench className="w-4 h-4" strokeWidth={1.75} />}>
          {quiet && <div className="text-[13px] text-[#9A9AA3] pb-1">Not on rental. Nothing open.</div>}
          {p.currentRental && <Row label="Rental" value={`${p.currentRental.driver_name ?? "Driver"} · since ${date(p.currentRental.start_date)}`} />}
          {p.nextService && (
            <Row label="Next Service" value={`${p.nextService.item}${p.nextService.due_date ? ` · ${date(p.nextService.due_date)}` : ""}${p.nextService.due_mileage ? ` · ${miles(p.nextService.due_mileage)}` : ""}`} />
          )}
          {p.counts.openMaintenance > 0 && <Row label="Open Maintenance" value={p.counts.openMaintenance} />}
          <Row label="Service" value={<button onClick={() => onOpenTab("service")} className="text-[13px] font-medium underline-offset-2 hover:underline">View Service</button>} />
          <Row label="Inspections" value={<Elsewhere tab="inspections" count={p.counts.inspections} label="View Inspections" />} />
          <Row label="Rentals to Date" value={<Elsewhere tab="drivers" count={p.counts.rentals} label="View Rental History" />} />
        </SectionCard>

        {p.financials && (
          <SectionCard title="Lifetime P&L" subtitle="Owner Only" icon={<Lock className="w-4 h-4" strokeWidth={1.75} />}>
            <Row label="Revenue" value={money(p.financials.revenue)} />
            <Row label="Expenses" value={money(p.financials.expenses)} />
            <Row label="Maintenance" value={money(p.financials.maintenance)} />
            <Row label="Net" value={<span className={p.financials.net >= 0 ? "text-[#1E7B3C] font-medium" : "text-[#D03020] font-medium"}>{money(p.financials.net)}</span>} />
            <Row label="Days on Rent" value={p.financials.days_on_rent || null} />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function Insurance({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const v = p.vehicle;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <SectionCard
        title="Policy"
        icon={<ShieldCheck className="w-4 h-4" strokeWidth={1.75} />}
        right={<EditButton show={p.canEdit} onClick={onEdit} />}
      >
        <Row label="Carrier" value={v.insurance_carrier} />
        <Row label="Policy Number" value={v.insurance_policy_number} mono />
        <Row label="Coverage" value={v.insurance_coverage} />
        <Row label="Expires" value={date(v.insurance_expires_on)} />
        <Row
          label="Status"
          value={v.insurance_status ? <StatusPill status={String(v.insurance_status)} /> : null}
        />
      </SectionCard>

      <SectionCard title="Agent" icon={<ShieldCheck className="w-4 h-4" strokeWidth={1.75} />}>
        <Row label="Name" value={v.insurance_agent_name} />
        <Row
          label="Phone"
          value={
            v.insurance_agent_phone ? (
              <a className="hover:text-[#D03020]" href={`tel:${v.insurance_agent_phone}`}>
                {String(v.insurance_agent_phone)}
              </a>
            ) : null
          }
        />
        <Row
          label="Email"
          value={
            v.insurance_agent_email ? (
              <a className="hover:text-[#D03020]" href={`mailto:${v.insurance_agent_email}`}>
                {String(v.insurance_agent_email)}
              </a>
            ) : null
          }
        />
        <div className="mt-3 text-[11px] text-[#9A9AA3]">
          The insurance card itself belongs in Documents, where its expiry drives the warnings
          above.
        </div>
      </SectionCard>
    </div>
  );
}

function Dmv({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const v = p.vehicle;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <SectionCard
        title="Plate & Registration"
        icon={<ScrollText className="w-4 h-4" strokeWidth={1.75} />}
        right={<EditButton show={p.canEdit} onClick={onEdit} />}
      >
        <Row label="Plate" value={v.license_plate} mono />
        <Row label="Plate State" value={v.plate_state} />
        <Row label="Plate Expires" value={date(v.plate_expires_on)} />
        <Row label="Registration #" value={v.registration_number} mono />
        <Row label="Registration State" value={v.registration_state} />
        <Row label="Registration Expires" value={date(v.registration_expires_on)} />
      </SectionCard>

      <SectionCard
        title="Title & Identity"
        icon={<ScrollText className="w-4 h-4" strokeWidth={1.75} />}
      >
        <Row label="VIN" value={v.vin} mono />
        {/* Document and metadata are separate facts and every tier sees both
            the same way. The NUMBER and the STATUS stay Owner-only, and a
            document on file never implies the title has been verified. */}
        <Row label="Title Document" value={p.title?.documentOnFile ? "On File" : "Not On File"} />
        <Row label="Title Details" value={p.title?.metadataRecorded ? "Recorded" : "Not Recorded"} />
        {p.canSeeFinance && (
          <>
            <Row label="Title Status" value={titleCase(v.title_status)} />
            <Row label="Title Number" value={v.title_number} mono />
          </>
        )}
        <div className="mt-3 text-[11px] text-[#9A9AA3]">
          Changing a VIN or plate is recorded in Activity with what it was before.
        </div>
      </SectionCard>
    </div>
  );
}

function Gps({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const v = p.vehicle;
  const loc = v.gps_last_location as Record<string, any> | null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <SectionCard
        title="Device"
        icon={<Satellite className="w-4 h-4" strokeWidth={1.75} />}
        right={<EditButton show={p.canEdit} onClick={onEdit} />}
      >
        <Row label="Provider" value={v.gps_provider} />
        <Row
          label="Status"
          value={v.gps_status ? <StatusPill status={String(v.gps_status)} /> : null}
        />
        <Row label="Device ID" value={v.gps_device_id} mono />
        <Row label="Serial" value={v.gps_serial} mono />
        <Row label="IMEI" value={v.gps_imei} mono />
        <Row label="SIM" value={v.gps_sim} mono />
        <Row label="Installed" value={date(v.gps_installed_on)} />
        <Row
          label="Tracking Link"
          value={
            v.gps_tracking_url ? (
              <a
                href={String(v.gps_tracking_url)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 hover:text-[#D03020]"
              >
                Open <ExternalLink className="w-3 h-3" />
              </a>
            ) : null
          }
        />
        {v.gps_install_notes && (
          <div className="mt-3 pt-3 border-t border-[#F4F4F6]">
            <MicroLabel className="mb-1.5">Install notes</MicroLabel>
            <p className="text-[13px] text-[#55555E] whitespace-pre-wrap">
              {String(v.gps_install_notes)}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Last Reported"
        subtitle="Written by a provider adapter, never by this app"
        icon={<Satellite className="w-4 h-4" strokeWidth={1.75} />}
      >
        <Row label="Last Ping" value={when(v.gps_last_ping_at)} />
        <Row
          label="Location"
          value={
            loc?.address ?? (loc?.lat != null && loc?.lng != null ? `${loc.lat}, ${loc.lng}` : null)
          }
        />
        <Row label="Reported Odometer" value={miles(v.gps_odometer)} />
        <Row label="Battery" value={v.gps_battery} />
        <Row label="Geofence" value={titleCase(v.gps_geofence_status)} />
        {!v.gps_last_ping_at && (
          <div className="mt-3 text-[11px] text-[#9A9AA3]">
            No adapter is reporting yet. Empty here means nothing has been received — not that the
            car is stationary.
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Keys({ p, onEdit }: { p: Profile; onEdit: () => void }) {
  const v = p.vehicle;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <SectionCard
        title="Keys"
        icon={<KeyRound className="w-4 h-4" strokeWidth={1.75} />}
        right={<EditButton show={p.canEdit} onClick={onEdit} />}
      >
        <Row label="Keys Held" value={v.key_count} />
        <Row
          label="Spare"
          value={v.spare_key === true ? "Yes" : v.spare_key === false ? "No" : null}
        />
        <Row label="Type" value={titleCase(v.key_type)} />
        <Row label="Tag" value={v.key_tag} mono />
        <Row label="Stored At" value={v.key_location} />
      </SectionCard>

      <SectionCard title="Notes" icon={<KeyRound className="w-4 h-4" strokeWidth={1.75} />}>
        {v.key_notes ? (
          <p className="text-[13px] text-[#55555E] whitespace-pre-wrap">{String(v.key_notes)}</p>
        ) : (
          <div className="text-[13px] text-[#9A9AA3]">Nothing recorded.</div>
        )}
        <div className="mt-3 text-[11px] text-[#9A9AA3]">
          Key locations are never included in a shared vehicle summary.
        </div>
      </SectionCard>
    </div>
  );
}

// ---- section drawer -------------------------------------------------------

const SECTION_META: Record<VehicleSection, { title: string; subtitle: string; icon: any }> = {
  identity: { title: "Edit Details", subtitle: "Identity, specs, status and rates", icon: Car },
  insurance: { title: "Edit Insurance", subtitle: "Policy and agent", icon: ShieldCheck },
  dmv: {
    title: "Edit Registration & Title",
    subtitle: "Plate, registration, VIN and title",
    icon: ScrollText,
  },
  gps: { title: "Edit GPS", subtitle: "Device and installation", icon: Satellite },
  keys: { title: "Edit Keys", subtitle: "Count, type and where they live", icon: KeyRound },
  service: { title: "Edit Service & Tolls", subtitle: "Intervals and toll accounts", icon: Wrench },
};

function SectionDrawer({
  section,
  vehicleId,
  vehicle,
  canTitle = false,
  onClose,
  onSaved,
  onOpenSection,
}: {
  section: VehicleSection;
  vehicleId: string;
  vehicle: Record<string, any>;
  canTitle?: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Hand over to another section's drawer — the paperwork is next door. */
  onOpenSection?: (s: VehicleSection) => void;
}) {
  const save = useServerFn(updateVehicleSection);
  const [f, setF] = useState<Record<string, any>>(() => ({ ...vehicle }));
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  const [touched, setTouched] = useState(false);
  useUnsavedGuard("vehicle-section-drawer", touched);
  const set = (k: string, v: any) => { setTouched(true); setF((s) => ({ ...s, [k]: v })); };
  const str = (k: string) => (f[k] === null || f[k] === undefined ? "" : String(f[k]));
  const num = (k: string) =>
    f[k] === null || f[k] === undefined || f[k] === "" ? null : Number(f[k]);
  const day = (k: string) => (f[k] ? String(f[k]).slice(0, 10) : "");
  const err = (k: string) => (fieldError?.field === k ? fieldError.message : undefined);

  const meta = SECTION_META[section];

  async function submit() {
    setSaving(true);
    setFieldError(null);
    try {
      const res = await save({ data: { id: vehicleId, section, values: f } });
      if (!res.ok) {
        setFieldError({ field: res.field, message: res.error ?? "Could not save." });
        if (!res.field) toast.error(res.error ?? "Could not save.");
        return;
      }
      toast.success("Saved");
      await onSaved();
    } catch (e) {
      toast.error(
        e instanceof Error && e.message === "Forbidden"
          ? "Editing a vehicle is Manager-only."
          : "Could not save.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <VehicleEditDrawer
      title={meta.title}
      subtitle={meta.subtitle}
      icon={<meta.icon className="w-4 h-4" strokeWidth={1.75} />}
      saving={saving}
      onClose={onClose}
      onSave={submit}
    >
      {fieldError && !fieldError.field && (
        <div className="rounded-md bg-[rgba(208,48,32,0.08)] px-3 py-2 text-[12px] text-[#D03020]">
          {fieldError.message}
        </div>
      )}

      {section === "identity" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Text
              label="Unit Number"
              value={str("unit_number")}
              onChange={(v) => set("unit_number", v)}
              error={err("unit_number")}
              placeholder="RR-001"
            />
            <NumberField label="Year" value={num("year")} onChange={(v) => set("year", v)} />
            <Text label="Make" value={str("make")} onChange={(v) => set("make", v)} />
            <Text label="Model" value={str("model")} onChange={(v) => set("model", v)} />
            <Text label="Trim" value={str("trim")} onChange={(v) => set("trim", v)} />
            <Text label="Color" value={str("color")} onChange={(v) => set("color", v)} />
            <Choice
              label="Body Type"
              value={str("body_type")}
              onChange={(v) => set("body_type", v)}
              options={[
                { value: "", label: "—" },
                ...BODY_TYPES.map((b) => ({ value: b, label: b })),
              ]}
            />
            <Text
              label="License Plate"
              value={str("license_plate")}
              onChange={(v) => set("license_plate", v)}
              error={err("license_plate")}
              mono
              hint="As printed on the tag."
            />
            <Choice
              label="Plate State"
              value={str("plate_state")}
              onChange={(v) => set("plate_state", v)}
              options={usStateOptions()}
              error={err("plate_state")}
            />
            <Choice
              label="Status"
              value={str("status")}
              onChange={(v) => set("status", v)}
              options={VEHICLE_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            />
            <NumberField label="Seats" value={num("seats")} onChange={(v) => set("seats", v)} />
            <NumberField label="Doors" value={num("doors")} onChange={(v) => set("doors", v)} />
            <Text label="Fuel" value={str("fuel_type")} onChange={(v) => set("fuel_type", v)} />
            <NumberField label="MPG" value={num("mpg")} onChange={(v) => set("mpg", v)} />
            <NumberField
              label="Range per Tank"
              value={num("miles_per_tank")}
              onChange={(v) => set("miles_per_tank", v)}
              suffix="mi"
            />
            <NumberField
              label="Odometer"
              value={num("current_odometer")}
              onChange={(v) => set("current_odometer", v)}
              suffix="mi"
            />
            <NumberField
              label="Weekly Rate"
              value={num("weekly_rate")}
              onChange={(v) => set("weekly_rate", v)}
              suffix="$"
              error={err("weekly_rate")}
            />
            <NumberField
              label="Monthly Rate"
              value={num("monthly_rate")}
              onChange={(v) => set("monthly_rate", v)}
              suffix="$"
            />
            <NumberField
              label="Deposit"
              value={num("deposit")}
              onChange={(v) => set("deposit", v)}
              suffix="$"
            />
          </div>
          <Area
            label="Listing Description"
            value={str("description")}
            onChange={(v) => set("description", v)}
            hint="Shown on the public fleet page."
          />
          <Area
            label="Internal Notes"
            value={str("internal_notes")}
            onChange={(v) => set("internal_notes", v)}
            hint="Never leaves the back office."
          />
          {/* The plate is above because the Vehicle Details card shows it.
              VIN, the registration number and the expiry dates are paperwork
              and keep their own drawer — this is the door to it, so nobody
              has to work out which tab holds the expiration date. */}
          {onOpenSection && (
            <button
              type="button"
              data-testid="identity-open-dmv"
              onClick={() => {
                if (!confirmLeaveIfUnsaved()) return;
                onOpenSection("dmv");
              }}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#EDEDF0] bg-white px-3 py-2.5 text-[13px] text-[#55555E] hover:bg-[#F4F4F6] transition-colors"
            >
              <span className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-[#9A9AA3]" strokeWidth={1.75} />
                VIN, Registration Expiration &amp; Title
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#9A9AA3]" strokeWidth={1.75} />
            </button>
          )}
        </>
      )}

      {section === "insurance" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Text
              label="Carrier"
              value={str("insurance_carrier")}
              onChange={(v) => set("insurance_carrier", v)}
            />
            <Text
              label="Policy Number"
              value={str("insurance_policy_number")}
              onChange={(v) => set("insurance_policy_number", v)}
              mono
            />
            <Text
              label="Coverage"
              value={str("insurance_coverage")}
              onChange={(v) => set("insurance_coverage", v)}
              placeholder="Commercial, full"
            />
            <DateInput
              label="Expires"
              value={day("insurance_expires_on")}
              onChange={(v) => set("insurance_expires_on", v)}
            />
            <Choice
              label="Status"
              value={str("insurance_status")}
              onChange={(v) => set("insurance_status", v)}
              options={[
                { value: "", label: "—" },
                { value: "active", label: "Active" },
                { value: "lapsed", label: "Lapsed" },
                { value: "pending", label: "Pending" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
          </div>
          <div className="pt-1">
            <MicroLabel className="mb-2">Agent</MicroLabel>
            <div className="grid grid-cols-2 gap-3">
              <Text
                label="Name"
                value={str("insurance_agent_name")}
                onChange={(v) => set("insurance_agent_name", v)}
              />
              <Text
                label="Phone"
                value={str("insurance_agent_phone")}
                onChange={(v) => set("insurance_agent_phone", v)}
              />
              <Text
                label="Email"
                value={str("insurance_agent_email")}
                onChange={(v) => set("insurance_agent_email", v)}
              />
            </div>
          </div>
        </>
      )}

      {section === "dmv" && (
        <div className="grid grid-cols-2 gap-3">
          <Text
            label="VIN"
            value={str("vin")}
            onChange={(v) => set("vin", v)}
            error={err("vin")}
            mono
            hint="17 characters. Never I, O or Q."
          />
          <Text
            label="Plate"
            value={str("license_plate")}
            onChange={(v) => set("license_plate", v)}
            error={err("license_plate")}
            mono
          />
          <Choice
            label="Plate State"
            value={str("plate_state")}
            onChange={(v) => set("plate_state", v)}
            options={usStateOptions()}
            error={err("plate_state")}
          />
          <DateInput
            label="Plate Expires"
            value={day("plate_expires_on")}
            onChange={(v) => set("plate_expires_on", v)}
          />
          <Text
            label="Registration #"
            value={str("registration_number")}
            onChange={(v) => set("registration_number", v)}
            mono
          />
          <Text
            label="Registration State"
            value={str("registration_state")}
            onChange={(v) => set("registration_state", v)}
          />
          <DateInput
            label="Registration Expires"
            value={day("registration_expires_on")}
            onChange={(v) => set("registration_expires_on", v)}
          />
          {canTitle && (<>
          <Choice
            label="Title Status"
            value={str("title_status")}
            onChange={(v) => set("title_status", v)}
            options={[
              { value: "", label: "—" },
              { value: "clean", label: "Clean" },
              { value: "financed", label: "Financed" },
              { value: "lien", label: "Lien" },
              { value: "salvage", label: "Salvage" },
              { value: "rebuilt", label: "Rebuilt" },
            ]}
          />
          <Text
            label="Title Number"
            value={str("title_number")}
            onChange={(v) => set("title_number", v)}
            mono
          />
          </>)}
        </div>
      )}

      {section === "gps" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Text
              label="Provider"
              value={str("gps_provider")}
              onChange={(v) => set("gps_provider", v)}
            />
            <Choice
              label="Status"
              value={str("gps_status")}
              onChange={(v) => set("gps_status", v)}
              options={[
                { value: "", label: "—" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
                { value: "fault", label: "Fault" },
                { value: "removed", label: "Removed" },
                { value: "not_installed", label: "Not Installed" },
              ]}
            />
            <Text
              label="Device ID"
              value={str("gps_device_id")}
              onChange={(v) => set("gps_device_id", v)}
              mono
            />
            <Text
              label="Serial"
              value={str("gps_serial")}
              onChange={(v) => set("gps_serial", v)}
              mono
            />
            <Text label="IMEI" value={str("gps_imei")} onChange={(v) => set("gps_imei", v)} mono />
            <Text label="SIM" value={str("gps_sim")} onChange={(v) => set("gps_sim", v)} mono />
            <DateInput
              label="Installed"
              value={day("gps_installed_on")}
              onChange={(v) => set("gps_installed_on", v)}
            />
            <Text
              label="Geofence"
              value={str("gps_geofence_status")}
              onChange={(v) => set("gps_geofence_status", v)}
            />
          </div>
          <Text
            label="Tracking Link"
            value={str("gps_tracking_url")}
            onChange={(v) => set("gps_tracking_url", v)}
            placeholder="https://"
          />
          <Area
            label="Install Notes"
            value={str("gps_install_notes")}
            onChange={(v) => set("gps_install_notes", v)}
            rows={2}
          />
        </>
      )}

      {section === "keys" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Keys Held"
              value={num("key_count")}
              onChange={(v) => set("key_count", v)}
            />
            <Text
              label="Type"
              value={str("key_type")}
              onChange={(v) => set("key_type", v)}
              placeholder="Fob, smart, blade"
            />
            <Text label="Tag" value={str("key_tag")} onChange={(v) => set("key_tag", v)} mono />
            <Text
              label="Stored At"
              value={str("key_location")}
              onChange={(v) => set("key_location", v)}
              placeholder="Hook 4, back office"
            />
          </div>
          <Choice
            label="Spare Key"
            value={f.spare_key === true ? "true" : f.spare_key === false ? "false" : ""}
            onChange={(v) => set("spare_key", v === "" ? null : v === "true")}
            options={[
              { value: "", label: "Not Recorded" },
              { value: "true", label: "Yes — a Spare Exists" },
              { value: "false", label: "No Spare" },
            ]}
            hint="Left unrecorded until someone actually checks."
          />
          <Area
            label="Notes"
            value={str("key_notes")}
            onChange={(v) => set("key_notes", v)}
            rows={2}
          />
        </>
      )}
    </VehicleEditDrawer>
  );
}

// ---- finance drawer -------------------------------------------------------

function FinanceDrawer({
  vehicleId,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const load = useServerFn(getVehicleFinance);
  const save = useServerFn(saveVehicleFinance);
  const [f, setF] = useState<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    load({ data: { vehicle_id: vehicleId } })
      .then((r) => {
        if (live) {
          setF(r ? { ...r } : {});
          setReady(true);
        }
      })
      .catch(() => {
        if (live) {
          toast.error("Financing is Manager-only.");
          onClose();
        }
      });
    return () => {
      live = false;
    };
  }, [load, vehicleId, onClose]);

  const [touched, setTouched] = useState(false);
  useUnsavedGuard("vehicle-finance-drawer", touched);
  const set = (k: string, v: any) => { setTouched(true); setF((s) => ({ ...s, [k]: v })); };
  const str = (k: string) => (f[k] === null || f[k] === undefined ? "" : String(f[k]));
  const num = (k: string) =>
    f[k] === null || f[k] === undefined || f[k] === "" ? null : Number(f[k]);
  const day = (k: string) => (f[k] ? String(f[k]).slice(0, 10) : "");

  async function submit() {
    setSaving(true);
    try {
      const res = await save({
        data: {
          vehicle_id: vehicleId,
          ownership_type: (str("ownership_type") || null) as any,
          legal_owner: str("legal_owner") || null,
          seller_dealer: str("seller_dealer") || null,
          lienholder: str("lienholder") || null,
          purchase_date: day("purchase_date") || null,
          purchase_price: num("purchase_price"),
          loan_reference: str("loan_reference") || null,
          payoff_amount: num("payoff_amount"),
          monthly_payment: num("monthly_payment"),
          loan_maturity_date: day("loan_maturity_date") || null,
        },
      });
      if (!res.ok) return toast.error(res.error ?? "Could not save.");
      toast.success("Financing saved");
      await onSaved();
    } catch {
      toast.error("Financing is Manager-only.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <VehicleEditDrawer
      title="Edit Acquisition & Financing"
      subtitle="Stored apart from the vehicle record — Coordinators cannot read it"
      icon={<Lock className="w-4 h-4" strokeWidth={1.75} />}
      managerOnly
      saving={saving || !ready}
      onClose={onClose}
      onSave={submit}
    >
      {!ready ? (
        <div className="flex items-center gap-2 text-[13px] text-[#9A9AA3] py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Choice
            label="Ownership"
            value={str("ownership_type")}
            onChange={(v) => set("ownership_type", v)}
            options={[
              { value: "", label: "—" },
              ...OWNERSHIP_TYPES.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />
          <Text
            label="Legal Owner"
            value={str("legal_owner")}
            onChange={(v) => set("legal_owner", v)}
          />
          <Text
            label="Seller / Dealer"
            value={str("seller_dealer")}
            onChange={(v) => set("seller_dealer", v)}
          />
          <Text
            label="Lienholder"
            value={str("lienholder")}
            onChange={(v) => set("lienholder", v)}
          />
          <DateInput
            label="Purchase Date"
            value={day("purchase_date")}
            onChange={(v) => set("purchase_date", v)}
          />
          <NumberField
            label="Purchase Price"
            value={num("purchase_price")}
            onChange={(v) => set("purchase_price", v)}
            suffix="$"
          />
          <Text
            label="Loan / Lease Ref"
            value={str("loan_reference")}
            onChange={(v) => set("loan_reference", v)}
            mono
          />
          <NumberField
            label="Payoff"
            value={num("payoff_amount")}
            onChange={(v) => set("payoff_amount", v)}
            suffix="$"
          />
          <NumberField
            label="Monthly Payment"
            value={num("monthly_payment")}
            onChange={(v) => set("monthly_payment", v)}
            suffix="$"
          />
          <DateInput
            label="Matures"
            value={day("loan_maturity_date")}
            onChange={(v) => set("loan_maturity_date", v)}
          />
        </div>
      )}
    </VehicleEditDrawer>
  );
}

/**
 * Vehicle Readiness (Phase A, display only). Readiness and Availability are
 * independent: a car can be Ready and On Rent. Nothing here changes status.
 * Checks come from vehicle-readiness.ts; a future server function can supply
 * the same ReadinessCheck[] without changing this component.
 */
const CHECK_STYLE: Record<ReadinessCheck["status"], { dot: string; text: string; label: string }> = {
  ready: { dot: "bg-[#1E7B3C]", text: "text-[#1E7B3C]", label: "Ready" },
  attention: { dot: "bg-[#D97706]", text: "text-[#B45309]", label: "Needs Attention" },
  not_ready: { dot: "bg-[#D03020]", text: "text-[#B42318]", label: "Not Ready" },
  info: { dot: "bg-[#9A9AA3]", text: "text-[#55555E]", label: "Info" },
};
function ReadinessChecklist({ p, onEdit, onOpenTab, pendingDetails = 0, onReviewDetails }: { p: Profile; onEdit: (s: VehicleSection | "finance") => void; onOpenTab: (t: Tab) => void; pendingDetails?: number; onReviewDetails?: () => void }) {
  const v = p.vehicle;
  const facts = p.readinessFacts;
  const navigate = useNavigate();
  const save = useServerFn(updateVehicleSection);
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  if (!facts) return null;
  const checks = vehicleReadinessChecks(v, facts, p.profileContext?.docKinds ?? []);
  const overall = overallReadiness(checks);
  const avail = vehicleAvailability(String(v.status ?? ""), facts.hasActiveRental);
  const photo = listingPhotoCheck(p.counts.publishedPhotos ?? 0, p.counts.photos ?? 0);
  const st = CHECK_STYLE[overall];
  // Enforced minimum = the existing server rule (vehicle_rental_ready_missing).
  const minMissing = rentalReadyItems(v).filter((i) => !i.done);
  const meetsMinimum = minMissing.length === 0;
  const listing = listingReadyItems(v, p.counts.publishedPhotos ?? 0);
  const listingReady = listing.every((i) => i.done);
  const profile = profileItems(v, p.profileContext ?? { docKinds: [], maintenanceCount: 0 });
  const pct = percent(profile);
  const canMakeAvailable = meetsMinimum && v.status === "onboarding" && p.canEdit;

  async function makeAvailable() {
    setBusy(true);
    try {
      const r = await save({ data: { id: v.id, section: "identity", values: { status: "available" } } as any });
      if (!r.ok) toast.error(r.error ?? "Could not make this vehicle available");
      else { toast.success("Vehicle is now Available"); window.dispatchEvent(new Event("vehicle-profile-refresh")); }
    } finally { setBusy(false); }
  }
  const go = (f?: FixTarget) => {
    if (!f) return;
    if (f.kind === "edit") onEdit(f.section as VehicleSection);
    // Carry the vehicle. Without the id the Inspections panel fell back to
    // whichever car sorted first, so a Fix clicked on RR-007 opened a
    // pre-delivery inspection pointed at RR-001.
    else if (f.kind === "admin") void navigate({ to: "/admin", search: { tab: f.tab, id: v.id } as never });
    else onOpenTab(f.tab as Tab);
  };
  const canFix = (f: FixTarget) => p.canEdit || f.kind !== "edit";
  const Row = ({ c }: { c: ReadinessCheck }) => {
    const s = CHECK_STYLE[c.status];
    return (
      <li data-check={c.key} data-status={c.status} className="flex items-start gap-3 py-2.5">
        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${s.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-medium text-[#111114]">{c.label}</span>
            <span className={`text-[12px] font-semibold ${s.text}`}>{c.value}</span>
          </div>
          <div className="text-[12px] text-[#77777F]">{c.reason}</div>
        </div>
        {c.fix && c.status !== "ready" && canFix(c.fix) && (
          <button onClick={() => go(c.fix)} className="shrink-0 h-7 px-2.5 rounded-lg text-[12px] font-medium border border-[#E4E4E8] bg-white hover:bg-[#F4F4F6]">{c.fixLabel ?? "Fix"}</button>
        )}
      </li>
    );
  };
  const Head = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold text-[#9A9AA3] mb-1">{children}</div>;
  return (
    <SectionCard title="Vehicle Readiness" icon={<ShieldCheck className="w-4 h-4" strokeWidth={1.75} />}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span data-testid="readiness-overall" className={`inline-flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] font-semibold ${st.text}`}>
          <span className={`h-2 w-2 rounded-full ${st.dot}`} /> {st.label}
        </span>
        <span data-testid="readiness-availability" className="inline-flex items-center rounded-full bg-[#F4F4F6] px-2.5 py-1 text-[12px] font-medium text-[#111114]">{avail}</span>
        <span className="text-[11px] text-[#9A9AA3]">Readiness never changes availability.</span>
      </div>

      {/* Several of the gaps below are usually already answered by a document
          somebody uploaded — the value is extracted and waiting in review. The
          checklist used to send staff off to type it by hand instead. Nothing
          is applied from here: this opens the existing review, where each
          field is confirmed on its own and the plate, VIN and mileage still
          need an individual tick. */}
      {pendingDetails > 0 && (
        <button
          data-testid="readiness-pending-details"
          onClick={() => onReviewDetails?.()}
          className="mb-4 flex w-full items-center gap-2 rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] px-3 py-2.5 text-left hover:bg-white"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#D03020]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 text-[12px] text-[#111114]">
            <span className="font-semibold">{pendingDetails} Detail{pendingDetails === 1 ? "" : "s"} Ready to Review</span>
            <span className="text-[#77777F]"> — read from documents, nothing saved until you approve each one.</span>
          </span>
          <span className="shrink-0 text-[12px] font-medium text-[#D03020]">Review</span>
        </button>
      )}

      {/* Enforced today by the server */}
      <div data-testid="enforced-minimum" className="rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] p-3 mb-4">
        <Head>Required Now — Enforced</Head>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-medium text-[#111114]">Minimum to Make Available</span>
              <span className={`text-[12px] font-semibold ${meetsMinimum ? "text-[#1E7B3C]" : "text-[#B42318]"}`}>{meetsMinimum ? "Met" : "Not Met"}</span>
            </div>
            <div className="text-[12px] text-[#77777F]">
              {meetsMinimum
                ? overall === "ready"
                  ? "Year, make, model, VIN and weekly rate are set."
                  : "Year, make, model, VIN and weekly rate are set. The system allows Make Available, but the checklist below still flags items to resolve before renting."
                : `Missing: ${minMissing.map((i) => i.label).join(", ")}. The system blocks Make Available until these are set.`}
            </div>
          </div>
          {canMakeAvailable && (
            <button disabled={busy} onClick={makeAvailable} className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-medium bg-[#D03020] text-white disabled:opacity-50">Make Available</button>
          )}
          {!meetsMinimum && p.canEdit && (
            <button onClick={() => onEdit("identity")} className="shrink-0 h-7 px-2.5 rounded-lg text-[12px] font-medium border border-[#E4E4E8] bg-white hover:bg-[#F4F4F6]">{minMissing.length === 1 && minMissing[0].key === "weekly_rate" ? "Open Pricing" : "Open Identity"}</button>
          )}
        </div>
      </div>

      <Head>Readiness Checklist — Advisory</Head>
      {/* Grouped, not re-graded. Every status is exactly what it was; the
          split just stops "no pre-delivery inspection" and "registration
          expiry not recorded" reading as one undifferentiated wall of red. */}
      {readinessByCategory(checks).map((g) => (
        <div key={g.category} data-category={g.category} data-category-status={g.status} className="mt-2 first:mt-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold text-[#55555E]">{g.label}</span>
            <span className={`text-[11px] font-semibold ${CHECK_STYLE[g.status].text}`}>{CHECK_STYLE[g.status].label}</span>
          </div>
          <ul className="divide-y divide-[#F0F0F2]">{g.checks.map((c) => <Row key={c.key} c={c} />)}</ul>
        </div>
      ))}
      <div className="text-[11px] text-[#9A9AA3] mt-1">Advisory today. Rental start still requires a passed pre-delivery inspection or a recorded override.</div>

      <div className="mt-4 pt-3 border-t border-[#EDEDF0]">
        <Head>Listing Only — Does Not Affect Rental Eligibility</Head>
        <ul><Row c={photo} /></ul>
        <div className="text-[12px] text-[#77777F]">Listing Ready: <span className={listingReady ? "text-[#1E7B3C] font-semibold" : "text-[#B45309] font-semibold"}>{listingReady ? "Ready" : "Not Ready"}</span></div>
      </div>

      <div className="mt-4 pt-3 border-t border-[#EDEDF0]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Head>Fleet Profile — Recommended</Head>
            <div className="text-[12px] text-[#77777F]"><span className="font-semibold text-[#111114]">{pct}%</span> complete · never blocks renting</div>
          </div>
          <button onClick={() => setSetupOpen((o) => !o)} className="shrink-0 h-7 px-2.5 rounded-lg text-[12px] font-medium border border-[#E4E4E8] bg-white hover:bg-[#F4F4F6]">{setupOpen ? "Hide Setup" : "View Setup"}</button>
        </div>
        {setupOpen && (
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {profile.map((i) => (
              <li key={i.key} className="flex items-center gap-2 text-[13px]">
                <span className={`grid place-items-center h-4 w-4 rounded-full text-[10px] ${i.done ? "bg-[#E7F6EC] text-[#1E7B3C]" : "border border-[#C4C4CB] text-transparent"}`}>✓</span>
                <span className={i.done ? "text-[#111114]" : "text-[#55555E]"}>{i.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
