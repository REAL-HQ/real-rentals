import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./VehicleProfileFields";
import { bodyTypeLabel } from "@/lib/vehicle-defaults";

// Display labels come from the shared map; stored values stay lowercase.
// Same order as BODY_TYPES in vehicles.functions (not imported: server module).
const BODY_TYPE_ORDER = ["sedan", "suv", "xl", "truck", "van", "minivan", "coupe", "hatchback", "wagon", "convertible", "other"] as const;
export const VEHICLE_BODY_TYPE_OPTIONS = BODY_TYPE_ORDER.map((b) => [b, bodyTypeLabel(b)] as const);

export function VehicleBodyTypeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Body Type">
      <Select value={value || "__none__"} onValueChange={(next) => onChange(next === "__none__" ? "" : next)}>
        <SelectTrigger aria-label="Body Type" className="h-9 w-full min-w-0 bg-white text-[13px]">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        {/* The vehicle drawer is z-60; the portal must sit above it. */}
        <SelectContent className="z-[70] bg-white" position="popper">
          <SelectItem value="__none__">—</SelectItem>
          {VEHICLE_BODY_TYPE_OPTIONS.map(([stored, label]) => <SelectItem key={stored} value={stored}>{label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
