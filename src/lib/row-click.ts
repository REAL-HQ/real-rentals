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

export function rowOpenProps(open: () => void) {
  return {
    tabIndex: 0,
    "data-row-open": "",
    onClick: (e: { target: unknown; currentTarget: unknown; defaultPrevented?: boolean }) => {
      if (e.defaultPrevented) return;
      if (shouldIgnoreRowEvent(e.target, e.currentTarget)) return;
      // Selecting text to copy is not a request to open the row.
      const sel = typeof window !== "undefined" ? window.getSelection?.()?.toString() : "";
      if (sel) return;
      open();
    },
    onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown; preventDefault: () => void }) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      open();
    },
  };
}

export const ROW_OPEN_CLASS =
  "cursor-pointer hover:bg-[#FAFAFB] focus-visible:outline-none focus-visible:bg-[#FAFAFB] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D03020]/40 transition-colors";
