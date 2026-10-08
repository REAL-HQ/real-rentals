/** Shared registry of open editors with unsaved edits, checked before switching experiences. */
const open = new Set<string>();

export function setUnsaved(key: string, dirty: boolean) {
  if (dirty) open.add(key);
  else open.delete(key);
}

export function hasUnsavedChanges() {
  return open.size > 0;
}

/** Returns true when it is safe to leave (nothing unsaved, or the user confirmed). */
export function confirmLeaveIfUnsaved() {
  if (!hasUnsavedChanges()) return true;
  return window.confirm("You have unsaved changes. Leave without saving?");
}

import { useEffect } from "react";

/** Register an editor's dirty state with the shared guard (also warns on refresh/close). */
export function useUnsavedGuard(key: string, dirty: boolean) {
  useEffect(() => {
    setUnsaved(key, dirty);
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { setUnsaved(key, false); window.removeEventListener("beforeunload", warn); };
  }, [key, dirty]);
}
