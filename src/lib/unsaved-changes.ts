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
