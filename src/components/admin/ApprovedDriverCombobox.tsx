import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  approvedDriverLabel,
  approvedDriverMatches,
  type ApprovedDriverOption,
} from "@/lib/approved-driver-picker";

/**
 * Searchable Approved Driver picker. Same popover combobox as the vehicle
 * picker, without photos. Value is applications.id, or "" when none is chosen.
 */
export function ApprovedDriverCombobox({
  people,
  value,
  onChange,
  disabled,
}: {
  people: ApprovedDriverOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = people.find((p) => p.id === value) ?? null;
  const filtered = useMemo(() => people.filter((p) => approvedDriverMatches(p, q)), [people, q]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

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
          aria-label="Approved Driver"
          disabled={disabled}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-sm font-normal text-[#111114] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? approvedDriverLabel(selected) : "Select…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[200] w-[var(--radix-popover-trigger-width)] min-w-[min(100vw-2rem,22rem)] p-0 shadow-none"
      >
        <Command shouldFilter={false} className="rounded-md bg-white">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search Name, Email, or Phone"
            aria-label="Search Approved Drivers"
          />
          <CommandList>
            {filtered.length === 0 ? (
              <div role="status" className="py-6 text-center text-sm text-muted-foreground">
                No Matches
              </div>
            ) : (
              <CommandGroup>
                <CommandItem value="__none__" onSelect={() => choose("")}>
                  <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">Select…</span>
                </CommandItem>
                {filtered.map((person) => {
                  const label = approvedDriverLabel(person);
                  const detail = [person.email, person.phone].filter(Boolean).join(" · ");
                  return (
                    <CommandItem key={person.id} value={person.id} aria-label={label} onSelect={() => choose(person.id)}>
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === person.id ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0">
                        <span className="block truncate">{label}</span>
                        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
