import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./VehicleProfileFields";

// Display labels only. The database/API values deliberately remain lowercase.
export const VEHICLE_BODY_TYPE_OPTIONS = [
  ["sedan", "Sedan"], ["suv", "SUV"], ["xl", "XL"], ["truck", "Truck"],
  ["van", "Van"], ["minivan", "Minivan"], ["coupe", "Coupe"],
  ["hatchback", "Hatchback"], ["wagon", "Wagon"],
  ["convertible", "Convertible"], ["other", "Other"],
] as const;

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
