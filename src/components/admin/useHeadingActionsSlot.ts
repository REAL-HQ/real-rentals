import { useEffect, useState } from "react";

/**
 * The page-title row (heading + description) is rendered by admin.tsx, but a
 * page's primary action lives inside its panel. admin.tsx leaves an empty slot
 * at the far right of that row; a panel looks the slot up here and portals its
 * button into it, so the action sits on the title line instead of inside the
 * filter row.
 *
 * The slot only exists while the heading renders — it is absent on Overview and
 * behind a record breadcrumb — so it is looked up rather than assumed, and
 * re-checked whenever the surrounding chrome changes.
 */
export const HEADING_ACTIONS_ID = "admin-heading-actions";

export function useHeadingActionsSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const find = () => {
      const el = document.getElementById(HEADING_ACTIONS_ID);
      setSlot((prev) => (prev === el ? prev : el));
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return slot;
}
