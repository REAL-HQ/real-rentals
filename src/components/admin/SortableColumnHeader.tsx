import { ArrowDown, ArrowUp } from "lucide-react";
import { ariaSortValue, type SortDir } from "@/lib/admin-table-sort";

export function SortableColumnHeader({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  dir?: SortDir;
  align?: "left" | "right";
  onClick: () => void;
}) {
  const aria = ariaSortValue(active, dir);
  const tip =
    !active
      ? `Sort by ${label}`
      : dir === "asc"
        ? `${label}, sorted A to Z or lowest first. Click to reverse.`
        : `${label}, sorted Z to A or highest first. Click to clear or reverse.`;
  return (
    <th
      scope="col"
      aria-sort={aria}
      className={`${align === "right" ? "text-right" : "text-left"} px-3 py-2.5`}
    >
      <button
        type="button"
        onClick={onClick}
        title={tip}
        aria-label={tip}
        className={`inline-flex max-w-full items-center gap-1 rounded-sm font-semibold tracking-[0.12em] text-[#9A9AA3] hover:text-[#55555E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D03020]/40 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}
