import { Link, useNavigate } from "@tanstack/react-router";
import { ActiveRentalsPanel } from "./ActiveRentalsPanel";
import { BookingsPanel } from "./BookingsPanel";

/**
 * Single Active page: the On Rent board plus the full rental list that used
 * to live under Bookings. Old ?tab=bookings links redirect here.
 */
type ListState = { q?: string; phase?: string; sort?: string; page?: string; vehicle?: string };

const VIEWS = [
  { id: "board", label: "On Rent" },
  { id: "all", label: "All Rentals" },
] as const;

export function ActivePanel({
  openId = null,
  canViewBoard = false,
  canViewConversion = false,
  view,
  listState = {},
}: {
  openId?: string | null;
  /** Manager+ — the On Rent board reads payments, issues, and incidents. */
  canViewBoard?: boolean;
  canViewConversion?: boolean;
  view?: string;
  listState?: ListState;
}) {
  const navigate = useNavigate();
  // A deep link with a rental id opens the All Rentals drawer. Coordinators
  // only ever see All Rentals; the board stays Manager+.
  const requested = view === "all" || view === "board" ? view : null;
  const effective: (typeof VIEWS)[number]["id"] = !canViewBoard
    ? "all"
    : openId
      ? "all"
      : requested === "all"
        ? "all"
        : "board";

  const setView = (next: (typeof VIEWS)[number]["id"]) => {
    void navigate({
      to: "/admin",
      search: {
        tab: "active_rentals",
        view: next === "board" ? undefined : next,
        ...(next === "all" ? listState : {}),
      } as never,
      replace: true,
    });
  };

  return (
    <div className="space-y-4" data-testid="active-panel">
      {canViewBoard ? (
        <div className="admin-sticky-bar flex flex-wrap items-center gap-1.5">
          {VIEWS.map((item) => (
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
          ))}
          {effective === "board" ? (
            <Link
              to="/admin"
              search={{ tab: "active_rentals", view: "all" }}
              className="ml-auto text-xs font-medium text-[#55555E] hover:text-[#111114]"
            >
              Search Past Rentals
            </Link>
          ) : null}
        </div>
      ) : null}

      {effective === "board" ? (
        <ActiveRentalsPanel />
      ) : (
        <BookingsPanel
          openId={openId}
          canViewConversion={canViewConversion}
          listState={listState}
        />
      )}
    </div>
  );
}
