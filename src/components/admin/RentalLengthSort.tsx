import type { RentalLengthOrder } from "@/lib/rental-length-order";

const OPTIONS: { value: RentalLengthOrder; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "longest", label: "Longest First" },
  { value: "shortest", label: "Shortest First" },
];

/** Same length control on every Bookings tab, sitting beside that tab's count. */
export function RentalLengthSort({
  value,
  onChange,
}: {
  value: RentalLengthOrder;
  onChange: (next: RentalLengthOrder) => void;
}) {
  return (
    <select
      aria-label="Rental Length"
      title="Length order. Default keeps the list as it is."
      data-testid="rental-length-sort"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "default" || next === "longest" || next === "shortest") onChange(next);
      }}
      className="h-9 w-[158px] shrink-0 cursor-pointer rounded-md border border-[#D6D6DB] bg-white px-2.5 text-sm text-[#111114]"
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
