// Client-safe: shared by the Send server function and the prepare dialog.
/**
 * Send's refusal when the re-rendered agreement no longer matches the
 * reviewed preview. Shown to staff as-is, so it says that nothing was sent,
 * why the fingerprint can move (including a release that changes how a field
 * prints), and what to do. The prepare dialog keeps it on screen until the
 * preview is regenerated.
 */
export const STALE_PREVIEW_REFUSAL =
  "Nothing was sent: the agreement changed since it was previewed. Its details (driver, vehicle, dates, rate or deposit), its template, or how it prints after a system update differ from what you reviewed. Regenerate the preview and review it again before sending.";
