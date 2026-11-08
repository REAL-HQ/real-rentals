import type { ReactNode } from "react";

/**
 * Deliberate rows, not two flex siblings whose heights depend on wrapping.
 * Search + actions share the first row. The four filters share a separate
 * equal-width grid; readiness/search context stays in the final row.
 * Container queries respond to the actual admin column, not the window.
 */
export function AdminToolbar({
  search,
  filters,
  actions,
  footer,
  className = "",
}: {
  search: ReactNode;
  filters: ReactNode;
  actions?: ReactNode;
  /** A full-width line under the controls, inside the same sticky bar. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`admin-sticky-bar admin-list-toolbar mb-4 pb-2 min-w-0 ${className}`} data-admin-toolbar>
      <div className="admin-toolbar-primary" data-toolbar-primary>
        <div className="min-w-0" data-toolbar-search>{search}</div>
        {actions ? (
          <div className="admin-toolbar-actions" data-toolbar-actions>{actions}</div>
        ) : null}
      </div>
      <div className="admin-toolbar-filters" data-toolbar-filters>{filters}</div>
      {footer ? <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2" data-toolbar-context>{footer}</div> : null}
    </div>
  );
}

/** Shared control sizes: every control in a toolbar is 36px tall. */
export const TOOLBAR = {
  search:
    "h-9 w-full min-w-0 rounded-md border border-border bg-white px-3 text-sm",
  select: "h-9 w-full min-w-0 bg-white text-sm text-foreground",
  button:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#EDEDF0] bg-white px-3.5 text-sm font-medium hover:bg-[#FAFAFB]",
  primary:
    "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#D03020] px-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90",
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
