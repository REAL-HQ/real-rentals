import { VehicleCell } from "./VehicleCell";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { rowOpenProps, ROW_OPEN_CLASS } from "@/lib/row-click";
import { CalendarCheck, ChevronLeft, ChevronRight, ArrowRight, MoreHorizontal } from "lucide-react";
import { listBookings } from "@/lib/bookings.functions";
import {
  BOOKING_LIST_PAGE_SIZE,
  BOOKING_PHASE_LABEL,
  bookingDates,
  bookingVehicleName,
  isBookingPhaseFilter,
  type BookingListResult,
  type BookingPhase,
  type BookingRow,
} from "@/lib/bookings-list";
import { OPEN_COLUMN } from "./open-column";
import { BookingDetails } from "./BookingDetails";
import { BookingConversion } from "./BookingConversion";
import { AdminTableScroll } from "./AdminTableScroll";
import { EmptyState, StatusPill } from "./ui";
import { fmtDate } from "@/lib/date-format";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { endedLengthDays, orderByLength, type RentalLengthOrder } from "@/lib/rental-length-order";
import { RentalLengthSort } from "./RentalLengthSort";
import { listKeptFeeCreditOffers } from "@/lib/forfeited-fee-credit.functions";
import type { ForfeitedFeeCreditMode, KeptFeeOffer } from "@/lib/forfeited-fee-credit";
import { convertReservationFeeToCredit } from "@/lib/rental-hold.functions";
import { ROW_MENU_COLUMN } from "./open-column";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
// Completed and Cancelled are their own tabs. This list keeps search and sort.
// There is deliberately no phase chip: the tab already says which rows these are.

type ListState = { q?: string; phase?: string; sort?: string; page?: string; vehicle?: string };

const PHASE_TONE: Record<BookingPhase, "green" | "neutral" | "red" | "amber"> = {
  active: "green",
  completed: "neutral",
  cancelled: "red",
  reserved: "amber",
  swap: "amber",
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

function BookingVehicleCell({ b }: { b: BookingRow }) {
  if (!b.vehicleId) return <span className="text-muted-foreground">Unknown</span>;
  return <VehicleCell vehicleId={b.vehicleId} vehicle={b} thumbnailPath={b.thumbnailPath ?? null} />;
}

function RentalLength({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return (
    <span className="block text-xs text-foreground" data-testid="rental-length">
      {label}
    </span>
  );
}

export function BookingsPanel({
  externalSearch = "",
  openId = null,
  listState = {},
  canViewConversion = false,
  /** Which rental statuses this list is allowed to show. */
  scope = "all",
  onCounts,
  previewRows,
  initialLengthOrder = "default",
  canManage = false,
  previewKeptFees,
  previewCreditMode = "case_by_case",
  previewMenuOpen = false,
}: {
  externalSearch?: string;
  openId?: string | null;
  listState?: ListState;
  /** Owner and Manager. The conversion server function requires a manager, and the flag still has to be on. */
  canViewConversion?: boolean;
  scope?: "past" | "all" | "completed" | "cancelled";
  /** Completed and Cancelled totals, including swap rows counted with Cancelled. */
  onCounts?: (counts: { completed: number; cancelled: number; swap: number }) => void;
  /** Skip the server read and render these rows. The alignment test uses this. */
  previewRows?: BookingRow[];
  initialLengthOrder?: RentalLengthOrder;
  /** Manager+. The credit server function checks again. */
  canManage?: boolean;
  /** Skip the kept-fee lookup. Screenshots and tests pass these offers. */
  previewKeptFees?: KeptFeeOffer[];
  previewCreditMode?: ForfeitedFeeCreditMode;
  previewMenuOpen?: boolean;
} = {}) {
  const navigate = useNavigate();
  const [lengthOrder, setLengthOrder] = useState<RentalLengthOrder>(initialLengthOrder);
  const [keptFees, setKeptFees] = useState<KeptFeeOffer[]>(previewKeptFees ?? []);
  const [creditMode, setCreditMode] = useState<ForfeitedFeeCreditMode>(previewCreditMode);
  const loadOffers = useServerFn(listKeptFeeCreditOffers);
  const loadOffersRef = useRef(loadOffers);
  loadOffersRef.current = loadOffers;
  const keepFee = useServerFn(convertReservationFeeToCredit);

  // List state lives in the URL so refresh, back and shared links keep it.
  const q = listState.q ?? "";
  const endedScope = scope === "completed" || scope === "cancelled";
  const rawPhase = isBookingPhaseFilter(listState.phase) ? listState.phase : "all";
  const phase = endedScope || (scope === "past" && rawPhase === "active") ? "all" : rawPhase;
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
      const view = scope === "cancelled" ? "cancelled" : scope === "completed" ? "completed" : "past";
      const out: Record<string, string> = { tab: "bookings", view };
      if (next.q) out.q = next.q;
      if (!endedScope && next.phase && next.phase !== "all") out.phase = next.phase;
      if (next.sort && next.sort !== "recent") out.sort = next.sort;
      if (next.page && next.page !== "1") out.page = next.page;
      if (next.vehicle) out.vehicle = next.vehicle;
      return out;
    },
    [q, phase, sort, page, vehicleFilter, scope, endedScope],
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
    scope,
    sort,
    length: lengthOrder,
    page,
    pageSize: BOOKING_LIST_PAGE_SIZE,
    ...(vehicleFilter ? { vehicleId: vehicleFilter } : {}),
  };
  const listQuery = useQuery({
    queryKey: ["admin-bookings-list", params],
    queryFn: () => fetchList({ data: params }),
    placeholderData: keepPreviousData,
    enabled: !previewRows,
  });
  const orderedPreview = useMemo(
    () =>
      previewRows
        ? orderByLength(previewRows, (row) => endedLengthDays(row.startDate, row.endDate), lengthOrder)
        : undefined,
    [previewRows, lengthOrder],
  );
  const previewResult: BookingListResult | undefined =
    previewRows && orderedPreview
      ? {
          rows: orderedPreview,
          total: orderedPreview.length,
          page: 1,
          pageSize: BOOKING_LIST_PAGE_SIZE,
          counts: {
            active: 0,
            completed: previewRows.filter((r) => r.phase === "completed").length,
            cancelled: previewRows.filter((r) => r.phase === "cancelled").length,
            swap: previewRows.filter((r) => r.phase === "swap").length,
          },
          canSeeMoney: true,
        }
      : undefined;
  const result = previewResult ?? listQuery.data;
  useEffect(() => {
    if (!result?.counts || !onCounts) return;
    onCounts({
      completed: result.counts.completed ?? 0,
      cancelled: result.counts.cancelled ?? 0,
      swap: result.counts.swap ?? 0,
    });
  }, [result, onCounts]);
  const rows = result?.rows ?? [];
  const showFeeMenu = scope === "cancelled" && canManage;
  const rentalIdKey = rows.map((row) => row.id).join(",");
  useEffect(() => {
    if (previewKeptFees || scope !== "cancelled") return;
    const ids = rentalIdKey.split(",").filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    if (!ids.length) return;
    let alive = true;
    loadOffersRef.current({ data: { rentalIds: ids } })
      .then((found) => {
        if (!alive || !found?.offers || !found.mode) return;
        setKeptFees((current) => (JSON.stringify(current) === JSON.stringify(found.offers) ? current : found.offers));
        setCreditMode(found.mode);
      })
      .catch(() => {
        if (alive) setKeptFees([]);
      });
    return () => {
      alive = false;
    };
  }, [previewKeptFees, scope, rentalIdKey]);
  const offerFor = (id: string) => keptFees.find((offer) => offer.rentalId.toLowerCase() === id.toLowerCase()) ?? null;
  const onKeepFee = async (offer: KeptFeeOffer, name: string | null) => {
    if (!window.confirm(`Keep ${name ?? "This Renter"}'s Reservation Fee As A Credit Toward Their Next Rental?`)) return;
    try {
      await keepFee({ data: { paymentId: offer.paymentId } });
      toast.success("Credit Saved");
      setKeptFees((current) => current.filter((row) => row.paymentId !== offer.paymentId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save Credit");
    }
  };
  const total = result?.total ?? 0;
  const money = !!result?.canSeeMoney;
  const pages = Math.max(1, Math.ceil(total / BOOKING_LIST_PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * BOOKING_LIST_PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * BOOKING_LIST_PAGE_SIZE);
  const hasActiveFilters = q !== "" || (!endedScope && phase !== "all") || !!vehicleFilter;
  const swapCount = result?.counts?.swap ?? 0;

  return (
    <div>
      <div className="admin-sticky-bar mb-4 flex flex-col gap-2 pb-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex max-lg:w-full max-lg:min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search driver, email, unit, plate, VIN…"
          aria-label="Search rentals"
          className="w-full min-w-0 rounded-md border border-border bg-white px-3 py-2 text-sm lg:w-auto lg:min-w-[200px] lg:flex-1"
        />
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:contents">
          {endedScope && result && (
            <span className="whitespace-nowrap text-sm text-muted-foreground" data-testid="booking-count">
              {total} {scope === "cancelled" ? "Cancelled" : "Completed"} Rental{total === 1 ? "" : "s"}
              {scope === "cancelled" && swapCount > 0 ? ` · ${swapCount} Swap` : ""}
            </span>
          )}
          <RentalLengthSort
            value={lengthOrder}
            onChange={(next) => {
              setLengthOrder(next);
              if (page !== 1) setList({});
            }}
          />
          <Select value={sort} onValueChange={(v) => setList({ sort: v })}>
            <SelectTrigger
              className="h-9 w-[150px] max-lg:shrink-0 bg-white text-foreground text-sm"
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
              className="max-lg:shrink-0 max-lg:whitespace-nowrap px-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        </div>
      </div>

      <BookingConversion canView={canViewConversion} />

      {rows.length > 0 && (
        <AdminTableScroll className="hidden md:block rounded-xl border border-border bg-white">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-[#FAFAFB] text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[22%] px-2 py-2 font-medium">Driver</th>
                <th className="w-[20%] px-2 py-2 font-medium">Vehicle</th>
                <th className="w-[24%] px-2 py-2 font-medium">Dates</th>
                <th className="w-[12%] px-2 py-2 font-medium">Status</th>
                {money ? <th className="w-[14%] px-2 py-2 font-medium">Rent</th> : null}
                <th className={`${OPEN_COLUMN} py-2 font-medium`}>Open</th>
                {showFeeMenu ? <th className={`${ROW_MENU_COLUMN} py-2 font-medium`} /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.id}
                  data-booking={b.id}
                  className={`border-t border-border ${ROW_OPEN_CLASS}`}
                  {...rowOpenProps(() => setViewing(b.id))}
                >
                  <td className="px-2 py-2 align-top">
                    <DriverCell b={b} />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <BookingVehicleCell b={b} />
                  </td>
                  <td className="px-2 py-2 align-top text-muted-foreground">
                    <span className="block">{b.startDate ? fmtDate(b.startDate) : "Not recorded"}</span>
                    <span className="block text-xs">
                      → {b.endDate ? fmtDate(b.endDate) : b.openEnded ? "Open-ended" : "Not recorded"}
                    </span>
                    <RentalLength label={b.lengthLabel} />
                  </td>
                  <td className="px-2 py-2 align-top">
                    <StatusPill status={b.phase} tone={PHASE_TONE[b.phase]}>
                      {BOOKING_PHASE_LABEL[b.phase]}
                    </StatusPill>
                    {creditMode === "case_by_case" && offerFor(b.id) ? (
                      <span className="mt-1 block text-[11px] font-medium leading-snug text-[#8A6A00]" data-testid="fee-kept-undecided">
                        Fee Kept, Credit Not Decided
                      </span>
                    ) : null}
                  </td>
                  {money ? (
                    <td className="px-2 py-2 align-top tabular-nums">
                      <span className="block">{usd(b.weeklyRate)}/wk</span>
                      {(b.balanceDue ?? 0) > 0 ? (
                        <span className="block text-xs font-medium text-[#D03020]">{usd(b.balanceDue)} due</span>
                      ) : (
                        <span className="block text-xs text-muted-foreground">Settled</span>
                      )}
                    </td>
                  ) : null}
                  <td className={`${OPEN_COLUMN} py-2`}>
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
                  {showFeeMenu ? (
                    <td className={`${ROW_MENU_COLUMN} relative py-2`} onClick={(e) => e.stopPropagation()}>
                      {offerFor(b.id) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions For ${b.driverName ?? "Reservation"}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[#FAFAFB] hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white">
                            <DropdownMenuItem
                              onSelect={() => {
                                const offer = offerFor(b.id);
                                if (offer) void onKeepFee(offer, b.driverName);
                              }}
                            >
                              Keep Fee As Credit
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                      {previewMenuOpen && offerFor(b.id) ? (
                        <div className="absolute right-1 top-10 z-30 min-w-[11.5rem] rounded-md border border-[#EDEDF0] bg-white p-1 text-left shadow-sm" data-testid="kept-fee-menu">
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-[#111114]"
                            onClick={() => {
                              const offer = offerFor(b.id);
                              if (offer) void onKeepFee(offer, b.driverName);
                            }}
                          >
                            Keep Fee As Credit
                          </button>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
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
              {...rowOpenProps(() => setViewing(b.id))}
              data-booking-card={b.id}
              className="rounded-2xl bg-soft p-4 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D03020]/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <DriverCell b={b} />
                </div>
                <StatusPill className="shrink-0" status={b.phase} tone={PHASE_TONE[b.phase]}>
                  {BOOKING_PHASE_LABEL[b.phase]}
                </StatusPill>
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {bookingVehicleName(b)}
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                {bookingDates(b.startDate, b.endDate, b.phase)}
                <RentalLength label={b.lengthLabel} />
              </div>
              {money && (
                <div className="mt-2 text-[13px]">
                  <span className="text-muted-foreground">{usd(b.weeklyRate)}/wk</span>
                  {(b.balanceDue ?? 0) > 0 && (
                    <span className="ml-2 font-medium text-[#D03020]">{usd(b.balanceDue)} due</span>
                  )}
                </div>
              )}
              {creditMode === "case_by_case" && offerFor(b.id) ? (
                <p className="mt-2 text-[12px] font-medium text-[#8A6A00]" data-testid="fee-kept-undecided">Fee Kept, Credit Not Decided</p>
              ) : null}
              {showFeeMenu && offerFor(b.id) ? (
                <button
                  type="button"
                  className="mt-2 inline-flex h-8 items-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114]"
                  onClick={(e) => {
                    e.stopPropagation();
                    const offer = offerFor(b.id);
                    if (offer) void onKeepFee(offer, b.driverName);
                  }}
                >
                  Keep Fee As Credit
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {result && total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground max-lg:flex-wrap max-lg:gap-x-3 max-lg:gap-y-2">
          <span>
            Showing {firstShown}–{lastShown} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setList({ page: String(page - 1) })}
              aria-label="Previous Page"
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
              aria-label="Next Page"
              className="rounded-md border border-border bg-white p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {listQuery.isError && (
        <div className="mt-6 text-sm text-real-red">Could not load rentals.</div>
      )}
      {result && total === 0 && !hasActiveFilters && !effectiveQ && (
        <EmptyState
          className="mt-6"
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title={
            scope === "completed"
              ? "No Completed Rentals"
              : scope === "cancelled"
                ? "No Cancelled Rentals"
                : scope === "past"
                  ? "No Past Rentals"
                  : "No Rentals Yet"
          }
          hint={
            scope === "completed"
              ? "Completed rentals show up here after they end."
              : scope === "cancelled"
                ? "Cancelled rentals show up here. A row ended by a vehicle swap is included and labeled Swap."
                : scope === "past"
                  ? "Completed and canceled rentals will show up here after they end."
                  : "A rental appears here when it is activated from an approved driver's record."
          }
        />
      )}
      {result && total === 0 && (hasActiveFilters || !!effectiveQ) && (
        <EmptyState
          className="mt-6"
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title="No Matching Rentals"
          hint={
            phase !== "all"
              ? `No ${BOOKING_PHASE_LABEL[phase as BookingPhase].toLowerCase()} rental matches this view.`
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
  );
}
