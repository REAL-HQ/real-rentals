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
import {
  formatVehicleLabel,
  vehicleMatchesQuery,
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
  placeholder = "Select vehicle…",
  allowNone = true,
  noneLabel = "— None —",
  disabled,
  className,
  triggerClassName,
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
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-white px-3 text-left text-sm text-foreground shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? formatVehicleLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "z-[200] w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,22rem)] max-w-[36rem] p-0",
          className,
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} className="rounded-md">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search plate, VIN, unit, make…"
          />
          <CommandList>
            <CommandEmpty>No vehicles match.</CommandEmpty>
            <CommandGroup>
              {allowNone ? (
                <CommandItem
                  value="__none__"
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
                const label = formatVehicleLabel(v);
                return (
                  <CommandItem
                    key={v.id}
                    value={v.id}
                    onSelect={() => {
                      onChange(v.id);
                      setOpen(false);
                      setQ("");
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4 shrink-0", value === v.id ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{label}</span>
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
