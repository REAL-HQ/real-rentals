import type { FleetFilterState } from "@/lib/fleet-filters";

const control =
  "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base text-foreground";

export function FleetFiltersBar({
  makes,
  value,
  onChange,
}: {
  makes: string[];
  value: FleetFilterState;
  onChange: (next: FleetFilterState) => void;
}) {
  const setRate = (key: "minRate" | "maxRate", raw: string) => {
    if (raw.trim() === "") {
      onChange({ ...value, [key]: null });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange({ ...value, [key]: parsed });
  };

  return (
    <div className="rounded-2xl bg-soft p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span>Make</span>
          <select
            className={control}
            value={value.make}
            onChange={(event) => onChange({ ...value, make: event.target.value })}
          >
            <option value="all">All Makes</option>
            {makes.map((make) => (
              <option key={make} value={make}>
                {make}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Min Weekly Rate</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            className={control}
            value={value.minRate ?? ""}
            onChange={(event) => setRate("minRate", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Max Weekly Rate</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            className={control}
            value={value.maxRate ?? ""}
            onChange={(event) => setRate("maxRate", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Sort</span>
          <select
            className={control}
            value={value.sort}
            onChange={(event) => {
              const sort = event.target.value;
              if (sort !== "price_asc" && sort !== "price_desc" && sort !== "newest") return;
              onChange({ ...value, sort });
            }}
          >
            <option value="price_asc">Price: Low To High</option>
            <option value="price_desc">Price: High To Low</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border bg-white px-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[#D03020]"
            checked={value.uberOnly}
            onChange={(event) => onChange({ ...value, uberOnly: event.target.checked })}
          />
          Uber Eligible Only
        </label>
        <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border bg-white px-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[#D03020]"
            checked={value.availableOnly}
            onChange={(event) => onChange({ ...value, availableOnly: event.target.checked })}
          />
          Available Only
        </label>
      </div>
    </div>
  );
}
