import { useCallback, useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listVehicles } from "@/lib/vehicles-list.functions";
import { availabilityLabel, VEHICLE_LIST_PAGE_SIZE, type VehicleListRow } from "@/lib/vehicles-list";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { VehicleProfile } from "./VehicleProfile";
import { AddVehicleDialog } from "./AddVehicleDialog";
import { toast } from "sonner";
import { Plus, Trash2, Car, ArrowRight, Copy, List, LayoutGrid, ChevronLeft, ChevronRight } from "lucide-react";
import { displayVehicleWord } from "@/lib/display-normalize";
import { EmptyState } from "./ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function PartnerAssignSelect({
  value,
  partners,
  onChange,
}: {
  value: string | null;
  partners: Array<{ id: string; name: string }>;
  onChange: (pid: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = partners.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(val) => onChange(val === "__none__" ? null : val)}
    >
      <SelectTrigger className="h-8 bg-white text-foreground text-xs">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <div className="p-1 sticky top-0 bg-white z-10 border-b border-border">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search partners…"
            className="w-full h-7 px-2 text-xs border border-border rounded-md outline-none focus:border-real-red"
          />
        </div>
        <SelectItem value="__none__">Unassigned</SelectItem>
        {filtered.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
        )}
      </SelectContent>
    </Select>
  );
}

type ListState = { q?: string; status?: string; body?: string; partner?: string; sort?: string; page?: string; view?: string };
const VIEW_KEY = "rr.vehicles.view";

function vehicleName(v: VehicleListRow) {
  return [v.year, displayVehicleWord(v.make ?? ""), displayVehicleWord(v.model ?? "")].filter(Boolean).join(" ");
}

function CopyVin({ vin }: { vin: string | null }) {
  if (!vin) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="truncate font-mono" title={vin}>…{vin.slice(-6)}</span>
      <button
        type="button"
        aria-label={`Copy full VIN ${vin}`}
        title={`Copy ${vin}`}
        onClick={() => { void navigator.clipboard.writeText(vin); toast.success(`VIN copied: ${vin}`); }}
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

function Rate({ v }: { v: VehicleListRow }) {
  return v.weekly_rate == null ? <span className="text-muted-foreground">Rate Not Set</span> : <span className="font-medium text-foreground">${v.weekly_rate}/wk</span>;
}

export function VehiclesPanel({
  externalSearch = "",
  autoOpenAdd = false,
  openId = null,
  listState = {},
}: { externalSearch?: string; autoOpenAdd?: boolean; openId?: string | null; listState?: ListState } = {}) {
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);
  const navigate = useNavigate();
  const viewing = openId;

  // List state lives in the URL so refresh, back and shared links keep it.
  const q = listState.q ?? "";
  const statusFilter = listState.status ?? "all";
  const bodyFilter = listState.body ?? "all";
  const partnerFilter = listState.partner ?? "all";
  const sort = listState.sort ?? "unit";
  const page = Math.max(1, Number(listState.page) || 1);
  const [storedView, setStoredView] = useState<string | null>(null);
  useEffect(() => {
    try { setStoredView(window.localStorage.getItem(VIEW_KEY)); } catch { /* ignore */ }
  }, []);
  const view = listState.view ?? storedView ?? "list";

  const listSearch = useCallback(
    (over: Partial<ListState> = {}) => {
      const next: ListState = { q, status: statusFilter, body: bodyFilter, partner: partnerFilter, sort, page: String(page), view: listState.view, ...over };
      const out: Record<string, string> = { tab: "vehicles" };
      if (next.q) out.q = next.q;
      if (next.status && next.status !== "all") out.vstatus = next.status;
      if (next.body && next.body !== "all") out.body = next.body;
      if (next.partner && next.partner !== "all") out.partner = next.partner;
      if (next.sort && next.sort !== "unit") out.sort = next.sort;
      if (next.page && next.page !== "1") out.page = next.page;
      if (next.view) out.view = next.view;
      return out;
    },
    [q, statusFilter, bodyFilter, partnerFilter, sort, page, listState.view],
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
  const params = { q: effectiveQ, status: statusFilter, body: bodyFilter, partner: partnerFilter, sort, page, pageSize: VEHICLE_LIST_PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ["admin-vehicles-list", params],
    queryFn: () => fetchList({ data: params }),
    placeholderData: keepPreviousData,
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
  const partnerName = (id: string | null) => (id ? partners.find((p) => p.id === id)?.name ?? "—" : "Unassigned");

  async function assignPartner(v: VehicleListRow, partner_id: string | null) {
    const { error } = await supabase.from("vehicles").update({ partner_id }).eq("id", v.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function remove(v: VehicleListRow) {
    if (!confirm(`Delete ${vehicleName(v)}? This cannot be undone.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Vehicle deleted");
  }

  function chooseView(next: "list" | "cards") {
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
    setStoredView(next);
    void navigate({ to: "/admin", search: listSearch({ view: next }) as any, replace: true });
  }

  const hasActiveFilters = q !== "" || statusFilter !== "all" || bodyFilter !== "all" || partnerFilter !== "all";
  const firstShown = total === 0 ? 0 : (page - 1) * VEHICLE_LIST_PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * VEHICLE_LIST_PAGE_SIZE);

  const cardsGrid = (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${view === "list" ? "md:hidden" : ""}`}>
      {rows.map((v) => {
        const img = resolvePhotoUrl(v.photo ?? undefined);
        return (
          <div key={v.id} onClick={() => setViewing(v.id)} className="rounded-2xl bg-soft overflow-hidden cursor-pointer transition-shadow hover:shadow-md">
            <div className={`aspect-[4/3] bg-white items-center justify-center ${view === "list" ? "hidden" : "flex"}`}>
              {img ? <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" /> : <span className="text-xs text-muted-foreground">No photo</span>}
            </div>
            <div className="p-4">
              <div className="h-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{v.unit_number ?? ""}</div>
              <div className="mt-0.5 truncate text-[17px] font-semibold tracking-tight">{vehicleName(v)}</div>
              <dl className="mt-2.5 grid grid-cols-[44px_1fr] items-center gap-y-0.5 text-[13px] leading-6">
                <dt className="text-muted-foreground">Plate</dt>
                <dd className="truncate font-mono">{v.license_plate || <span className="text-muted-foreground">—</span>}</dd>
                <dt className="text-muted-foreground">VIN</dt>
                <dd className="min-w-0"><CopyVin vin={v.vin} /></dd>
              </dl>
              <div className="mt-2.5 text-[13px] text-muted-foreground">
                <Rate v={v} /><span className="mx-1.5">·</span><Availability v={v} />
              </div>
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Partner</div>
                <PartnerAssignSelect value={v.partner_id} partners={partners} onChange={(pid) => assignPartner(v, pid)} />
              </div>
              <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setViewing(v.id)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-sm">
                  Open Record <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(v)} aria-label="Delete vehicle" className="group rounded-md border border-border px-3 py-1.5 text-sm hover:border-real-red">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground group-hover:text-real-red" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="admin-sticky-bar flex flex-col lg:flex-row lg:items-center gap-3 mb-4 pb-2">
        <div className="flex-1 flex flex-wrap gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search unit, VIN, plate, year, make, model…"
            aria-label="Search vehicles"
            className="flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white"
          />
          <Select value={statusFilter} onValueChange={(v) => setList({ status: v })}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-foreground text-sm" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {(result?.statuses ?? []).map((s) => <SelectItem key={s} value={s}>{availabilityLabel({ on_rent: false, status: s })}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bodyFilter} onValueChange={(v) => setList({ body: v })}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-foreground text-sm" aria-label="Body Type"><SelectValue placeholder="Body Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Body Types</SelectItem>
              {(result?.bodyTypes ?? []).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={partnerFilter} onValueChange={(v) => setList({ partner: v })}>
            <SelectTrigger className="h-9 w-[160px] bg-white text-foreground text-sm" aria-label="Partner"><SelectValue placeholder="Partner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Partners</SelectItem>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setList({ sort: v })}>
            <SelectTrigger className="h-9 w-[150px] bg-white text-foreground text-sm" aria-label="Sort"><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unit">Sort: Unit</SelectItem>
              <SelectItem value="make">Sort: Make</SelectItem>
              <SelectItem value="rate">Sort: Rate</SelectItem>
              <SelectItem value="newest">Sort: Newest</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <button onClick={() => { setSearchInput(""); setList({ q: "", status: "all", body: "all", partner: "all" }); }} className="text-sm text-muted-foreground hover:text-foreground px-2">
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <div className="hidden md:inline-flex rounded-md border border-[#EDEDF0] bg-white p-0.5" role="group" aria-label="View">
            <button onClick={() => chooseView("list")} aria-pressed={view === "list"} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "list" ? "bg-[#F1F1F4] font-medium" : "text-muted-foreground"}`}><List className="h-3.5 w-3.5" /> List</button>
            <button onClick={() => chooseView("cards")} aria-pressed={view === "cards"} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "cards" ? "bg-[#F1F1F4] font-medium" : "text-muted-foreground"}`}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
          </div>
          <button onClick={() => void navigate({ to: "/admin", search: { tab: "fleet_inbox" } as any })} className="inline-flex items-center gap-2 rounded-md border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium hover:bg-[#FAFAFB]">
            Import / Fleet Inbox
          </button>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-md bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150">
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
        </div>
      </div>

      {view === "list" && rows.length > 0 && (
        <div className="hidden md:block mt-4 rounded-xl border border-border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Plate</th>
                <th className="px-3 py-2 font-medium">VIN</th>
                <th className="px-3 py-2 font-medium">Availability</th>
                <th className="px-3 py-2 font-medium">Weekly Rate</th>
                <th className="px-3 py-2 font-medium">Partner</th>
                <th className="px-3 py-2 font-medium sr-only">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} onClick={() => setViewing(v.id)} className="border-t border-border cursor-pointer hover:bg-[#FAFAFB]">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{v.unit_number ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate">{vehicleName(v)}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{v.license_plate || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2"><CopyVin vin={v.vin} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><Availability v={v} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><Rate v={v} /></td>
                  <td className="px-3 py-2 max-w-[160px] truncate">{partnerName(v.partner_id)}</td>
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
      {rows.length > 0 && cardsGrid}

      {result && total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {firstShown}–{lastShown} of {total}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setList({ page: String(page - 1) })} aria-label="Previous page" className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span>Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setList({ page: String(page + 1) })} aria-label="Next page" className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {listQuery.isError && <div className="mt-6 text-sm text-real-red">Could not load vehicles.</div>}
      {result && total === 0 && !hasActiveFilters && !effectiveQ && (
        <EmptyState className="mt-6" icon={<Car className="w-6 h-6" strokeWidth={1.75} />} title="No Vehicles Yet" hint={'Click "Add Vehicle" to put your first car into the fleet.'} />
      )}
      {result && total === 0 && (hasActiveFilters || !!effectiveQ) && (
        <EmptyState className="mt-6" icon={<Car className="w-6 h-6" strokeWidth={1.75} />} title="No Matching Vehicles" hint="Try clearing a filter or searching for a different make or model." />
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
    </div>
  );
}
