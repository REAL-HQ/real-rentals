import { PUBLIC_AVAILABILITY_DATE_COLUMN, type PublicAvailability } from "@/lib/public-availability";

const TONE = {
  now: "border-emerald-200 bg-emerald-50 text-emerald-800",
  soon: "border-amber-200 bg-amber-50 text-amber-900",
  rented: "border-border bg-white text-foreground",
} as const;

/** Read-only badge. Mounted only while PUBLIC_AVAILABILITY_ENABLED is true. */
export function PublicAvailabilityBadge({ availability }: { availability: PublicAvailability }) {
  const text = availability.date ? `${availability.label} · ${availability.date}` : availability.label;
  return (
    <p className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${TONE[availability.kind]}`}>
      {text}
      {availability.missing.length > 0 ? (
        <span className="sr-only"> Date not on vehicles_public. Needs {PUBLIC_AVAILABILITY_DATE_COLUMN}.</span>
      ) : null}
    </p>
  );
}

/** Optional filter. 44px tall so it is a real tap target on a phone. */
export function ShowAvailableOnly({
  pressed,
  onPressed,
}: {
  pressed: boolean;
  onPressed: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressed(!pressed)}
      className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg border px-4 text-sm font-medium sm:w-auto ${
        pressed ? "border-real-red bg-real-red text-white" : "border-border bg-white text-foreground"
      }`}
    >
      Show Available Only
    </button>
  );
}
