import type { ReactNode } from "react";

/**
 * One filter/actions row for an admin list page.
 *
 * Why this exists: the Vehicles toolbar kept breaking because its layout
 * switched on VIEWPORT breakpoints (lg = 1024px window), but the admin column
 * is the window minus a 240px sidebar. At a 1024px window the "desktop" row
 * got ~830px, the filters wrapped inside a flex-1 box while the actions were
 * squeezed beside them, and every fix re-tuned lg: classes that a layout test
 * then froze. This row never asks the viewport: it wraps by the space it
 * actually has, so it is the same at any sidebar width.
 *
 * - Filters take the row first and wrap among themselves.
 * - Actions keep their size (never squashed, never truncated) and drop to
 *   their own line, right-aligned, when there's no room beside the filters.
 * - On a phone, controls go full width.
 */
export function AdminToolbar({
  filters,
  actions,
  footer,
  className = "",
}: {
  filters: ReactNode;
  actions?: ReactNode;
  /** A full-width line under the controls, inside the same sticky bar. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`admin-sticky-bar mb-4 pb-2 min-w-0 ${className}`} data-admin-toolbar>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_32rem] flex-wrap items-center gap-2" data-toolbar-filters>
          {filters}
        </div>
        {actions ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full" data-toolbar-actions>
            {actions}
          </div>
        ) : null}
      </div>
      {footer ? <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">{footer}</div> : null}
    </div>
  );
}

/** Shared control sizes: every control in a toolbar is 36px tall. */
export const TOOLBAR = {
  search:
    "h-9 min-w-[12rem] flex-[1_1_14rem] max-w-[22rem] rounded-md border border-border bg-white px-3 text-sm max-sm:max-w-none max-sm:w-full",
  select: "h-9 w-[9.5rem] shrink-0 bg-white text-sm text-foreground max-sm:w-full",
  button:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#EDEDF0] bg-white px-3.5 text-sm font-medium hover:bg-[#FAFAFB] max-sm:flex-1",
  primary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#D03020] px-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90 max-sm:flex-1",
  segmented: "inline-flex h-9 shrink-0 items-center rounded-md border border-[#EDEDF0] bg-white p-0.5",
  segment: "inline-flex h-full items-center gap-1 rounded px-2 text-xs",
} as const;

/**
 * The top-bar search is shared by Drivers, Vehicles and Partners and survives
 * switching between them. A list that applies it must say so, with a way to
 * clear it — otherwise "sch" typed on Drivers shows as "No Matching Vehicles"
 * with an empty search box.
 */
export function TopSearchChip({ value, onClear }: { value: string; onClear: () => void }) {
  const v = value.trim();
  if (!v) return null;
  return (
    <span
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[#D03020]/30 bg-[#FFF5F3] pl-3 pr-1 text-xs text-[#111114]"
      data-testid="top-search-chip"
    >
      Top search: <span className="max-w-[10rem] truncate font-medium">“{v}”</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear top search"
        className="inline-flex h-7 items-center rounded px-2 text-[#55555E] hover:bg-white hover:text-[#111114]"
      >
        Clear
      </button>
    </span>
  );
}
