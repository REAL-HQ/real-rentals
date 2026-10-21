import { formatRecordNumber, type RecordKind } from "@/lib/record-numbers";

/** Compact "Swap S-001" chip. Shows "—" until a persisted number exists. */
export function RecordNumber({
  label,
  value,
  className = "",
}: {
  label: "Customer" | "Booking" | "Swap";
  value: number | null | undefined;
  className?: string;
}) {
  const kind = label.toLowerCase() as RecordKind;
  const text = formatRecordNumber(kind, value);
  return (
    <span
      data-record-number={kind}
      className={`inline-flex items-center gap-1 rounded bg-[#F4F4F6] px-1.5 py-0.5 text-[11px] font-medium text-[#55555E] tabular-nums ${className}`}
    >
      {label} <span className="text-[#111114]">{text ?? "—"}</span>
    </span>
  );
}
