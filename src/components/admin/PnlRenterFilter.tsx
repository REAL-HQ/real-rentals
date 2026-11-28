import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const field = "rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#111114]";

/**
 * Searchable renter filter for Owner P&L. Value is the renter id, or ""
 * for every renter — the same values the native select wrote into driverId.
 */
export function PnlRenterFilter({
  renters,
  value,
  onChange,
}: {
  renters: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = renters.find((renter) => renter.id === value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return renters;
    return renters.filter((renter) => renter.name.toLowerCase().includes(needle));
  }, [renters, query]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Renter"
          className={`${field} select-soft w-full truncate text-left`}
        >
          {selected ? selected.name : "All Renters"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] border-[#EDEDF0] bg-white p-0 text-[#111114] shadow-none"
      >
        <Command shouldFilter={false} className="rounded-lg bg-white text-[#111114] shadow-none">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search Renters" aria-label="Search Renters" />
          <CommandList>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => choose("")}>
                <Check className={cn("mr-2 h-4 w-4", value ? "opacity-0" : "opacity-100")} />
                All Renters
              </CommandItem>
              {filtered.map((renter) => (
                <CommandItem key={renter.id} value={renter.id} onSelect={() => choose(renter.id)}>
                  <Check className={cn("mr-2 h-4 w-4", value === renter.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{renter.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {filtered.length === 0 ? (
              <div role="status" className="py-6 text-center text-sm text-[#55555E]">No Renters Found</div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
