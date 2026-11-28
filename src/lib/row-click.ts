// Make a whole table row open its record: click anywhere on the row, or press
// Enter / Space while it has keyboard focus. Anything interactive inside the
// row (buttons, links, inputs, selects, menus) keeps doing its own job, and a
// click inside a menu or dialog portal — which React still bubbles to the row —
// is ignored.

const INTERACTIVE =
  "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=combobox],[role=checkbox],[role=switch],[role=option],[role=tab],[data-no-row-click]";

type ElLike = { closest?: (s: string) => ElLike | null; contains?: (n: unknown) => boolean };

/** True when the event started on something that has its own action (or outside the row's DOM). */
export function shouldIgnoreRowEvent(target: unknown, row: unknown): boolean {
  const t = target as ElLike | null;
  const r = row as ElLike | null;
  if (!t || !r) return true;
  if (typeof r.contains === "function" && !r.contains(t)) return true; // portal content
  if (typeof t.closest !== "function") return false;
  const hit = t.closest(INTERACTIVE);
  return !!hit && hit !== r;
}

/**
 * `/admin?tab=bookings&id=...` for a record the row opens, so a row can behave
 * like a link: Cmd/Ctrl-click and middle-click open it in a new tab. Only plain
 * values are put in the URL; anything else returns null and the row simply has
 * no new-tab behavior.
 */
export function rowHref(search: Record<string, unknown> | null | undefined, to = "/admin"): string | null {
  if (!search) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value == null || value === "") continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${to}?${query}` : to;
}

type RowClickEvent = {
  target: unknown;
  currentTarget: unknown;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  button?: number;
  preventDefault?: () => void;
};

function openInNewTab(href: string) {
  if (typeof window !== "undefined") window.open(href, "_blank", "noopener");
}

export function rowOpenProps(open: () => void, href?: string | null) {
  return {
    tabIndex: 0,
    "data-row-open": "",
    ...(href ? { "data-row-href": href } : {}),
    // Middle-click: open in a new tab when the row has a destination.
    onAuxClick: (e: RowClickEvent) => {
      if (!href || e.button !== 1) return;
      if (e.defaultPrevented) return;
      if (shouldIgnoreRowEvent(e.target, e.currentTarget)) return;
      e.preventDefault?.();
      openInNewTab(href);
    },
    // Stop the browser's middle-click autoscroll so the new tab opens cleanly.
    onMouseDown: (e: RowClickEvent) => {
      if (href && e.button === 1 && !shouldIgnoreRowEvent(e.target, e.currentTarget)) e.preventDefault?.();
    },
    onClick: (e: RowClickEvent) => {
      if (e.defaultPrevented) return;
      if (shouldIgnoreRowEvent(e.target, e.currentTarget)) return;
      if (href && (e.metaKey || e.ctrlKey)) {
        e.preventDefault?.();
        openInNewTab(href);
        return;
      }
      // Selecting text to copy is not a request to open the row.
      const sel = typeof window !== "undefined" ? window.getSelection?.()?.toString() : "";
      if (sel) return;
      open();
    },
    onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown; metaKey?: boolean; ctrlKey?: boolean; preventDefault: () => void }) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      if (href && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        openInNewTab(href);
        return;
      }
      open();
    },
  };
}

export const ROW_OPEN_CLASS =
  "cursor-pointer hover:bg-[#FAFAFB] focus-visible:outline-none focus-visible:bg-[#FAFAFB] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D03020]/40 transition-colors";


/**
 * Props for a row that opens an admin record (a driver, vehicle, booking...) through
 * the router. With no destination the row stays plain: no pointer, no focus stop.
 */
export function rowNav(
  navigate: (opts: any) => unknown,
  search: Record<string, unknown> | null | undefined,
  base = "",
): { className: string } & Partial<ReturnType<typeof rowOpenProps>> {
  if (!search) return { className: base };
  return {
    ...rowOpenProps(() => void navigate({ to: "/admin", search } as never), rowHref(search)),
    className: `${base} ${ROW_OPEN_CLASS}`.trim(),
  };
}
