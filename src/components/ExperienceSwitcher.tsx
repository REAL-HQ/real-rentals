import { confirmLeaveIfUnsaved } from "@/lib/unsaved-changes";
import { Briefcase, Car, Check, ChevronsUpDown, Crown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPERIENCE_LABELS, type Experience } from "@/lib/experience";

const ICONS = { owner: Crown, admin: Briefcase, driver: Car } as const;
const HINTS: Record<Experience, string> = {
  owner: "Full Business View",
  admin: "Daily Operations",
  driver: "Preview The Driver Portal",
};

/** Compact account-style selector. View only — never changes permissions. */
export function ExperienceSwitcher({ value, options, onChange }: {
  value: Experience;
  options: Experience[];
  onChange: (e: Experience) => void;
}) {
  if (options.length < 2) return null;
  const Icon = ICONS[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Experience: ${EXPERIENCE_LABELS[value]}. Change experience`}
        className="mx-2.5 mb-4 flex w-[calc(100%-20px)] items-center gap-2.5 rounded-xl border border-[#26262B] bg-[#1A1A1E] px-3 py-2 text-left text-[13px] font-medium text-white outline-none transition-colors hover:bg-[#1F1F23] focus-visible:ring-2 focus-visible:ring-[#D03020]"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[#D03020]/15 text-[#FF6B5B]">
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="flex-1 truncate">{EXPERIENCE_LABELS[value]}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-[#8E8E96]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[200px] rounded-xl bg-white p-1 text-[#111114]">
        {options.map((o) => {
          const I = ICONS[o];
          return (
            <DropdownMenuItem key={o} onSelect={() => { if (o !== value && confirmLeaveIfUnsaved()) onChange(o); }} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[#111114] focus:bg-[#F4F4F6] focus:text-[#111114]">
              <I className="h-4 w-4 text-[#55555E]" strokeWidth={1.75} />
              <span className="flex-1">
                <span className="block text-[13px] font-medium">{EXPERIENCE_LABELS[o]}</span>
                <span className="block text-[11px] text-[#8E8E96]">{HINTS[o]}</span>
              </span>
              {o === value && <Check className="h-4 w-4 text-[#D03020]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
