import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shared scroll host for back-office list tables (Layer 3 of the sticky
 * layout standard in styles.css). A scrollable ancestor (overflow: auto or
 * hidden) disables position: sticky for everything inside it, which is why
 * the earlier sticky-header attempt clipped columns. When the table fits
 * the card width this wrapper uses overflow: clip — not a scroll container,
 * so the column headers stick to the page scroll. When the table is wider
 * than the card (typically mobile or very narrow windows) it falls back to
 * the classic horizontal scroller and the headers scroll with it.
 */
export function AdminTableScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const table = el.querySelector("table");
      if (!table) return;
      setFits(table.scrollWidth <= el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${fits ? "admin-table-fit" : "overflow-x-auto"} ${className}`}>
      {children}
    </div>
  );
}
