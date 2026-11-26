import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ActiveRentalsPanel } from "./ActiveRentalsPanel";
import { BookingsPanel } from "./BookingsPanel";
import { ReservationsPanel } from "./ReservationsPanel";
import { BOOKINGS_VIEWS, parseBookingsView, type BookingsView } from "@/lib/bookings-workspace";

export { BOOKINGS_VIEWS, parseBookingsView } from "@/lib/bookings-workspace";

/**
 * One Bookings page under Rentals: Reserved, Active, Completed, and Cancelled.
 * Default tab is Active. Old ?view=past links open Completed.
 */
type ListState = { q?: string; phase?: string; sort?: string; page?: string; vehicle?: string };
type EndedCounts = { completed: number; cancelled: number; swap: number };

export function BookingsWorkspace({
  openId = null,
  canViewBoard = false,
  canViewConversion = false,
  canManageReservations = false,
  view,
  listState = {},
}: {
  openId?: string | null;
  canViewBoard?: boolean;
  canViewConversion?: boolean;
  /** Manager+ — create / cancel / record deposit. */
  canManageReservations?: boolean;
  view?: string;
  listState?: ListState;
}) {
  const navigate = useNavigate();
  const parsed = parseBookingsView(view, { canViewBoard, openId });
  const phaseHint = String(listState.phase ?? "").toLowerCase();
  // Old Past chip links (?view=past&phase=cancelled or phase=swap) open Cancelled.
  const effective: BookingsView =
    parsed === "completed" && (phaseHint === "cancelled" || phaseHint === "canceled" || phaseHint === "swap")
      ? "cancelled"
      : parsed;
  const [endedCounts, setEndedCounts] = useState<EndedCounts | null>(null);

  const setView = (next: BookingsView) => {
    const filters = { ...listState };
    delete filters.phase;
    void navigate({
      to: "/admin",
      search: {
        tab: "bookings",
        view: next === "active" ? undefined : next,
        ...(next === "completed" || next === "cancelled" ? filters : {}),
      } as never,
      replace: true,
    });
  };

  const tabCount = (id: BookingsView): number | null => {
    if (!endedCounts) return null;
    if (id === "completed") return endedCounts.completed;
    if (id === "cancelled") return endedCounts.cancelled + endedCounts.swap;
    return null;
  };

  return (
    <div className="space-y-4" data-testid="bookings-workspace">
      <div className="admin-sticky-bar flex flex-wrap items-end gap-5 border-b border-border">
        {BOOKINGS_VIEWS.map((item) => {
          if (item.id === "active" && !canViewBoard) return null;
          if (item.id === "reserved" && !canManageReservations && !canViewBoard) return null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-pressed={effective === item.id}
              className={`-mb-px border-b-2 px-0.5 pb-2 text-sm font-semibold transition-colors ${
                effective === item.id
                  ? "border-[#D03020] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
              {tabCount(item.id) != null && (
                <span className="ml-1.5 font-medium tabular-nums text-muted-foreground">{tabCount(item.id)}</span>
              )}
            </button>
          );
        })}
      </div>

      {effective === "reserved" ? (
        <ReservationsPanel canManage={canManageReservations} />
      ) : effective === "active" ? (
        <ActiveRentalsPanel />
      ) : (
        <BookingsPanel
          openId={openId}
          canViewConversion={canViewConversion}
          listState={listState}
          scope={effective}
          onCounts={setEndedCounts}
        />
      )}
    </div>
  );
}
