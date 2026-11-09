import { useNavigate } from "@tanstack/react-router";
import { ActiveRentalsPanel } from "./ActiveRentalsPanel";
import { BookingsPanel } from "./BookingsPanel";
import { ReservationsPanel } from "./ReservationsPanel";
import { BOOKINGS_VIEWS, parseBookingsView, type BookingsView } from "@/lib/bookings-workspace";

export { BOOKINGS_VIEWS, parseBookingsView } from "@/lib/bookings-workspace";

/**
 * One Bookings page under Rentals: Booked, Active, and Past.
 * Default tab is Active. Old ?tab=active_rentals links land here via LEGACY_TABS.
 */
type ListState = { q?: string; phase?: string; sort?: string; page?: string; vehicle?: string };

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
  const effective = parseBookingsView(view, { canViewBoard, openId });

  const setView = (next: BookingsView) => {
    void navigate({
      to: "/admin",
      search: {
        tab: "bookings",
        view: next === "active" ? undefined : next,
        ...(next === "past" ? listState : {}),
      } as never,
      replace: true,
    });
  };

  return (
    <div className="space-y-4" data-testid="bookings-workspace">
      <div className="admin-sticky-bar flex flex-wrap items-center gap-1.5">
        {BOOKINGS_VIEWS.map((item) => {
          if (item.id === "active" && !canViewBoard) return null;
          if (item.id === "booked" && !canManageReservations && !canViewBoard) return null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-pressed={effective === item.id}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                effective === item.id
                  ? "border-[#D03020] bg-[#D03020] text-white"
                  : "border-[#EDEDF0] bg-white text-[#55555E] hover:border-[#D6D6DB]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {effective === "booked" ? (
        <ReservationsPanel canManage={canManageReservations} />
      ) : effective === "active" ? (
        <ActiveRentalsPanel />
      ) : (
        <BookingsPanel openId={openId} canViewConversion={canViewConversion} listState={listState} />
      )}
    </div>
  );
}
