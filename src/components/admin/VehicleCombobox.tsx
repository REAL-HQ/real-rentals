"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { displayTitleCase, displayVehicleWord } from "@/lib/display-normalize";
import { VehiclePickerPhoto } from "./VehiclePickerPhoto";
import { VehicleStatusBadge } from "@/components/VehicleStatusBadge";
import {
  formatVehicleLabel,
  vehicleMatchesQuery,
  vinLast6,
  type VehicleLabelSource,
} from "@/lib/vehicle-label";

export type VehicleComboboxVehicle = VehicleLabelSource & { id: string };

type Props = {
  vehicles: VehicleComboboxVehicle[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Show a clear / none option. Default true. */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Staff vehicle choices use the same thumbnail-first columns by default. */
  photoColumns?: boolean;
  "aria-label"?: string;
};

/**
 * Searchable vehicle picker. Value is always vehicle.id.
 * Works inside dialogs (modal popover + elevated z-index).
 */
export function VehicleCombobox({
  vehicles,
  value,
  onChange,
  placeholder = "Select Vehicle…",
  allowNone = true,
  noneLabel = "— None —",
  disabled,
  className,
  triggerClassName,
  photoColumns = true,
  "aria-label": ariaLabel = "Vehicle",
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");

  const selected = value ? vehicles.find((v) => v.id === value) : null;
  const filtered = React.useMemo(
    () => vehicles.filter((v) => vehicleMatchesQuery(v, q)),
    [vehicles, q],
  );

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-popover px-3 text-left text-sm font-normal text-popover-foreground shadow-sm hover:bg-popover disabled:cursor-not-allowed disabled:opacity-50",
            photoColumns && selected && "h-12",
            triggerClassName,
          )}
        >
          {photoColumns && selected ? <VehiclePickerPhoto vehicleId={selected.id} /> : null}
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? formatVehicleLabel(photoColumns ? { ...selected, unit_number: null, status: displayTitleCase(selected.status ?? "") } : selected) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "z-[200] w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,22rem)] max-w-[36rem] p-0",
          className,
          photoColumns && "w-[min(48rem,var(--radix-popover-trigger-width))] min-w-[min(48rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} className="rounded-md">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search Plate, VIN, Unit, Make…"
            aria-label="Search Vehicles"
          />
          {photoColumns ? <div aria-hidden="true" className="mx-1 grid grid-cols-[1rem_3rem_minmax(0,1fr)_5.5rem] items-center gap-2 border-b border-border px-2 py-2 text-[10px] font-semibold text-muted-foreground sm:grid-cols-[1rem_3rem_minmax(0,1fr)_5rem_5rem_6rem]">
            <span /><span>Photo</span><span>Vehicle</span><span className="hidden sm:block">Plate</span><span className="hidden sm:block">VIN</span><span>Status</span>
          </div> : null}
          <CommandList>
            {photoColumns ? (filtered.length === 0 ? <div role="status" className="py-6 text-center text-sm text-muted-foreground">No Vehicles Match.</div> : null) : <CommandEmpty>No vehicles match.</CommandEmpty>}
            <CommandGroup>
              {allowNone ? (
                <CommandItem
                  value="__none__"
                  className={photoColumns ? "min-h-11 data-[selected=true]:bg-muted data-[selected=true]:text-popover-foreground" : undefined}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">{noneLabel}</span>
                </CommandItem>
              ) : null}
              {filtered.map((v) => {
                const label = formatVehicleLabel(photoColumns ? { ...v, unit_number: null, status: displayTitleCase(v.status ?? "") } : v);
                return (
                  <CommandItem
                    key={v.id}
                    value={v.id}
                    aria-label={label}
                    className={photoColumns ? "grid min-h-14 grid-cols-[1rem_3rem_minmax(0,1fr)_5.5rem] gap-2 border-b border-border/50 py-2 last:border-b-0 data-[selected=true]:bg-muted data-[selected=true]:text-popover-foreground sm:grid-cols-[1rem_3rem_minmax(0,1fr)_5rem_5rem_6rem]" : undefined}
                    onSelect={() => {
                      onChange(v.id);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <Check
                      className={cn("h-4 w-4 shrink-0", !photoColumns && "mr-2", value === v.id ? "opacity-100" : "opacity-0")}
                    />
                    {photoColumns ? <>
                      <VehiclePickerPhoto vehicleId={v.id} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium">{[v.year, displayVehicleWord(v.make ?? ""), displayVehicleWord(v.model ?? "")].filter(Boolean).join(" ") || "Vehicle"}</span>
                        <span className="block truncate text-[10px] text-muted-foreground sm:hidden">{v.license_plate || "—"} · VIN …{vinLast6(v.vin) || "—"}</span>
                      </span>
                      <span className="hidden min-w-0 truncate text-[11px] tabular-nums sm:block">{v.license_plate || "—"}</span>
                      <span className="hidden min-w-0 truncate text-[11px] tabular-nums text-muted-foreground sm:block">{vinLast6(v.vin) || "—"}</span>
                      <VehicleStatusBadge status={v.status} className="max-w-full px-1.5 text-[10px]" />
                    </> : <span className="truncate">{label}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
