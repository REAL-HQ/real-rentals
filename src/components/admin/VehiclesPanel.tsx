import { AdminToolbar, TOOLBAR, TopSearchChip } from "./AdminToolbar";
import { useCallback, useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listVehicles } from "@/lib/vehicles-list.functions";
import {
  availabilityLabel,
  vehicleRowNumber,
  isReadinessFilter,
  READINESS_BANDS,
  READINESS_HINT,
  READINESS_LABEL,
  VEHICLE_LIST_PAGE_SIZE,
  type ReadinessBand,
  type VehicleListRow,
} from "@/lib/vehicles-list";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { listVehicleMedia, type VehicleMedia } from "@/lib/vehicle-media.functions";
import { VehicleProfile } from "./VehicleProfile";
import { VehiclePhotoViewer } from "./VehiclePhotos";
import { AddVehicleDialog } from "./AddVehicleDialog";
import { VehicleLifecycleDialog, type LifecycleMode } from "./VehicleLifecycleDialog";
import { toast } from "sonner";
import { Plus, Trash2, Car, ArrowRight, Copy, List, LayoutGrid, ChevronLeft, ChevronRight, Archive, RotateCcw, Wrench } from "lucide-react";
import { displayVehicleWord } from "@/lib/display-normalize";
import { EmptyState } from "./ui";
import { MaintenanceDue } from "./MaintenanceDue";
import { MAINTENANCE_DUE_ENABLED } from "@/lib/maintenance-due";
import { MaintenanceLogBadge, MaintenanceLogBadgeSource } from "./MaintenanceLog";
import type { LogAttention } from "@/lib/maintenance-log";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ListState = {
  q?: string;
  status?: string;
  body?: string;
  partner?: string;
  sort?: string;
  page?: string;
  view?: string;
  ready?: string;
};
const VIEW_KEY = "rr.vehicles.view";

/** Vehicles-only density: the full filter/action set fits a 100% desktop view. */
const VEHICLE_TOOLBAR = {
  search: "h-8 min-w-[9rem] flex-[1_1_9rem] max-w-[16rem] rounded-md border border-border bg-white px-2.5 text-[13px] max-sm:max-w-none max-sm:w-full",
  select: "h-8 w-[7.75rem] shrink-0 bg-white text-[13px] text-foreground max-sm:w-full",
  button: TOOLBAR.button.replace("h-9", "h-8").replace("px-3.5", "px-3").replace("text-sm", "text-[13px]"),
  primary: TOOLBAR.primary.replace("h-9", "h-8").replace("px-3.5", "px-3").replace("text-sm", "text-[13px]"),
  segmented: TOOLBAR.segmented.replace("h-9", "h-8"),
  segment: TOOLBAR.segment.replace("px-2", "px-1.5").replace("text-xs", "text-[11px]"),
} as const;

function vehicleName(v: VehicleListRow) {
  return [v.year, displayVehicleWord(v.make ?? ""), displayVehicleWord(v.model ?? "")].filter(Boolean).join(" ");
}

/** Both staff views display the same confirmed original, including unlisted cars. */
function VehicleStaffPhoto({ path, name, className }: { path: string | null; name: string; className: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (path) {
      void loadStaffPhoto(path).then((next) => {
        if (live) { setUrl(next); setFailed(!next); }
      });
    }
    return () => { live = false; };
  }, [path]);

  if (url && !failed) {
    return <img src={url} alt={name} loading="lazy" className={className} onError={() => setFailed(true)} />;
  }
  return <span className="grid h-full w-full place-items-center text-muted-foreground" title={!path ? "No Vehicle Photo" : failed ? "Photo Unavailable" : "Loading Photo…"}>
    <Car className="h-4 w-4" aria-label={!path ? "No Vehicle Photo" : failed ? "Photo Unavailable" : "Loading Photo…"} />
  </span>;
}

/** The table's lead thumbnail and its on-demand, staff-only original gallery. */
function VehicleListThumbnail({ vehicle }: { vehicle: VehicleListRow }) {
  const loadMedia = useServerFn(listVehicleMedia);
  const staffPath = vehicle.thumbnailPath ?? null;
  const [opening, setOpening] = useState(false);
  const [viewer, setViewer] = useState<{ items: VehicleMedia[]; index: number } | null>(null);
  const name = vehicleName(vehicle);

  async function openPhotos(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (opening) return;
    setOpening(true);
    try {
      const result = await loadMedia({ data: { vehicleId: vehicle.id } });
      const confirmed = new Set(result.confirmedCarPhotoIds ?? []);
      const items = result.items.filter((item) => item.kind === "original" && confirmed.has(item.id));
      if (!items.length) {
        toast.error("No confirmed car photos are available for this vehicle.");
        return;
      }
      const lead = items.findIndex((item) => item.storage_path === staffPath);
      setViewer({ items, index: Math.max(0, lead) });
    } catch {
      toast.error("Could not load this vehicle's photos.");
    } finally {
      setOpening(false);
    }
  }

  if (!staffPath) {
    return (
      <span className="grid h-9 w-12 place-items-center rounded-md border border-border bg-soft text-muted-foreground" title="No Vehicle Photo">
        <Car className="h-4 w-4" aria-label="No Vehicle Photo" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={opening}
        onClick={openPhotos}
        aria-label={`View Photos: ${name}`}
        title={opening ? "Loading Photos…" : `View ${name} Photos`}
        className="block h-9 w-12 overflow-hidden rounded-md border border-border bg-soft text-muted-foreground transition-colors hover:border-real-red disabled:cursor-wait"
      >
        <VehicleStaffPhoto path={staffPath} name={name} className="h-full w-full object-cover" />
      </button>
      {viewer && (
        <VehiclePhotoViewer
          items={viewer.items}
          index={viewer.index}
          onIndex={(index) => setViewer((current) => current ? { ...current, index } : null)}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

function CopyVin({ vin }: { vin: string | null }) {
  if (!vin) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono" title={vin}>…{vin.slice(-6)}</span>
      <button
        type="button"
        aria-label={`Copy full VIN ${vin}`}
        title={`Copy ${vin}`}
        onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(vin); toast.success(`VIN copied: ${vin}`); }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-white hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function Availability({ v }: { v: VehicleListRow }) {
  const label = availabilityLabel(v);
  return <span className={v.on_rent || v.status === "onboarding" ? "font-medium text-foreground" : ""}>{label}</span>;
}

/**
 * Readiness, in the list.
 *
 * Three bands, the same ones the vehicle's own profile uses, and the tooltip
 * names what is missing rather than making the operator open the record to
 * find out. Colour alone never carries the meaning — the words are there.
 */
const READINESS_TONE: Record<ReadinessBand, string> = {
  listing_ready: "bg-[rgba(32,160,96,0.10)] text-[#13613B]",
  rental_ready: "bg-[rgba(240,192,64,0.14)] text-[#8A6410]",
  not_ready: "bg-[rgba(208,48,32,0.08)] text-[#D03020]",
};
const READINESS_DOT: Record<ReadinessBand, string> = {
  listing_ready: "bg-[#1C8F57]",
  rental_ready: "bg-[#C68A12]",
  not_ready: "bg-[#D03020]",
};

function ReadinessPill({ v }: { v: VehicleListRow }) {
  const gaps = v.readinessGaps ?? [];
  return (
    <span
      data-readiness={v.readiness}
      title={gaps.length ? `Missing: ${gaps.join(", ")}` : READINESS_HINT[v.readiness]}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${READINESS_TONE[v.readiness]}`}
    >
      {READINESS_LABEL[v.readiness]}
    </span>
  );
}

function Rate({ v }: { v: VehicleListRow }) {
  return v.weekly_rate == null ? <span className="text-muted-foreground">Rate Not Set</span> : <span className="font-medium text-foreground">${v.weekly_rate}/wk</span>;
}

type VehiclesPanelProps = {
  externalSearch?: string;
  /** Clears the shared top-bar search (it's applied here too). */
  onClearExternalSearch?: () => void;
  autoOpenAdd?: boolean;
  openId?: string | null;
  listState?: ListState;
  canSeeMaintenanceDue?: boolean;
};

export function VehiclesPanel(props: VehiclesPanelProps = {}) {
  return (
    <MaintenanceLogBadgeSource>
      {(reminders, remindersFailed) => <FleetVehicles {...props} reminders={reminders} remindersFailed={remindersFailed} />}
    </MaintenanceLogBadgeSource>
  );
}

function FleetVehicles({
  externalSearch = "",
  onClearExternalSearch,
  autoOpenAdd = false,
  openId = null,
  listState = {},
  canSeeMaintenanceDue = false,
  reminders = {},
  remindersFailed = false,
}: VehiclesPanelProps & {
  canSeeMaintenanceDue?: boolean;
  reminders?: Record<string, LogAttention>;
  remindersFailed?: boolean;
} = {}) {
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);
  const navigate = useNavigate();
  const viewing = openId;

  // List state lives in the URL so refresh, back and shared links keep it.
  const q = listState.q ?? "";
  const statusFilter = listState.status ?? "all";
  const bodyFilter = listState.body ?? "all";
  const partnerFilter = listState.partner ?? "all";
  const readyFilter = isReadinessFilter(listState.ready) ? listState.ready : "all";
  const sort = listState.sort ?? "unit";
  const page = Math.max(1, Number(listState.page) || 1);
  const [storedView, setStoredView] = useState<string | null>(null);
  useEffect(() => {
    try { setStoredView(window.localStorage.getItem(VIEW_KEY)); } catch { /* ignore */ }
  }, []);
  const requestedView = listState.view ?? storedView ?? "list";
  const dueAllowed = MAINTENANCE_DUE_ENABLED && canSeeMaintenanceDue;
  const view = requestedView === "due" && !dueAllowed ? "list" : requestedView;

  const listSearch = useCallback(
    (over: Partial<ListState> = {}) => {
      const next: ListState = { q, status: statusFilter, body: bodyFilter, partner: partnerFilter, sort, page: String(page), view: listState.view, ready: readyFilter, ...over };
      const out: Record<string, string> = { tab: "vehicles" };
      if (next.q) out.q = next.q;
      if (next.status && next.status !== "all") out.vstatus = next.status;
      if (next.body && next.body !== "all") out.body = next.body;
      if (next.partner && next.partner !== "all") out.partner = next.partner;
      if (next.sort && next.sort !== "unit") out.sort = next.sort;
      if (next.ready && next.ready !== "all") out.ready = next.ready;
      if (next.page && next.page !== "1") out.page = next.page;
      if (next.view) out.view = next.view;
      return out;
    },
    [q, statusFilter, bodyFilter, partnerFilter, sort, page, listState.view, readyFilter],
  );
  const setList = useCallback(
    (over: Partial<ListState>) => void navigate({ to: "/admin", search: listSearch({ page: "1", ...over }) as any, replace: true }),
    [navigate, listSearch],
  );
  const setViewing = useCallback(
    (id: string | null) => void navigate({ to: "/admin", search: (id ? { ...listSearch(), id } : listSearch()) as any }),
    [navigate, listSearch],
  );

  const [adding, setAddingLocal] = useState(autoOpenAdd);
  const setAdding = useCallback(
    (next: boolean) => {
      setAddingLocal(next);
      if (!next) void navigate({ to: "/admin", search: listSearch() as any, replace: true });
    },
    [navigate, listSearch],
  );
  useEffect(() => {
    if (autoOpenAdd) setAddingLocal(true);
  }, [autoOpenAdd]);

  // Typing is local; the URL (and the server query) follow after a pause.
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return;
    const t = setTimeout(() => setList({ q: searchInput.trim() }), 300);
    return () => clearTimeout(t);
  }, [searchInput, q, setList]);

  const effectiveQ = (externalSearch || q).trim();
  const fetchList = useServerFn(listVehicles);
  const params = { q: effectiveQ, status: statusFilter, body: bodyFilter, partner: partnerFilter, sort, ready: readyFilter, page, pageSize: VEHICLE_LIST_PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ["admin-vehicles-list", params],
    queryFn: () => fetchList({ data: params }),
    placeholderData: keepPreviousData,
    enabled: view !== "due",
  });
  const result = listQuery.data;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / VEHICLE_LIST_PAGE_SIZE));
  const load = useCallback(() => void listQuery.refetch(), [listQuery]);

  useEffect(() => {
    supabase
      .from("partners")
      .select("id,name")
      .order("name")
      .then(({ data }) => setPartners(data || []));
  }, []);
  // No direct browser deletes: Archive / Restore / Delete Permanently all go
  // through audited server actions.
  const [lifecycle, setLifecycle] = useState<{ v: VehicleListRow; mode: LifecycleMode } | null>(null);

  function chooseView(next: "list" | "cards" | "due") {
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
    setStoredView(next);
    void navigate({ to: "/admin", search: listSearch({ view: next }) as any, replace: true });
  }

  const topSearch = externalSearch.trim();
  const hasActiveFilters = topSearch !== "" || q !== "" || statusFilter !== "all" || bodyFilter !== "all" || partnerFilter !== "all" || readyFilter !== "all";
  function clearAll() {
    setSearchInput("");
    setList({ q: "", status: "all", body: "all", partner: "all", ready: "all" });
    if (topSearch) onClearExternalSearch?.();
  }
  // Use the returned page while keepPreviousData is showing the prior page.
  const rowNumber = (index: number) => vehicleRowNumber(result?.page ?? page, result?.pageSize ?? VEHICLE_LIST_PAGE_SIZE, index);
  const firstShown = rows.length === 0 ? 0 : rowNumber(0);
  const lastShown = rows.length === 0 ? 0 : rowNumber(rows.length - 1);

  const cardsGrid = (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-lg:min-w-0 ${view === "list" ? "md:hidden" : ""}`}>
      {rows.map((v, index) => {
        return (
          <div key={v.id} onClick={() => setViewing(v.id)} className="rounded-2xl bg-soft overflow-hidden cursor-pointer transition-shadow hover:shadow-md max-lg:min-w-0">
            {view !== "list" && <div className="aspect-[4/3] bg-background flex items-center justify-center">
              <VehicleStaffPhoto path={v.thumbnailPath ?? null} name={vehicleName(v)} className="w-full h-full object-cover" />
            </div>}
            <div className="p-4">
              <div className="h-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><span className="mr-2 tabular-nums">#{rowNumber(index)}</span>{v.unit_number ?? ""}</div>
              <div className="mt-0.5 truncate text-[17px] font-semibold tracking-tight">{vehicleName(v)}{reminders[v.id] ? <MaintenanceLogBadge state={reminders[v.id]} /> : null}</div>
              <dl className="mt-2.5 grid grid-cols-[44px_1fr] items-center gap-y-0.5 text-[13px] leading-6">
                <dt className="text-muted-foreground">Color</dt>
                <dd className="truncate">{displayVehicleWord(v.color ?? "") || <span className="text-muted-foreground">Not Set</span>}</dd>
                <dt className="text-muted-foreground">Plate</dt>
                <dd className="truncate font-mono">{v.license_plate || <span className="text-muted-foreground">—</span>}</dd>
                <dt className="text-muted-foreground">VIN</dt>
                <dd className="min-w-0"><CopyVin vin={v.vin} /></dd>
              </dl>
              <div className="mt-2.5 text-[13px] text-muted-foreground">
                <Rate v={v} /><span className="mx-1.5">·</span><Availability v={v} />
              </div>
              <div className="mt-2"><ReadinessPill v={v} /></div>
              <div className="mt-3 flex gap-2 max-lg:flex-wrap" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setViewing(v.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-sm">
                  Open Record <ArrowRight className="w-3.5 h-3.5" />
                </button>
                {v.status === "archived" ? (
                  <>
                    <button onClick={() => setLifecycle({ v, mode: "restore" })} aria-label="Restore vehicle" title="Restore Vehicle" className="rounded-md border border-border px-3 py-1.5 text-sm">
                      <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => setLifecycle({ v, mode: "delete" })} aria-label="Delete permanently" title="Delete Permanently" className="group rounded-md border border-border px-3 py-1.5 text-sm hover:border-real-red">
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground group-hover:text-real-red" />
                    </button>
                  </>
                ) : (
                  <button onClick={() => setLifecycle({ v, mode: "archive" })} aria-label="Archive vehicle" title="Archive Vehicle" className="rounded-md border border-border px-3 py-1.5 text-sm">
                    <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="max-lg:min-w-0">
      {remindersFailed ? <p className="mb-3 text-sm text-[#D03020]" data-testid="maintenance-log-error">Could not load maintenance reminders.</p> : null}
      <AdminToolbar
        filters={
          <>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search unit, VIN, plate, year, make, model…"
            aria-label="Search vehicles"
            className={VEHICLE_TOOLBAR.search}
          />
          <Select value={statusFilter} onValueChange={(v) => setList({ status: v })}>
            <SelectTrigger className={VEHICLE_TOOLBAR.select} aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {(result?.statuses ?? []).map((s) => <SelectItem key={s} value={s}>{availabilityLabel({ on_rent: false, status: s })}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bodyFilter} onValueChange={(v) => setList({ body: v })}>
            <SelectTrigger className={VEHICLE_TOOLBAR.select} aria-label="Body Type"><SelectValue placeholder="Body Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Body Types</SelectItem>
              {(result?.bodyTypes ?? []).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={partnerFilter} onValueChange={(v) => setList({ partner: v })}>
            <SelectTrigger className={VEHICLE_TOOLBAR.select} aria-label="Partner"><SelectValue placeholder="Partner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Partners</SelectItem>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setList({ sort: v })}>
            <SelectTrigger className={VEHICLE_TOOLBAR.select} aria-label="Sort"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unit">Sort: Unit</SelectItem>
              <SelectItem value="make">Sort: Make</SelectItem>
              <SelectItem value="color">Sort: Color</SelectItem>
              <SelectItem value="rate">Sort: Rate</SelectItem>
              <SelectItem value="newest">Sort: Newest</SelectItem>
            </SelectContent>
          </Select>
          <TopSearchChip value={externalSearch} onClear={() => onClearExternalSearch?.()} />
          {hasActiveFilters && (
            <button onClick={clearAll} className="inline-flex h-9 shrink-0 items-center px-2 text-sm text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
          </>
        }
        actions={
          <>
          <div className={`hidden md:inline-flex ${VEHICLE_TOOLBAR.segmented}`} role="group" aria-label="View">
            <button onClick={() => chooseView("list")} aria-pressed={view === "list"} className={`${VEHICLE_TOOLBAR.segment} ${view === "list" ? "bg-[#F1F1F4] font-medium" : "text-muted-foreground"}`}><List className="h-3.5 w-3.5" /> List</button>
            <button onClick={() => chooseView("cards")} aria-pressed={view === "cards"} className={`${VEHICLE_TOOLBAR.segment} ${view === "cards" ? "bg-[#F1F1F4] font-medium" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
          </div>
          {dueAllowed && (
            <button onClick={() => chooseView("due")} aria-pressed={view === "due"} className={`${VEHICLE_TOOLBAR.button} text-xs ${view === "due" ? "bg-[#F1F1F4] font-medium" : "text-muted-foreground"}`}><Wrench className="h-3.5 w-3.5" /> Maintenance Due</button>
          )}
          <button onClick={() => void navigate({ to: "/admin", search: { tab: "fleet_inbox" } as any })} className={VEHICLE_TOOLBAR.button} title="Import vehicles through the Fleet Inbox">
            Import
          </button>
          <button onClick={() => setAdding(true)} className={VEHICLE_TOOLBAR.primary}>
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
          </>
        }
        footer={(
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {view !== "due" && (
              <p className="shrink-0 text-xs text-muted-foreground" data-testid="vehicle-count">
                {result?.fleetTotal != null ? `${result.fleetTotal} Vehicles Total (Including Archived)` : listQuery.isPending ? "Loading Vehicle Total…" : "Vehicle Total Unavailable"}
                {result && hasActiveFilters && !listQuery.isPlaceholderData && <span> · {total} Matching</span>}
              </p>
            )}
          {/* Fleet-wide readiness lives IN the one sticky filter row: the bar
              publishes its own height and overlaps the 16px below it, so a
              second row OUTSIDE the bar is covered and unclickable (the toolbar
              footer is inside it). Counts cover
              everything the current search and filters match, not the page,
              and each chip is the filter for its own band. */}
            {result ? <span className="ml-auto inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2" data-testid="fleet-readiness">
              <span className="whitespace-nowrap text-xs text-muted-foreground">Fleet Readiness</span>
              {READINESS_BANDS.map((band) => {
                const n = result.readinessCounts?.[band] ?? 0;
                const active = readyFilter === band;
                return (
                  <button
                    key={band}
                    onClick={() => setList({ ready: active ? "all" : band })}
                    aria-pressed={active}
                    data-band={band}
                    data-count={n}
                    title={READINESS_HINT[band]}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-[#D03020] font-medium text-[#111114]"
                        : "border-[#EDEDF0] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${READINESS_DOT[band]}`} />
                    {READINESS_LABEL[band]}
                    <span className="font-medium text-foreground">{n}</span>
                  </button>
                );
              })}
              {readyFilter !== "all" && (
                <button
                  onClick={() => setList({ ready: "all" })}
                  className="whitespace-nowrap px-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Show All
                </button>
              )}
              {result.readinessPartial && (
                <span
                  className="whitespace-nowrap text-xs text-[#8A6410]"
                  title="Only the first 2,000 vehicles were graded."
                >
                  Counted On The First 2,000 Vehicles
                </span>
              )}
            </span> : null}
          </div>
        )}
      />

      {view === "due" && dueAllowed && (
        <MaintenanceDue query={effectiveQ} status={statusFilter} body={bodyFilter} partner={partnerFilter} />
      )}

      {view !== "due" && view === "list" && rows.length > 0 && (
        <div className="hidden md:block mt-3 max-lg:min-w-0 max-lg:overflow-x-auto rounded-xl border border-border bg-white lg:overflow-hidden">
          <table className="w-full text-[13px] max-lg:min-w-[64rem] [&_th]:px-2.5 [&_th]:py-1.5 [&_td]:px-2.5 [&_td]:py-1">
            <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 font-medium" aria-label="Row number">#</th>
                <th className="px-3 py-2 font-medium">Photo</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Color</th>
                <th className="px-3 py-2 font-medium">Plate</th>
                <th className="px-3 py-2 font-medium">VIN</th>
                <th className="px-3 py-2 font-medium">Availability</th>
                <th className="px-3 py-2 font-medium">Readiness</th>
                <th className="px-3 py-2 font-medium">Weekly Rate</th>
                <th className="px-3 py-2 font-medium sr-only">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v, index) => (
                <tr key={v.id} onClick={() => setViewing(v.id)} className="border-t border-border cursor-pointer hover:bg-[#FAFAFB]">
                  <td className="w-10 px-3 py-2 tabular-nums text-muted-foreground">{rowNumber(index)}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><VehicleListThumbnail vehicle={v} /></td>
                  <td className="px-3 py-2 max-w-[220px] truncate">{vehicleName(v)}{reminders[v.id] ? <MaintenanceLogBadge state={reminders[v.id]} /> : null}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{displayVehicleWord(v.color ?? "") || <span className="text-muted-foreground">Not Set</span>}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{v.license_plate || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2"><CopyVin vin={v.vin} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><Availability v={v} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><ReadinessPill v={v} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><Rate v={v} /></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setViewing(v.id); }} className="inline-flex items-center gap-1 rounded-md bg-black text-white px-2.5 py-1 text-xs">
                      Open <ArrowRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view !== "due" && rows.length > 0 && cardsGrid}

      {view !== "due" && result && total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground max-lg:flex-wrap max-lg:gap-y-2">
          <span>Showing {firstShown}–{lastShown} of {total}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setList({ page: String(page - 1) })} aria-label="Previous page" className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span>Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setList({ page: String(page + 1) })} aria-label="Next page" className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {view !== "due" && listQuery.isError && <div className="mt-6 text-sm text-real-red">Could not load vehicles.</div>}
      {view !== "due" && result && total === 0 && !hasActiveFilters && !effectiveQ && (
        <EmptyState className="mt-6" icon={<Car className="w-6 h-6" strokeWidth={1.75} />} title="No Vehicles Yet" hint={'Click "Add Vehicle" to put your first car into the fleet.'} />
      )}
      {view !== "due" && result && total === 0 && (hasActiveFilters || !!effectiveQ) && (
        <EmptyState
          className="mt-6"
          icon={<Car className="w-6 h-6" strokeWidth={1.75} />}
          title={topSearch ? `No Vehicles Match “${topSearch}”` : "No Matching Vehicles"}
          hint={
            readyFilter !== "all"
              ? `No vehicle in this view is ${READINESS_LABEL[readyFilter]}. ${READINESS_HINT[readyFilter]}`
              : topSearch
                ? `The top search “${topSearch}” is also applied here. Clear it to see every vehicle.`
                : "Try clearing a filter or searching for a different make or model."
          }
          action={hasActiveFilters ? <button onClick={clearAll} className={VEHICLE_TOOLBAR.button}>Clear Filters</button> : undefined}
        />
      )}

      {adding && (
        <AddVehicleDialog
          onClose={() => setAdding(false)}
          onCreated={async () => {
            load();
            setAdding(false);
          }}
        />
      )}
      {viewing && <VehicleProfile vehicleId={viewing} onClose={() => setViewing(null)} onChanged={load} />}
      {lifecycle && (
        <VehicleLifecycleDialog
          vehicle={{ id: lifecycle.v.id, unit_number: lifecycle.v.unit_number, label: vehicleName(lifecycle.v) }}
          mode={lifecycle.mode}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); load(); }}
        />
      )}
    </div>
  );
}
