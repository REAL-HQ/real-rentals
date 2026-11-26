import { isBookingsListMode, type BookingsListMode } from "@/lib/rental-length-order";

const OPTIONS: { value: BookingsListMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "longest", label: "Longest First" },
  { value: "shortest", label: "Shortest First" },
  { value: "owes", label: "Owes Money" },
];

/** Same control on every Bookings tab: length order, or only rows that owe. */
export function RentalLengthSort({
  value,
  onChange,
  owesCount = null,
}: {
  value: BookingsListMode;
  onChange: (next: BookingsListMode) => void;
  /** Bookings with a balance due. Shown on the Owes Money option. */
  owesCount?: number | null;
}) {
  return (
    <select
      aria-label="Bookings Filter"
      title="Length order, or only bookings that owe money."
      data-testid="rental-length-sort"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        if (isBookingsListMode(next)) onChange(next);
      }}
      className="h-9 w-[188px] shrink-0 cursor-pointer rounded-md border border-[#D6D6DB] bg-white px-2.5 text-sm text-[#111114]"
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.value === "owes" && owesCount != null ? `Owes Money (${owesCount})` : option.label}
        </option>
      ))}
    </select>
  );
}
