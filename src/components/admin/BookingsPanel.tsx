import { useCallback, useContext, useEffect, useState, createContext, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { CalendarCheck, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { listBookings } from "@/lib/bookings.functions";
import { ACTIVE_MILEAGE_OVERAGE_ENABLED } from "@/lib/active-mileage-overage-flag";
import { listActiveMileageOverage } from "@/lib/active-mileage-overage.functions";
import {
  BOOKING_LIST_PAGE_SIZE,
  BOOKING_PHASE_LABEL,
  bookingDates,
  isBookingPhaseFilter,
  type BookingPhase,
  type BookingRow,
} from "@/lib/bookings-list";
import { BookingDetails } from "./BookingDetails";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState, StatusPill } from "./ui";
import { fmtDate } from "@/lib/date-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Bookings: every rental, in one list.
//
// Until now a rental could only be seen from the driver who had it, one record
// at a time, and only while it was ACTIVE — a finished rental was effectively
// gone from the back office. This is the list, and in this phase a booking IS
// a rental: no new table, no second record, nothing written from this screen.
//
// Money is Manager-and-above and the server simply does not send it to a
// Coordinator (`canSeeMoney`), so the columns below are absent rather than
// hidden — the rule this codebase keeps: UI hiding is not a boundary.
//
// The three phase chips are the filter, the way the Vehicles list's readiness
// chips are, and they count the filtered scope rather than the page. There is
// deliberately no "Upcoming" chip: advance reservations do not exist yet, and
// an empty tab promising them would be a claim about inventory nobody holds.

type ListState = { q?: string; phase?: string; sort?: string; page?: string; vehicle?: string };

const PHASE_TONE: Record<BookingPhase, "green" | "neutral" | "red" | "amber"> = {
  active: "green",
  completed: "neutral",
  cancelled: "red",
  reserved: "amber",
};

const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString()}`);

function DriverCell({ b }: { b: BookingRow }) {
  if (!b.driverName) return <span className="text-muted-foreground">Driver record not linked</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium text-foreground">{b.driverName}</span>
      {b.driverEmail && (
        <span className="block truncate text-xs text-muted-foreground">{b.driverEmail}</span>
      )}
    </span>
  );
}

function VehicleCell({ b }: { b: BookingRow }) {
  if (!b.vehicleId) return <span className="text-muted-foreground">Not linked</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate font-medium text-foreground">{b.unitNumber ?? "—"}</span>
      <span className="block truncate text-xs text-muted-foreground">{b.vehicleLabel ?? ""}</span>
    </span>
  );
}

export function BookingsPanel({
  externalSearch = "",
  openId = null,
  listState = {},
}: { externalSearch?: string; openId?: string | null; listState?: ListState } = {}) {
  const navigate = useNavigate();

  // List state lives in the URL so refresh, back and shared links keep it.
  const q = listState.q ?? "";
  const phase = isBookingPhaseFilter(listState.phase) ? listState.phase : "all";
  const sort = listState.sort ?? "recent";
  const page = Math.max(1, Number(listState.page) || 1);
  const vehicleFilter = listState.vehicle ?? "";

  const listSearch = useCallback(
    (over: Partial<ListState> = {}) => {
      const next: ListState = {
        q,
        phase,
        sort,
        page: String(page),
        vehicle: vehicleFilter,
        ...over,
      };
      const out: Record<string, string> = { tab: "bookings" };
      if (next.q) out.q = next.q;
      if (next.phase && next.phase !== "all") out.phase = next.phase;
      if (next.sort && next.sort !== "recent") out.sort = next.sort;
      if (next.page && next.page !== "1") out.page = next.page;
      if (next.vehicle) out.vehicle = next.vehicle;
      return out;
    },
    [q, phase, sort, page, vehicleFilter],
  );
  const setList = useCallback(
    (over: Partial<ListState>) =>
      void navigate({
        to: "/admin",
        search: listSearch({ page: "1", ...over }) as never,
        replace: true,
      }),
    [navigate, listSearch],
  );
  const setViewing = useCallback(
    (id: string | null) =>
      void navigate({
        to: "/admin",
        search: (id ? { ...listSearch(), id } : listSearch()) as never,
      }),
    [navigate, listSearch],
  );

  // Typing is local; the URL (and the server query) follow after a pause.
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return;
    const t = setTimeout(() => setList({ q: searchInput.trim() }), 300);
    return () => clearTimeout(t);
  }, [searchInput, q, setList]);

  const effectiveQ = (externalSearch || q).trim();
  const fetchList = useServerFn(listBookings);
  const params = {
    q: effectiveQ,
    phase,
    sort,
    page,
    pageSize: BOOKING_LIST_PAGE_SIZE,
    ...(vehicleFilter ? { vehicleId: vehicleFilter } : {}),
  };
  const listQuery = useQuery({
    queryKey: ["admin-bookings-list", params],
    queryFn: () => fetchList({ data: params }),
    placeholderData: keepPreviousData,
  });
  const result = listQuery.data;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const money = !!result?.canSeeMoney;
  const pages = Math.max(1, Math.ceil(total / BOOKING_LIST_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * BOOKING_LIST_PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * BOOKING_LIST_PAGE_SIZE);
  const hasActiveFilters = q !== "" || phase !== "all" || !!vehicleFilter;
  const overageIds = phase === "active" ? rows.map((b) => b.id) : [];

  return (
    <MileageOverageGate active={phase === "active"} rentalIds={overageIds}>
    <div>
      <div className="admin-sticky-bar flex flex-col lg:flex-row lg:items-center gap-3 mb-4 pb-2">
        <div className="flex-1 flex flex-wrap items-center gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search driver, email, unit, plate, VIN…"
            aria-label="Search bookings"
            className="flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white"
          />
          {/* The phase chips ARE the filter, and they count the scope the
              current search covers — not the page, which would change the
              numbers as you paged. */}
          {result && (
            <span className="inline-flex items-center gap-2" data-testid="booking-phases">
              {(["active", "completed", "cancelled"] as const).map((p) => {
                const n = result.counts?.[p] ?? 0;
                const on = phase === p;
                return (
                  <button
                    key={p}
                    onClick={() => setList({ phase: on ? "all" : p })}
                    aria-pressed={on}
                    data-phase={p}
                    data-count={n}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-xs transition-colors ${
                      on
                        ? "border-[#D03020] font-medium text-[#111114]"
                        : "border-[#EDEDF0] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {BOOKING_PHASE_LABEL[p]}
                    <span className="font-medium text-foreground">{n}</span>
                  </button>
                );
              })}
            </span>
          )}
          <Select value={sort} onValueChange={(v) => setList({ sort: v })}>
            <SelectTrigger
              className="h-9 w-[150px] bg-white text-foreground text-sm"
              aria-label="Sort"
            >
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Sort: Newest</SelectItem>
              <SelectItem value="oldest">Sort: Oldest</SelectItem>
              <SelectItem value="driver">Sort: Driver</SelectItem>
              <SelectItem value="vehicle">Sort: Unit</SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchInput("");
                setList({ q: "", phase: "all", vehicle: "" });
              }}
              className="text-sm text-muted-foreground hover:text-foreground px-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <MileageOverageNotice />

      {rows.length > 0 && (
        <AdminTableScroll className="hidden md:block rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Dates</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <MileageOverageHeader />
                {money && <th className="px-3 py-2 font-medium">Weekly</th>}
                {money && <th className="px-3 py-2 font-medium">Outstanding</th>}
                <th className="px-3 py-2 font-medium sr-only">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => setViewing(b.id)}
                  data-booking={b.id}
                  className="border-t border-border cursor-pointer hover:bg-[#FAFAFB]"
                >
                  <td className="px-3 py-2 max-w-[220px]">
                    <DriverCell b={b} />
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <VehicleCell b={b} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {b.startDate ? fmtDate(b.startDate) : "Not recorded"}
                    <span className="mx-1">→</span>
                    {b.endDate ? fmtDate(b.endDate) : b.openEnded ? "Open-ended" : "Not recorded"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusPill status={b.phase} tone={PHASE_TONE[b.phase]}>
                      {BOOKING_PHASE_LABEL[b.phase]}
                    </StatusPill>
                  </td>
                  <MileageOverageCell rentalId={b.id} />
                  {money && (
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {usd(b.weeklyRate)}
                    </td>
                  )}
                  {money && (
                    <td
                      className={`px-3 py-2 whitespace-nowrap tabular-nums ${(b.balanceDue ?? 0) > 0 ? "text-[#D03020] font-medium" : "text-muted-foreground"}`}
                    >
                      {(b.balanceDue ?? 0) > 0 ? usd(b.balanceDue) : "—"}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewing(b.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-black text-white px-2.5 py-1 text-xs"
                    >
                      Open <ArrowRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}

      {rows.length > 0 && (
        <div className="md:hidden grid grid-cols-1 gap-3">
          {rows.map((b) => (
            <div
              key={b.id}
              onClick={() => setViewing(b.id)}
              data-booking-card={b.id}
              className="rounded-2xl bg-soft p-4 cursor-pointer transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <DriverCell b={b} />
                <StatusPill status={b.phase} tone={PHASE_TONE[b.phase]}>
                  {BOOKING_PHASE_LABEL[b.phase]}
                </StatusPill>
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {[b.unitNumber, b.vehicleLabel].filter(Boolean).join(" · ") || "Vehicle not linked"}
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                {bookingDates(b.startDate, b.endDate, b.phase)}
              </div>
              <MileageOverageLine rentalId={b.id} />
              {money && (
                <div className="mt-2 text-[13px]">
                  <span className="text-muted-foreground">{usd(b.weeklyRate)}/wk</span>
                  {(b.balanceDue ?? 0) > 0 && (
                    <span className="ml-2 font-medium text-[#D03020]">{usd(b.balanceDue)} due</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {result && total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {firstShown}–{lastShown} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setList({ page: String(page - 1) })}
              aria-label="Previous page"
              className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => setList({ page: String(page + 1) })}
              aria-label="Next page"
              className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {listQuery.isError && (
        <div className="mt-6 text-sm text-real-red">Could not load bookings.</div>
      )}
      {result && total === 0 && !hasActiveFilters && !effectiveQ && (
        <EmptyState
          className="mt-6"
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title="No Bookings Yet"
          hint="A booking appears here when a rental is activated from an approved driver's record."
        />
      )}
      {result && total === 0 && (hasActiveFilters || !!effectiveQ) && (
        <EmptyState
          className="mt-6"
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title="No Matching Bookings"
          hint={
            phase !== "all"
              ? `No ${BOOKING_PHASE_LABEL[phase as BookingPhase].toLowerCase()} booking matches this view.`
              : "Try clearing the filter or searching for a different driver, unit or plate."
          }
        />
      )}

      {openId && (
        <BookingDetails
          rentalId={openId}
          onClose={() => setViewing(null)}
          // The driver link takes applications.id — the person's record — and
          // never rentals.driver_id, which is a portal login.
          onOpenDriver={(applicationId) =>
            void navigate({ to: "/admin", search: { tab: "drivers", id: applicationId } as never })
          }
          onOpenVehicle={(vehicleId) =>
            void navigate({ to: "/admin", search: { tab: "vehicles", id: vehicleId } as never })
          }
          // `msg` is not owned by any tab, so the existing overlay opens over
          // the booking and closing it returns here.
          onOpenMessages={(applicationId) =>
            void navigate({
              to: "/admin",
              search: { ...listSearch(), id: openId, msg: applicationId } as never,
            })
          }
          // Charges, Incidents and Maintenance keep their own workflows: the
          // booking shows what is already on this rental and sends you there to
          // add to it, rather than growing a second copy of each one.
          //
          // No vehicle is carried: `id` is owned by the drivers, vehicles,
          // inspections and bookings tabs, so the router would strip it a tick
          // later and none of those three panels reads it. Prefilling them is
          // its own small change, not something to fake from here.
          onOpenTab={(tab) => void navigate({ to: "/admin", search: { tab } as never })}
        />
      )}
    </div>
    </MileageOverageGate>
  );
}

type OverageView = {
  status: "off" | "loading" | "error" | "ready";
  byId: Map<string, string>;
  truncated: boolean;
};

const MILEAGE_OVERAGE_OFF: OverageView = { status: "off", byId: new Map(), truncated: false };
const MileageOverageContext = createContext<OverageView>(MILEAGE_OVERAGE_OFF);

function MileageOverageGate({
  active,
  rentalIds,
  children,
}: {
  active: boolean;
  rentalIds: string[];
  children: ReactNode;
}) {
  if (!ACTIVE_MILEAGE_OVERAGE_ENABLED || !active) return (
    <MileageOverageContext.Provider value={MILEAGE_OVERAGE_OFF}>{children}</MileageOverageContext.Provider>
  );
  return <MileageOverageLive rentalIds={rentalIds}>{children}</MileageOverageLive>;
}

function MileageOverageLive({ rentalIds, children }: { rentalIds: string[]; children: ReactNode }) {
  const load = useServerFn(listActiveMileageOverage);
  const result = useQuery({
    queryKey: ["active-mileage-overage", rentalIds],
    queryFn: () => load({ data: { rentalIds } }),
  });
  const value: OverageView = result.isError
    ? { status: "error", byId: new Map(), truncated: false }
    : result.isLoading || !result.data
      ? { status: "loading", byId: new Map(), truncated: false }
      : {
          status: "ready",
          byId: new Map(result.data.rows.map((row) => [row.rentalId, row.label])),
          truncated: result.data.truncated,
        };
  return <MileageOverageContext.Provider value={value}>{children}</MileageOverageContext.Provider>;
}

function MileageOverageNotice() {
  const overage = useContext(MileageOverageContext);
  if (overage.status === "error") return <p className="mb-2 text-[12px] text-[#D03020]">Could Not Load Mileage Overage</p>;
  if (overage.truncated) return <p className="mb-2 text-[12px] text-muted-foreground">Mileage Overage Is Capped</p>;
  return null;
}

function MileageOverageHeader() {
  const overage = useContext(MileageOverageContext);
  if (overage.status === "off") return null;
  return <th className="px-3 py-2 font-medium">Mileage Overage</th>;
}

function MileageOverageCell({ rentalId }: { rentalId: string }) {
  const overage = useContext(MileageOverageContext);
  if (overage.status === "off") return null;
  const text = overage.status === "ready" ? overage.byId.get(rentalId) ?? "Unknown" : "Unknown";
  return <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{text}</td>;
}

function MileageOverageLine({ rentalId }: { rentalId: string }) {
  const overage = useContext(MileageOverageContext);
  if (overage.status === "off") return null;
  const text = overage.status === "ready" ? overage.byId.get(rentalId) ?? "Unknown" : "Unknown";
  return <div className="mt-1 text-[13px] text-muted-foreground">Mileage Overage · {text}</div>;
}
