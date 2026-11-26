import { AppSelect } from "@/components/ui/app-select";
import { PHOTO_CLASS_OPTIONS, photoClassLabel, type PhotoClass } from "@/lib/photo-studio";

/** Angle on one original. Hidden by the caller when photo_class is not migrated. */
export function PhotoClassSelect({
  value,
  disabled,
  onChange,
}: {
  value: string | null | undefined;
  disabled?: boolean;
  onChange: (photoClass: PhotoClass) => void;
}) {
  const current = PHOTO_CLASS_OPTIONS.some((o) => o.value === value) ? value! : "unknown";
  return (
    <label className="block">
      <span className="sr-only">Photo Angle</span>
      <AppSelect
        aria-label="Photo Angle"
        value={current}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as PhotoClass;
          if (next !== current) onChange(next);
        }}
        className="h-7 w-full rounded-md border border-[#EDEDF0] bg-white px-1.5 text-[11px] text-[#111114]"
      >
        {PHOTO_CLASS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </AppSelect>
    </label>
  );
}

export function PhotoClassLabel({ value }: { value: string | null | undefined }) {
  return <span className="block truncate text-[11px] text-[#55555E]">{photoClassLabel(value)}</span>;
}
